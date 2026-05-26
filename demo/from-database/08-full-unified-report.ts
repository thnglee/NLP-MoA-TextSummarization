#!/usr/bin/env tsx
/**
 * 08-full-unified-report.ts — Tổng hợp toàn bộ 3 trục vào 1 file
 *
 * Maps to: Cross-axis summary Table 4.9 trong thesis
 *
 * Gọi tất cả logic từ 7 scripts trên và build 1 unified report
 * kèm cross-axis analysis table.
 *
 * Usage:
 *   cd demo
 *   npx tsx from-database/08-full-unified-report.ts
 *   npx tsx from-database/08-full-unified-report.ts --json
 */

import * as fs from "node:fs"
import * as path from "node:path"
import {
  banner, showHelp, fmt, fmtPct, fmtPctRaw, approachKey, meanOrNull,
  mdTable, writeReport,
  fetchAllEvalRows, fetchAllPairwiseRows, fetchHumanEval,
  type EvalRow, type PairwiseRow,
  type HumanEvalTaskRow, type HumanEvalResponseRow,
  hasFlag,
} from "./_shared"

import {
  signTestPValue, aggregateRankings, fleissKappaFromRankings,
} from "../../backend/output-fusion/scripts/stats"

showHelp(`
Usage: npx tsx from-database/08-full-unified-report.ts [options]

Options:
  --json       Also write a JSON sidecar with raw aggregates
  --help       Show this help message

Description:
  Tổng hợp toàn bộ 3 axes (A, B, C) vào 1 file Markdown.
  Bao gồm cross-axis analysis table.
  Output: reports/full-unified-report.md (+ .json nếu --json)
`)

// ─── Axis A ────────────────────────────────────────────────────────────────

interface AxisAEntry {
  approach: string
  n: number
  rouge1: number | null
  rougeL: number | null
  bleu: number | null
  bert: number | null
  compression: number | null
}

function buildAxisA(rows: EvalRow[]): AxisAEntry[] {
  const groups = new Map<string, EvalRow[]>()
  for (const r of rows) {
    const k = approachKey(r.mode, r.model)
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k)!.push(r)
  }
  const entries: AxisAEntry[] = []
  for (const [approach, rs] of groups) {
    entries.push({
      approach, n: rs.length,
      rouge1: meanOrNull(rs.map(r => r.rouge_1)),
      rougeL: meanOrNull(rs.map(r => r.rouge_l)),
      bleu: meanOrNull(rs.map(r => r.bleu)),
      bert: meanOrNull(rs.map(r => r.bert_score)),
      compression: meanOrNull(rs.map(r => r.compression_rate)),
    })
  }
  entries.sort((a, b) => (b.bert ?? -Infinity) - (a.bert ?? -Infinity))
  return entries
}

// ─── Axis B.1 ──────────────────────────────────────────────────────────────

interface AxisB1Entry {
  approach: string
  n: number
  faithfulness: number | null
  coverage: number | null
  fluency: number | null
  conciseness: number | null
  overall: number | null
}

function buildAxisB1(rows: EvalRow[]): AxisB1Entry[] {
  const groups = new Map<string, EvalRow[]>()
  for (const r of rows) {
    if (!r.judge_rubric) continue
    const k = approachKey(r.mode, r.model)
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k)!.push(r)
  }
  const entries: AxisB1Entry[] = []
  for (const [approach, rs] of groups) {
    entries.push({
      approach, n: rs.length,
      faithfulness: meanOrNull(rs.map(r => r.judge_rubric?.faithfulness ?? null)),
      coverage: meanOrNull(rs.map(r => r.judge_rubric?.coverage ?? null)),
      fluency: meanOrNull(rs.map(r => r.judge_rubric?.fluency ?? null)),
      conciseness: meanOrNull(rs.map(r => r.judge_rubric?.conciseness ?? null)),
      overall: meanOrNull(rs.map(r => r.judge_rubric?.overall ?? null)),
    })
  }
  entries.sort((a, b) => (b.overall ?? -Infinity) - (a.overall ?? -Infinity))
  return entries
}

// ─── Axis B.2 (pairwise) ──────────────────────────────────────────────────

interface PairEntry {
  label: string
  n: number
  fused_wins: number
  other_wins: number
  ties: number
  fused_win_rate: number
  sign_test_p: number | null
}

function buildPairwise(rows: PairwiseRow[], comparisonType: string): PairEntry[] {
  const filtered = rows.filter(r => r.comparison_type === comparisonType)
  if (comparisonType === "vs_individual_draft") {
    const groups = new Map<string, PairwiseRow[]>()
    for (const r of filtered) {
      const prefix = "individual_draft:"
      if (!r.summary_b_label.startsWith(prefix)) continue
      const model = r.summary_b_label.slice(prefix.length)
      if (!groups.has(model)) groups.set(model, [])
      groups.get(model)!.push(r)
    }
    const entries: PairEntry[] = []
    for (const [model, rs] of groups) {
      let f = 0, o = 0, t = 0
      for (const r of rs) { if (r.winner === "A") f++; else if (r.winner === "B") o++; else t++ }
      const d = f + o
      entries.push({
        label: `vs ${model}`, n: rs.length,
        fused_wins: f, other_wins: o, ties: t,
        fused_win_rate: d > 0 ? f / d : 0,
        sign_test_p: d > 0 ? signTestPValue(Math.max(f, o), d) : null,
      })
    }
    return entries.sort((a, b) => b.fused_win_rate - a.fused_win_rate)
  }
  // vs_best_draft or vs_single_aggregator — aggregate all
  let f = 0, o = 0, t = 0
  for (const r of filtered) { if (r.winner === "A") f++; else if (r.winner === "B") o++; else t++ }
  const d = f + o
  const label = comparisonType === "vs_best_draft" ? "vs best draft"
    : comparisonType === "vs_single_aggregator" ? "vs GPT-4o alone"
    : comparisonType
  return [{
    label, n: filtered.length,
    fused_wins: f, other_wins: o, ties: t,
    fused_win_rate: d > 0 ? f / d : 0,
    sign_test_p: d > 0 ? signTestPValue(Math.max(f, o), d) : null,
  }]
}

// ─── Axis B.3 ──────────────────────────────────────────────────────────────

interface FactEntry {
  approach: string
  n: number
  entailment_pct: number | null
  avg_hall: number | null
  worst: number
}

function buildB3(rows: EvalRow[]): FactEntry[] {
  const groups = new Map<string, EvalRow[]>()
  for (const r of rows) {
    if (r.factuality_entailed_ratio == null) continue
    const k = approachKey(r.mode, r.model)
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k)!.push(r)
  }
  const entries: FactEntry[] = []
  for (const [approach, rs] of groups) {
    const ent = meanOrNull(rs.map(r => r.factuality_entailed_ratio))
    const halls = rs.map(r => Array.isArray(r.factuality_hallucinations) ? r.factuality_hallucinations.length : 0)
    entries.push({
      approach, n: rs.length,
      entailment_pct: ent == null ? null : ent * 100,
      avg_hall: meanOrNull(halls),
      worst: halls.reduce((m, c) => Math.max(m, c), 0),
    })
  }
  return entries.sort((a, b) => (b.entailment_pct ?? -Infinity) - (a.entailment_pct ?? -Infinity))
}

// ─── Axis C ────────────────────────────────────────────────────────────────

interface AxisCApproach {
  approach: string
  tasks: number
  rater_rankings: number
  avg_rank: number
  win_rate: number
}

function buildAxisC(tasks: HumanEvalTaskRow[], responses: HumanEvalResponseRow[]): {
  approaches: AxisCApproach[]
  pooledKappa: number | null
} {
  const responsesByTask = new Map<string, HumanEvalResponseRow[]>()
  for (const r of responses) {
    if (!responsesByTask.has(r.task_id)) responsesByTask.set(r.task_id, [])
    responsesByTask.get(r.task_id)!.push(r)
  }

  const perApproach = new Map<string, { rank_sum: number; rank_n: number; win_sum: number; win_n: number; tasks: Set<string> }>()
  const kappas: number[] = []

  for (const task of tasks) {
    const taskResps = responsesByTask.get(task.id) ?? []
    if (taskResps.length === 0) continue

    const hiddenLookup: Record<string, { hidden_model?: string; hidden_mode?: string }> = {}
    for (const s of task.summaries) {
      hiddenLookup[s.label] = { hidden_model: s.hidden_model, hidden_mode: s.hidden_mode }
    }

    const rankings = taskResps.map(r => r.ranking)
    const aggs = aggregateRankings(rankings, hiddenLookup)
    const k = rankings.length >= 2 ? fleissKappaFromRankings(rankings) : Number.NaN
    if (Number.isFinite(k)) kappas.push(k)

    for (const a of aggs) {
      const mode = a.hidden_mode ?? ""
      const model = (a.hidden_model ?? "").toLowerCase()
      let approach: string
      if (mode === "fusion" || model.startsWith("moa:")) approach = "fused"
      else if (mode === "sync" && model.startsWith("gpt-4o") && !model.includes("mini")) approach = "single:gpt-4o"
      else approach = `${mode}:${model}`

      const entry = perApproach.get(approach) ?? { rank_sum: 0, rank_n: 0, win_sum: 0, win_n: 0, tasks: new Set<string>() }
      entry.rank_sum += a.avg_rank * a.rater_count
      entry.rank_n += a.rater_count
      entry.win_sum += a.win_rate
      entry.win_n += 1
      entry.tasks.add(task.id)
      perApproach.set(approach, entry)
    }
  }

  const approaches = Array.from(perApproach.entries())
    .map(([approach, e]) => ({
      approach,
      tasks: e.tasks.size,
      rater_rankings: e.rank_n,
      avg_rank: e.rank_n > 0 ? e.rank_sum / e.rank_n : 0,
      win_rate: e.win_n > 0 ? e.win_sum / e.win_n : 0,
    }))
    .sort((a, b) => a.avg_rank - b.avg_rank)

  return {
    approaches,
    pooledKappa: kappas.length > 0 ? kappas.reduce((a, b) => a + b, 0) / kappas.length : null,
  }
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  banner("FULL UNIFIED THREE-AXIS REPORT")

  console.log("\n⏳ Fetching all data from Supabase...")
  const [evalRows, pairwiseRows, humanEval] = await Promise.all([
    fetchAllEvalRows(),
    fetchAllPairwiseRows(),
    fetchHumanEval(),
  ])

  console.log(`  evaluation_metrics:  ${evalRows.length} rows`)
  console.log(`  llm_judge_pairwise:  ${pairwiseRows.length} rows`)
  console.log(`  human_eval_tasks:    ${humanEval.tasks.length} rows`)
  console.log(`  human_eval_responses: ${humanEval.responses.length} rows`)

  // Build all axes
  const axisA = buildAxisA(evalRows)
  const axisB1 = buildAxisB1(evalRows)
  const pairBest = buildPairwise(pairwiseRows, "vs_best_draft")
  const pairEach = buildPairwise(pairwiseRows, "vs_individual_draft")
  const pairSingle = buildPairwise(pairwiseRows, "vs_single_aggregator")
  const axisB3 = buildB3(evalRows)
  const axisC = buildAxisC(humanEval.tasks, humanEval.responses)

  // ── Build Markdown ──────────────────────────────────────────────
  const md: string[] = []
  md.push("# Unified Three-Axis Evaluation Report")
  md.push("")
  md.push(`- **Generated:** ${new Date().toISOString()}`)
  md.push(`- **Source:** Supabase (evaluation_metrics, llm_judge_pairwise, human_eval_*)`)
  md.push(`- **Coverage:** ${evalRows.length} eval rows · ${pairwiseRows.length} pairwise verdicts · ${humanEval.tasks.length} human-eval task(s) · ${humanEval.responses.length} human ranking(s)`)
  md.push("")

  // Axis B (primary)
  md.push("---")
  md.push("## Axis B — Quality & Preference (primary)")
  md.push("")

  md.push("### B.1 LLM-Judge Rubric (FLASK-derived, 1–5)")
  md.push("")
  md.push(mdTable(
    ["Approach", "n", "Faithfulness", "Coverage", "Fluency", "Conciseness", "Overall"],
    axisB1.map(e => [e.approach, String(e.n),
      fmt(e.faithfulness, 2), fmt(e.coverage, 2), fmt(e.fluency, 2), fmt(e.conciseness, 2), fmt(e.overall, 2),
    ]),
  ))
  md.push("")

  md.push("### B.2a Fused vs Best Draft")
  md.push("")
  md.push(mdTable(
    ["Comparison", "n", "Fused wins", "Other wins", "Ties", "Fused win rate", "Sign-test p"],
    pairBest.map(e => [e.label, String(e.n), String(e.fused_wins), String(e.other_wins), String(e.ties),
      fmtPct(e.fused_win_rate), e.sign_test_p != null ? e.sign_test_p.toFixed(4) : "—",
    ]),
  ))
  md.push("")

  md.push("### B.2b Fused vs Each Proposer Draft")
  md.push("")
  md.push(mdTable(
    ["Comparison", "n", "Fused wins", "Draft wins", "Ties", "Fused win rate", "Sign-test p"],
    pairEach.map(e => [e.label, String(e.n), String(e.fused_wins), String(e.other_wins), String(e.ties),
      fmtPct(e.fused_win_rate), e.sign_test_p != null ? e.sign_test_p.toFixed(4) : "—",
    ]),
  ))
  md.push("")

  md.push("### B.2c Fused vs GPT-4o Alone (thesis-decisive)")
  md.push("")
  md.push(mdTable(
    ["Comparison", "n", "Fused wins", "Single wins", "Ties", "Fused win rate", "Sign-test p"],
    pairSingle.map(e => [e.label, String(e.n), String(e.fused_wins), String(e.other_wins), String(e.ties),
      fmtPct(e.fused_win_rate), e.sign_test_p != null ? e.sign_test_p.toFixed(4) : "—",
    ]),
  ))
  md.push("")

  md.push("### B.3 Factuality (Claim-Entailment)")
  md.push("")
  md.push(mdTable(
    ["Approach", "n", "Entailment %", "Avg hallucinations", "Worst case"],
    axisB3.map(e => [e.approach, String(e.n), fmtPctRaw(e.entailment_pct), fmt(e.avg_hall, 2), String(e.worst)]),
  ))
  md.push("")

  // Axis C
  md.push("---")
  md.push("## Axis C — Human Validation")
  md.push("")
  md.push(`Pooled Fleiss' κ = ${axisC.pooledKappa != null ? axisC.pooledKappa.toFixed(3) : "—"}`)
  md.push("")
  md.push(mdTable(
    ["Approach", "Tasks", "Rater-rankings", "Avg rank", "Win rate"],
    axisC.approaches.map(e => [e.approach, String(e.tasks), String(e.rater_rankings), fmt(e.avg_rank, 2), fmtPct(e.win_rate)]),
  ))
  md.push("")

  // Axis A (supplementary)
  md.push("---")
  md.push("## Axis A — Content Retention (supplementary)")
  md.push("")
  md.push(mdTable(
    ["Approach", "n", "ROUGE-1", "ROUGE-L", "BLEU", "BERTScore", "Compression %"],
    axisA.map(e => [e.approach, String(e.n), fmt(e.rouge1, 4), fmt(e.rougeL, 4), fmt(e.bleu, 4), fmt(e.bert, 4), fmt(e.compression, 2)]),
  ))
  md.push("")

  // Cross-axis summary
  md.push("---")
  md.push("## Cross-Axis Summary (Table 4.9)")
  md.push("")
  md.push("| Axis | Key metric | Fused result | Significance |")
  md.push("| --- | --- | --- | --- |")

  const fusedBert = axisA.find(e => e.approach.includes("fusion"))
  md.push(`| A — Content Retention | BERTScore | ${fusedBert ? fmt(fusedBert.bert, 4) : "—"} | Supplementary |`)

  const fusedRubric = axisB1.find(e => e.approach.includes("fusion"))
  md.push(`| B.1 — Rubric | Overall (1–5) | ${fusedRubric ? fmt(fusedRubric.overall, 2) : "—"} | — |`)

  if (pairBest.length > 0) {
    const p = pairBest[0]
    md.push(`| B.2a — vs Best Draft | Win rate | ${fmtPct(p.fused_win_rate)} | p=${p.sign_test_p != null ? p.sign_test_p.toFixed(4) : "—"} |`)
  }
  if (pairSingle.length > 0) {
    const p = pairSingle[0]
    md.push(`| B.2c — vs GPT-4o | Win rate | ${fmtPct(p.fused_win_rate)} | p=${p.sign_test_p != null ? p.sign_test_p.toFixed(4) : "—"} |`)
  }
  if (axisB3.length > 0) {
    const fusedFact = axisB3.find(e => e.approach.includes("fusion"))
    md.push(`| B.3 — Factuality | Entailment % | ${fusedFact ? fmtPctRaw(fusedFact.entailment_pct) : "—"} | — |`)
  }
  if (axisC.approaches.length > 0) {
    const fusedC = axisC.approaches.find(e => e.approach === "fused")
    md.push(`| C — Human | Avg rank / Win rate | ${fusedC ? `${fmt(fusedC.avg_rank, 2)} / ${fmtPct(fusedC.win_rate)}` : "—"} | κ=${axisC.pooledKappa != null ? axisC.pooledKappa.toFixed(3) : "—"} |`)
  }
  md.push("")

  // Console summary
  console.log("\n📊 Cross-axis summary printed. See full report for details.\n")

  const reportPath = writeReport("full-unified-report.md", md.join("\n"))

  if (hasFlag("json")) {
    const jsonPath = reportPath.replace(/\.md$/, ".json")
    fs.writeFileSync(jsonPath, JSON.stringify({
      generated_at: new Date().toISOString(),
      axis_a: axisA,
      axis_b1: axisB1,
      axis_b2_best: pairBest,
      axis_b2_each: pairEach,
      axis_b2_single: pairSingle,
      axis_b3: axisB3,
      axis_c: axisC,
    }, null, 2))
    console.log(`📝 JSON sidecar → ${jsonPath}`)
  }
}

main().catch(err => {
  console.error("FATAL:", err)
  process.exit(1)
})
