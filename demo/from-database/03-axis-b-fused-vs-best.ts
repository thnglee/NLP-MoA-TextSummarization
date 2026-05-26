#!/usr/bin/env tsx
/**
 * 03-axis-b-fused-vs-best.ts — Trục B.2a: Fused vs Best Single Draft
 *
 * Maps to: Table 4.3 trong thesis
 *
 * Query llm_judge_pairwise WHERE comparison_type = 'vs_best_draft'.
 * Tính wins/losses/ties + sign-test p-value.
 *
 * Usage:
 *   cd demo
 *   npx tsx from-database/03-axis-b-fused-vs-best.ts
 */

import {
  banner, showHelp, fmt, mdTable, writeReport, fetchAllPairwiseRows,
  type PairwiseRow,
} from "./_shared"

// Import sign test from the backend stats
import { signTestPValue } from "../../backend/output-fusion/scripts/stats"

showHelp(`
Usage: npx tsx from-database/03-axis-b-fused-vs-best.ts [options]

Options:
  --help       Show this help message

Description:
  Trục B.2a: Fused vs best single draft — pairwise LLM-judge comparison.
  Output: console + reports/axis-b2a-fused-vs-best-draft.md
`)

interface PairEntry {
  pair: string
  n: number
  a_wins: number
  b_wins: number
  ties: number
  winner: string
  sign_test_p: number | null
  n_decisive: number
  judge_models: string[]
}

function buildFusedVsBest(rows: PairwiseRow[]): PairEntry[] {
  const filtered = rows.filter(
    r => (r.comparison_type ?? "vs_best_draft") === "vs_best_draft",
  )
  const groups = new Map<string, PairwiseRow[]>()
  for (const r of filtered) {
    const pair = `${r.summary_a_label} vs ${r.summary_b_label}`
    if (!groups.has(pair)) groups.set(pair, [])
    groups.get(pair)!.push(r)
  }
  const entries: PairEntry[] = []
  for (const [pair, rs] of groups) {
    let a = 0, b = 0, t = 0
    for (const r of rs) {
      if (r.winner === "A") a++
      else if (r.winner === "B") b++
      else t++
    }
    const winner =
      a === b ? "tie"
        : a > b ? `A (${rs[0].summary_a_label})`
          : `B (${rs[0].summary_b_label})`
    const models = Array.from(new Set(rs.map(r => r.judge_model).filter(Boolean))) as string[]
    const decisive = a + b
    const wins = Math.max(a, b)
    entries.push({
      pair,
      n: rs.length,
      a_wins: a,
      b_wins: b,
      ties: t,
      winner,
      sign_test_p: decisive > 0 ? signTestPValue(wins, decisive) : null,
      n_decisive: decisive,
      judge_models: models,
    })
  }
  entries.sort((a, b) => b.n - a.n)
  return entries
}

async function main() {
  banner("TRỤC B.2a — Fused vs Best Single Draft")

  console.log("\n⏳ Fetching llm_judge_pairwise from Supabase...")
  const pairwiseRows = await fetchAllPairwiseRows()
  console.log(`  → ${pairwiseRows.length} total pairwise rows`)

  const entries = buildFusedVsBest(pairwiseRows)

  if (entries.length === 0) {
    console.log("\n⚠️  No vs_best_draft verdicts found.")
    return
  }

  // ── Console output ──────────────────────────────────────────────
  console.log("\n📊 Fused vs Best Draft — Pairwise Results:\n")
  console.table(entries.map(e => ({
    "Pair": e.pair,
    "n": e.n,
    "A wins": e.a_wins,
    "B wins": e.b_wins,
    "Ties": e.ties,
    "Winner": e.winner,
    "Sign-test p": e.sign_test_p != null ? e.sign_test_p.toFixed(4) : "—",
    "Judge(s)": e.judge_models.join(", "),
  })))

  // ── Markdown report ─────────────────────────────────────────────
  const md: string[] = []
  md.push("# Trục B.2a — Fused vs Best Single Draft")
  md.push("")
  md.push(`> Generated: ${new Date().toISOString()}`)
  md.push("")
  md.push("Sign test: hai phía, loại bỏ ties, H₀: P(A wins) = 0.5.")
  md.push("p < 0.05 = kết quả có ý nghĩa thống kê.")
  md.push("")
  md.push("## Table 4.3 — Fused vs Best Draft Pairwise")
  md.push("")
  md.push(mdTable(
    ["Pair", "n", "A-wins", "B-wins", "Ties", "Winner", "Sign-test p", "Judge model(s)"],
    entries.map(e => [
      e.pair, String(e.n), String(e.a_wins), String(e.b_wins), String(e.ties),
      e.winner,
      e.sign_test_p != null
        ? `${e.sign_test_p.toFixed(4)}${e.n_decisive < 5 ? " ⚠" : ""}`
        : "—",
      e.judge_models.join(", ") || "—",
    ]),
  ))
  md.push("")
  md.push("⚠ = fewer than 5 decisive verdicts; sign-test power quá thấp.")
  md.push("")

  // Summary interpretation
  for (const e of entries) {
    const pctA = e.n_decisive > 0 ? ((e.a_wins / e.n_decisive) * 100).toFixed(1) : "0"
    md.push(`**${e.pair}**: Fused win rate = ${pctA}% (${e.a_wins}/${e.n_decisive} decisive).`)
    if (e.sign_test_p != null && e.sign_test_p < 0.05) {
      md.push(`  → ✅ Statistically significant (p = ${e.sign_test_p.toFixed(4)})`)
    } else if (e.sign_test_p != null) {
      md.push(`  → ⚠️ Not significant (p = ${e.sign_test_p.toFixed(4)})`)
    }
    md.push("")
  }

  writeReport("axis-b2a-fused-vs-best-draft.md", md.join("\n"))
}

main().catch(err => {
  console.error("FATAL:", err)
  process.exit(1)
})
