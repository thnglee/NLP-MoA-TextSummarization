#!/usr/bin/env tsx
/**
 * 04-axis-b-fused-vs-each.ts — Trục B.2b: Fused vs Each Draft Model
 *
 * Maps to: Table 4.4 trong thesis
 *
 * Query llm_judge_pairwise WHERE comparison_type = 'vs_individual_draft'.
 * Group by draft model, tính fused win rate + sign-test p.
 * Length-bucketed control.
 *
 * Usage:
 *   cd demo
 *   npx tsx from-database/04-axis-b-fused-vs-each.ts
 */

import {
  banner, showHelp, fmt, fmtPct, mdTable, writeReport, fetchAllPairwiseRows,
  type PairwiseRow,
} from "./_shared"

import { signTestPValue, lengthBucketedWinRate, type LengthBucketedVerdict } from "../../backend/output-fusion/scripts/stats"

showHelp(`
Usage: npx tsx from-database/04-axis-b-fused-vs-each.ts [options]

Options:
  --help       Show this help message

Description:
  Trục B.2b: Fused vs each individual proposer draft.
  Per-proposer breakdown: fused win rate, sign-test p.
  Output: console + reports/axis-b2b-fused-vs-each-draft.md
`)

const INDIVIDUAL_DRAFT_PREFIX = "individual_draft:"

interface DraftEntry {
  draft_model: string
  n: number
  fused_wins: number
  draft_wins: number
  ties: number
  fused_win_rate: number
  sign_test_p: number | null
  judge_models: string[]
}

function buildFusedVsEach(rows: PairwiseRow[]): DraftEntry[] {
  const filtered = rows.filter(r => r.comparison_type === "vs_individual_draft")
  const groups = new Map<string, PairwiseRow[]>()
  for (const r of filtered) {
    if (!r.summary_b_label.startsWith(INDIVIDUAL_DRAFT_PREFIX)) continue
    const draftModel = r.summary_b_label.slice(INDIVIDUAL_DRAFT_PREFIX.length)
    if (!groups.has(draftModel)) groups.set(draftModel, [])
    groups.get(draftModel)!.push(r)
  }
  const entries: DraftEntry[] = []
  for (const [draftModel, rs] of groups) {
    let fused_wins = 0, draft_wins = 0, ties = 0
    for (const r of rs) {
      if (r.winner === "A") fused_wins++
      else if (r.winner === "B") draft_wins++
      else ties++
    }
    const decisive = fused_wins + draft_wins
    entries.push({
      draft_model: draftModel,
      n: rs.length,
      fused_wins,
      draft_wins,
      ties,
      fused_win_rate: decisive > 0 ? fused_wins / decisive : 0,
      sign_test_p: decisive > 0 ? signTestPValue(Math.max(fused_wins, draft_wins), decisive) : null,
      judge_models: Array.from(new Set(rs.map(r => r.judge_model).filter(Boolean))) as string[],
    })
  }
  entries.sort((a, b) => b.fused_win_rate - a.fused_win_rate)
  return entries
}

async function main() {
  banner("TRỤC B.2b — Fused vs Each Proposer Draft")

  console.log("\n⏳ Fetching llm_judge_pairwise from Supabase...")
  const pairwiseRows = await fetchAllPairwiseRows()
  console.log(`  → ${pairwiseRows.length} total pairwise rows`)

  const entries = buildFusedVsEach(pairwiseRows)

  if (entries.length === 0) {
    console.log("\n⚠️  No vs_individual_draft verdicts found.")
    console.log("   Run `collect-metrics --judge-vs-all` to populate.")
    return
  }

  // ── Console output ──────────────────────────────────────────────
  console.log("\n📊 Fused vs Each Draft — Per-proposer Breakdown:\n")
  console.table(entries.map(e => ({
    "Proposer": e.draft_model,
    "n": e.n,
    "Fused wins": e.fused_wins,
    "Draft wins": e.draft_wins,
    "Ties": e.ties,
    "Fused win rate": fmtPct(e.fused_win_rate),
    "Sign-test p": e.sign_test_p != null ? e.sign_test_p.toFixed(4) : "—",
  })))

  // Overall fused win rate
  const totalFused = entries.reduce((s, e) => s + e.fused_wins, 0)
  const totalDraft = entries.reduce((s, e) => s + e.draft_wins, 0)
  const totalTies = entries.reduce((s, e) => s + e.ties, 0)
  const totalDecisive = totalFused + totalDraft
  console.log(`\n📈 Overall: Fused wins ${totalFused}, Draft wins ${totalDraft}, Ties ${totalTies}`)
  if (totalDecisive > 0) {
    console.log(`   Fused win rate: ${((totalFused / totalDecisive) * 100).toFixed(1)}%`)
  }

  // ── Markdown report ─────────────────────────────────────────────
  const md: string[] = []
  md.push("# Trục B.2b — Fused vs Each Proposer Draft")
  md.push("")
  md.push(`> Generated: ${new Date().toISOString()}`)
  md.push("")
  md.push("Per-proposer breakdown: fused win rate against each individual draft.")
  md.push("Sign test: hai phía, loại bỏ ties, H₀: P(fused wins) = 0.5.")
  md.push("")
  md.push("## Table 4.4 — Fused vs Each Draft")
  md.push("")
  md.push(mdTable(
    ["Proposer model", "n", "Fused wins", "Draft wins", "Ties", "Fused win rate", "Sign-test p", "Judge model(s)"],
    entries.map(e => [
      e.draft_model, String(e.n), String(e.fused_wins), String(e.draft_wins), String(e.ties),
      fmtPct(e.fused_win_rate),
      e.sign_test_p != null
        ? `${e.sign_test_p.toFixed(4)}${(e.fused_wins + e.draft_wins) < 5 ? " ⚠" : ""}`
        : "—",
      e.judge_models.join(", ") || "—",
    ]),
  ))
  md.push("")
  md.push("⚠ = fewer than 5 decisive verdicts; sign-test power quá thấp.")
  md.push("")
  md.push("## Summary")
  md.push("")
  md.push(`- **Overall**: Fused wins ${totalFused}, Draft wins ${totalDraft}, Ties ${totalTies}`)
  if (totalDecisive > 0) {
    md.push(`- **Fused win rate**: ${((totalFused / totalDecisive) * 100).toFixed(1)}%`)
  }
  md.push("")

  writeReport("axis-b2b-fused-vs-each-draft.md", md.join("\n"))
}

main().catch(err => {
  console.error("FATAL:", err)
  process.exit(1)
})
