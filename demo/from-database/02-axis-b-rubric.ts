#!/usr/bin/env tsx
/**
 * 02-axis-b-rubric.ts — Trục B.1: Rubric Scores per model
 *
 * Maps to: Table 4.2 trong thesis (FLASK-derived rubric 1-5)
 *
 * Query evaluation_metrics WHERE judge_rubric IS NOT NULL,
 * group by (mode, model), tính mean cho 5 dimensions:
 * faithfulness, coverage, fluency, conciseness, overall.
 *
 * Usage:
 *   cd demo
 *   npx tsx from-database/02-axis-b-rubric.ts
 */

import {
  banner, showHelp, fmt, approachKey, meanOrNull,
  mdTable, writeReport, fetchAllEvalRows,
  type EvalRow,
} from "./_shared"

showHelp(`
Usage: npx tsx from-database/02-axis-b-rubric.ts [options]

Options:
  --help       Show this help message

Description:
  Trục B.1: Rubric scores — FLASK-derived 5 dimensions (1-5) per approach.
  Output: console table + reports/axis-b1-rubric-scores.md
`)

interface RubricEntry {
  approach: string
  n: number
  faithfulness: number | null
  coverage: number | null
  fluency: number | null
  conciseness: number | null
  overall: number | null
}

function buildRubric(rows: EvalRow[]): RubricEntry[] {
  const groups = new Map<string, EvalRow[]>()
  for (const r of rows) {
    if (!r.judge_rubric) continue
    const k = approachKey(r.mode, r.model)
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k)!.push(r)
  }
  const entries: RubricEntry[] = []
  for (const [approach, rs] of groups) {
    entries.push({
      approach,
      n: rs.length,
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

async function main() {
  banner("TRỤC B.1 — Rubric Scores (FLASK-derived, 1–5)")

  console.log("\n⏳ Fetching evaluation_metrics from Supabase...")
  const evalRows = await fetchAllEvalRows()
  console.log(`  → ${evalRows.length} total rows, filtering for judge_rubric...`)

  const entries = buildRubric(evalRows)

  if (entries.length === 0) {
    console.log("\n⚠️  No rubric scores found.")
    return
  }

  // ── Console output ──────────────────────────────────────────────
  console.log("\n📊 Rubric Scores by Approach (sorted by Overall):\n")
  console.table(entries.map(e => ({
    "Approach": e.approach,
    "n": e.n,
    "Faithfulness": fmt(e.faithfulness, 2),
    "Coverage": fmt(e.coverage, 2),
    "Fluency": fmt(e.fluency, 2),
    "Conciseness": fmt(e.conciseness, 2),
    "Overall": fmt(e.overall, 2),
  })))

  // ── Markdown report ─────────────────────────────────────────────
  const md: string[] = []
  md.push("# Trục B.1 — LLM-Judge Rubric Scores (FLASK-derived)")
  md.push("")
  md.push(`> Generated: ${new Date().toISOString()}`)
  md.push("")
  md.push("Mỗi dimension được chấm 1–5 bởi LLM judge. Giá trị là mean ± stdev.")
  md.push("")
  md.push("## Table 4.2 — Rubric Scores per Approach")
  md.push("")
  md.push(mdTable(
    ["Approach (mode | model)", "n", "Faithfulness", "Coverage", "Fluency", "Conciseness", "Overall"],
    entries.map(e => [
      e.approach, String(e.n),
      fmt(e.faithfulness, 2), fmt(e.coverage, 2),
      fmt(e.fluency, 2), fmt(e.conciseness, 2), fmt(e.overall, 2),
    ]),
  ))
  md.push("")

  // Highlight best per dimension
  md.push("### Best per dimension")
  md.push("")
  const dims = ["faithfulness", "coverage", "fluency", "conciseness", "overall"] as const
  for (const dim of dims) {
    const best = entries.reduce((a, b) => ((a[dim] ?? 0) > (b[dim] ?? 0) ? a : b))
    md.push(`- **${dim}**: ${best.approach} (${fmt(best[dim], 2)})`)
  }
  md.push("")

  writeReport("axis-b1-rubric-scores.md", md.join("\n"))
}

main().catch(err => {
  console.error("FATAL:", err)
  process.exit(1)
})
