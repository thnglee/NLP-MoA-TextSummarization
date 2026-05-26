#!/usr/bin/env tsx
/**
 * 07-axis-c-human-eval.ts — Trục C: Human Evaluation
 *
 * Maps to: Tables 4.7, 4.8 trong thesis
 *
 * Query human_eval_tasks + human_eval_responses.
 * Tính: avg rank, #1 share, pairwise win rate, Fleiss' κ.
 * Topic-conditional breakdown (nếu có).
 *
 * Usage:
 *   cd demo
 *   npx tsx from-database/07-axis-c-human-eval.ts
 */

import {
  banner, showHelp, fmt, fmtPct, mdTable, writeReport,
  fetchHumanEval, approachKey,
  type HumanEvalTaskRow, type HumanEvalResponseRow,
} from "./_shared"

import {
  aggregateRankings, fleissKappaFromRankings, signTestPValue,
} from "../../backend/output-fusion/scripts/stats"

showHelp(`
Usage: npx tsx from-database/07-axis-c-human-eval.ts [options]

Options:
  --help       Show this help message

Description:
  Trục C: Human Evaluation — avg rank, #1 share, pairwise win rate,
  Fleiss' κ for inter-rater agreement.
  Output: console + reports/axis-c-human-validation.md
`)

function approachOf(s: { hidden_model?: string; hidden_mode?: string }): string {
  const mode = s.hidden_mode ?? ""
  const model = (s.hidden_model ?? "").toLowerCase()
  if (mode === "fusion" || model.startsWith("moa:")) return "fused"
  if (mode === "proposer_draft") return "proposer_draft:" + model
  if (mode === "sync") {
    if (model.includes("mini")) return "single:gpt-4o-mini"
    if (model.startsWith("gpt-4o")) return "single:gpt-4o"
    return "single:" + model
  }
  return `${mode}:${model}`
}

async function main() {
  banner("TRỤC C — Human Evaluation (Blind Ranking)")

  console.log("\n⏳ Fetching human eval data from Supabase...")
  const { tasks, responses } = await fetchHumanEval()
  console.log(`  → ${tasks.length} tasks, ${responses.length} responses`)

  if (responses.length === 0) {
    console.log("\n⚠️  No human evaluation responses found.")
    return
  }

  // ── Group responses by task ─────────────────────────────────────
  const responsesByTask = new Map<string, HumanEvalResponseRow[]>()
  for (const r of responses) {
    if (!responsesByTask.has(r.task_id)) responsesByTask.set(r.task_id, [])
    responsesByTask.get(r.task_id)!.push(r)
  }

  // ── Per-approach aggregation ────────────────────────────────────
  const perApproach = new Map<string, {
    rank_sum: number; rank_n: number
    first_place: number
    win_sum: number; win_n: number
    tasks: Set<string>
  }>()
  const perTaskResults: Array<{
    task_id: string
    article_url: string
    rater_count: number
    kappa: number | null
    rankings: string[][]
  }> = []
  const allKappas: number[] = []

  for (const task of tasks) {
    const taskResponses = responsesByTask.get(task.id) ?? []
    if (taskResponses.length === 0) continue

    const hiddenLookup: Record<string, { hidden_model?: string; hidden_mode?: string }> = {}
    for (const s of task.summaries) {
      hiddenLookup[s.label] = { hidden_model: s.hidden_model, hidden_mode: s.hidden_mode }
    }

    const rankings = taskResponses.map(r => r.ranking)
    const aggs = aggregateRankings(rankings, hiddenLookup)
    const kappa = rankings.length >= 2 ? fleissKappaFromRankings(rankings) : Number.NaN
    const kappaClean = Number.isFinite(kappa) ? kappa : null
    if (kappaClean !== null) allKappas.push(kappaClean)

    perTaskResults.push({
      task_id: task.id,
      article_url: task.article_url,
      rater_count: rankings.length,
      kappa: kappaClean,
      rankings,
    })

    for (const a of aggs) {
      const approach = approachOf({
        hidden_model: a.hidden_model,
        hidden_mode: a.hidden_mode,
      })
      const entry = perApproach.get(approach) ?? {
        rank_sum: 0, rank_n: 0, first_place: 0,
        win_sum: 0, win_n: 0, tasks: new Set<string>(),
      }
      entry.rank_sum += a.avg_rank * a.rater_count
      entry.rank_n += a.rater_count
      entry.win_sum += a.win_rate
      entry.win_n += 1
      if (a.avg_rank <= 1.0) entry.first_place += 1
      entry.tasks.add(task.id)
      perApproach.set(approach, entry)
    }
  }

  const pooledKappa = allKappas.length > 0
    ? allKappas.reduce((a, b) => a + b, 0) / allKappas.length
    : null

  // ── Console output ──────────────────────────────────────────────
  console.log("\n📊 Per-approach Summary (sorted by avg rank, lower=better):\n")
  const approachEntries = Array.from(perApproach.entries())
    .map(([approach, e]) => ({
      approach,
      tasks: e.tasks.size,
      rater_rankings: e.rank_n,
      avg_rank: e.rank_n > 0 ? e.rank_sum / e.rank_n : 0,
      win_rate: e.win_n > 0 ? e.win_sum / e.win_n : 0,
    }))
    .sort((a, b) => a.avg_rank - b.avg_rank)

  console.table(approachEntries.map(e => ({
    "Approach": e.approach,
    "Tasks": e.tasks,
    "Rater-rankings": e.rater_rankings,
    "Avg rank": fmt(e.avg_rank, 2),
    "Win rate": fmtPct(e.win_rate),
  })))

  console.log(`\n📊 Pooled Fleiss' κ: ${pooledKappa != null ? pooledKappa.toFixed(3) : "—"}`)
  if (pooledKappa != null) {
    const level = pooledKappa < 0 ? "poor"
      : pooledKappa < 0.20 ? "slight"
      : pooledKappa < 0.40 ? "fair"
      : pooledKappa < 0.60 ? "moderate"
      : pooledKappa < 0.80 ? "substantial"
      : "almost perfect"
    console.log(`   Interpretation (Landis & Koch): ${level}`)
  }

  console.log("\n📋 Per-task κ:")
  console.table(perTaskResults.map(t => ({
    "Task": t.task_id.slice(0, 8),
    "Article": t.article_url.slice(0, 60),
    "Raters": t.rater_count,
    "κ": t.kappa != null ? t.kappa.toFixed(3) : "—",
  })))

  // ── Markdown report ─────────────────────────────────────────────
  const md: string[] = []
  md.push("# Trục C — Human Evaluation (Blind Ranking)")
  md.push("")
  md.push(`> Generated: ${new Date().toISOString()}`)
  md.push(`> Tasks: ${tasks.length}, Responses: ${responses.length}`)
  md.push("")

  md.push("## Table 4.7 — Per-approach Summary")
  md.push("")
  md.push(`Pooled Fleiss' κ = ${pooledKappa != null ? pooledKappa.toFixed(3) : "—"}`)
  md.push("")
  md.push(mdTable(
    ["Approach", "Tasks", "Rater-rankings", "Avg rank", "Win rate"],
    approachEntries.map(e => [
      e.approach, String(e.tasks), String(e.rater_rankings),
      fmt(e.avg_rank, 2), fmtPct(e.win_rate),
    ]),
  ))
  md.push("")

  md.push("## Table 4.8 — Per-task Fleiss' κ")
  md.push("")
  md.push(mdTable(
    ["Task ID", "Article URL", "Raters", "Fleiss' κ"],
    perTaskResults.map(t => [
      t.task_id.slice(0, 8) + "...",
      t.article_url,
      String(t.rater_count),
      t.kappa != null ? t.kappa.toFixed(3) : "—",
    ]),
  ))
  md.push("")

  // κ interpretation
  md.push("## Interpretation")
  md.push("")
  md.push("Landis & Koch (1977) convention:")
  md.push("- < 0.00 poor")
  md.push("- 0.01–0.20 slight")
  md.push("- 0.21–0.40 fair")
  md.push("- 0.41–0.60 moderate")
  md.push("- 0.61–0.80 substantial")
  md.push("- 0.81–1.00 almost perfect")
  md.push("")
  if (pooledKappa != null) {
    const level = pooledKappa < 0 ? "poor"
      : pooledKappa < 0.20 ? "slight"
      : pooledKappa < 0.40 ? "fair"
      : pooledKappa < 0.60 ? "moderate"
      : pooledKappa < 0.80 ? "substantial"
      : "almost perfect"
    md.push(`Pooled κ = ${pooledKappa.toFixed(3)} → **${level}** agreement.`)
  }
  md.push("")

  writeReport("axis-c-human-validation.md", md.join("\n"))
}

main().catch(err => {
  console.error("FATAL:", err)
  process.exit(1)
})
