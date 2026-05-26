#!/usr/bin/env tsx
/**
 * 04-generate-live-report.ts — Live-run report
 *
 * Uses the shared logic to generate a report from the live-run data.
 * Requires the `--since` timestamp to only query the live-run rows.
 *
 * Usage:
 *   cd demo
 *   npx tsx live-run/04-generate-live-report.ts --since "2026-05-25T15:25:00Z"
 */

import {
  banner, showHelp, getArg, fmt, fmtPct, mdTable, writeReport, approachKey, meanOrNull,
  fetchAllEvalRows, fetchAllPairwiseRows,
} from "../from-database/_shared"
import { signTestPValue } from "../../backend/output-fusion/scripts/stats"

showHelp(`
Usage: npx tsx live-run/04-generate-live-report.ts --since "TIMESTAMP"

Description:
  Generates a Markdown report summarizing the Live-Run results.
`)

const SINCE = getArg("since")
if (!SINCE) {
  console.error("❌ Please provide --since timestamp from script 01.")
  process.exit(1)
}

async function main() {
  banner("LIVE-RUN: GENERATE REPORT")
  console.log(`Filtering for runs since: ${SINCE}`)

  const allEval = await fetchAllEvalRows()
  const allPair = await fetchAllPairwiseRows()

  const evals = allEval.filter(r => r.created_at >= SINCE)
  const pairs = allPair.filter(r => r.created_at >= SINCE && r.comparison_type === "vs_single_aggregator")

  console.log(`Found ${evals.length} eval rows and ${pairs.length} pairwise verdicts.`)

  // 1. Build Rubric table
  const groups = new Map<string, any[]>()
  for (const r of evals) {
    if (!r.judge_rubric) continue
    const k = approachKey(r.mode, r.model)
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k)!.push(r)
  }
  const rubricRows = Array.from(groups.entries()).map(([app, rs]) => [
    app, String(rs.length),
    fmt(meanOrNull(rs.map(r => r.judge_rubric?.faithfulness))),
    fmt(meanOrNull(rs.map(r => r.judge_rubric?.coverage))),
    fmt(meanOrNull(rs.map(r => r.judge_rubric?.fluency))),
    fmt(meanOrNull(rs.map(r => r.judge_rubric?.conciseness))),
    fmt(meanOrNull(rs.map(r => r.judge_rubric?.overall))),
  ])

  // 2. Build Pairwise stats
  let f = 0, s = 0, t = 0
  for (const r of pairs) {
    if (r.winner === "A") f++; else if (r.winner === "B") s++; else t++
  }
  const dec = f + s
  const winRate = dec > 0 ? f / dec : 0
  const p = dec > 0 ? signTestPValue(Math.max(f, s), dec) : null

  const pairRow = [
    "vs GPT-4o alone", String(pairs.length), String(f), String(s), String(t),
    fmtPct(winRate), p != null ? p.toFixed(4) : "—"
  ]

  // Output MD
  const md: string[] = []
  md.push("# Demo Live-Run Report")
  md.push(`> Start timestamp: ${SINCE}`)
  md.push(`> Generated at: ${new Date().toISOString()}`)
  md.push("")
  md.push("## LLM-Judge Rubric (1-5)")
  md.push(mdTable(["Approach", "n", "Faithfulness", "Coverage", "Fluency", "Conciseness", "Overall"], rubricRows))
  md.push("")
  md.push("## Pairwise (Fused vs GPT-4o Alone)")
  md.push(mdTable(["Comparison", "n", "Fused wins", "Single wins", "Ties", "Win rate", "Sign-test p"], [pairRow]))
  md.push("")

  if (p != null && p < 0.05) md.push(`**✅ Statistically significant result (p < 0.05)!**`)
  else if (p != null) md.push(`⚠️ Result is not statistically significant (p = ${p.toFixed(4)})`)
  md.push("")

  writeReport(`live-run-${SINCE.replace(/[:.]/g, "-")}.md`, md.join("\n"))
}

main().catch(console.error)
