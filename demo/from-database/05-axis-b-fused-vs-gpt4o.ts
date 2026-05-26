#!/usr/bin/env tsx
/**
 * 05-axis-b-fused-vs-gpt4o.ts — Trục B.2c: Fused vs GPT-4o Alone
 *
 * Maps to: Table 4.5 trong thesis (thesis-decisive comparison)
 *
 * Query llm_judge_pairwise WHERE comparison_type = 'vs_single_aggregator'.
 * Isolates synthesis behavior from aggregator model capability.
 *
 * Usage:
 *   cd demo
 *   npx tsx from-database/05-axis-b-fused-vs-gpt4o.ts
 */

import {
  banner, showHelp, fmt, fmtPct, mdTable, writeReport, fetchAllPairwiseRows,
  type PairwiseRow,
} from "./_shared"

import { signTestPValue } from "../../backend/output-fusion/scripts/stats"

showHelp(`
Usage: npx tsx from-database/05-axis-b-fused-vs-gpt4o.ts [options]

Options:
  --help       Show this help message

Description:
  Trục B.2c: Fused vs GPT-4o alone — thesis-decisive comparison.
  Cô lập hành vi synthesis khỏi capability của model aggregator.
  Output: console + reports/axis-b2c-fused-vs-gpt4o.md
`)

async function main() {
  banner("TRỤC B.2c — Fused vs GPT-4o Alone (thesis-decisive)")

  console.log("\n⏳ Fetching llm_judge_pairwise from Supabase...")
  const pairwiseRows = await fetchAllPairwiseRows()
  console.log(`  → ${pairwiseRows.length} total pairwise rows`)

  const filtered = pairwiseRows.filter(r => r.comparison_type === "vs_single_aggregator")

  if (filtered.length === 0) {
    console.log("\n⚠️  No vs_single_aggregator verdicts found.")
    console.log("   Run `run-single-baseline.ts` then `compare-fused-vs-single.ts` first.")
    return
  }

  let fused_wins = 0, single_wins = 0, ties = 0
  for (const r of filtered) {
    // Convention: A=fused, B=single_aggregator
    if (r.winner === "A") fused_wins++
    else if (r.winner === "B") single_wins++
    else ties++
  }
  const decisive = fused_wins + single_wins
  const fused_win_rate = decisive > 0 ? fused_wins / decisive : 0
  const sign_test_p = decisive > 0 ? signTestPValue(Math.max(fused_wins, single_wins), decisive) : null
  const judge_models = Array.from(new Set(filtered.map(r => r.judge_model).filter(Boolean))) as string[]

  // ── Console output ──────────────────────────────────────────────
  console.log("\n📊 Fused vs GPT-4o Alone — Pairwise Results:\n")
  console.log(`  Total verdicts:    ${filtered.length}`)
  console.log(`  Fused wins:        ${fused_wins}`)
  console.log(`  Single wins:       ${single_wins}`)
  console.log(`  Ties:              ${ties}`)
  console.log(`  Fused win rate:    ${fmtPct(fused_win_rate)}`)
  console.log(`  Sign-test p:       ${sign_test_p != null ? sign_test_p.toFixed(4) : "—"}`)
  console.log(`  Judge model(s):    ${judge_models.join(", ")}`)

  if (sign_test_p != null && sign_test_p < 0.05) {
    console.log(`\n  ✅ STATISTICALLY SIGNIFICANT — fusion adds value beyond GPT-4o alone.`)
  } else if (sign_test_p != null) {
    console.log(`\n  ⚠️  Not statistically significant (p = ${sign_test_p.toFixed(4)}).`)
  }

  // ── Markdown report ─────────────────────────────────────────────
  const md: string[] = []
  md.push("# Trục B.2c — Fused vs GPT-4o Alone (Thesis-Decisive)")
  md.push("")
  md.push(`> Generated: ${new Date().toISOString()}`)
  md.push("")
  md.push("**Câu hỏi quyết định:** Fusion có thêm giá trị so với việc chạy riêng")
  md.push("GPT-4o (model aggregator) không? Cả hai candidates đều từ GPT-4o,")
  md.push("nên judge bias do cùng family bị triệt tiêu.")
  md.push("")
  md.push("Sign test: hai phía, loại bỏ ties, H₀: P(fused wins) = 0.5.")
  md.push("")
  md.push("## Table 4.5 — Fused vs GPT-4o Alone")
  md.push("")
  md.push(mdTable(
    ["n", "Fused wins", "Single wins", "Ties", "Fused win rate", "Sign-test p", "Judge model(s)"],
    [[
      String(filtered.length), String(fused_wins), String(single_wins), String(ties),
      fmtPct(fused_win_rate),
      sign_test_p != null
        ? `${sign_test_p.toFixed(4)}${decisive < 5 ? " ⚠" : ""}`
        : "—",
      judge_models.join(", ") || "—",
    ]],
  ))
  md.push("")

  // Interpretation
  md.push("## Interpretation")
  md.push("")
  if (sign_test_p != null && sign_test_p < 0.05) {
    md.push(`✅ **Kết quả có ý nghĩa thống kê** (p = ${sign_test_p.toFixed(4)}, p < 0.05).`)
    md.push("")
    md.push(`Fusion (MoA) win rate = ${fmtPct(fused_win_rate)} so với GPT-4o alone.`)
    md.push("Điều này chứng minh rằng multi-agent synthesis tạo ra output tốt hơn")
    md.push("so với single-model approach, ngay cả khi cùng dùng GPT-4o.")
  } else if (sign_test_p != null) {
    md.push(`⚠️ **Chưa đạt ý nghĩa thống kê** (p = ${sign_test_p.toFixed(4)}, cần p < 0.05).`)
    md.push("")
    md.push(`Fused win rate = ${fmtPct(fused_win_rate)}, nhưng sample size (n=${decisive}) có thể chưa đủ.`)
  }
  md.push("")
  md.push("⚠ = fewer than 5 decisive verdicts; sign-test power quá thấp.")
  md.push("")

  writeReport("axis-b2c-fused-vs-gpt4o.md", md.join("\n"))
}

main().catch(err => {
  console.error("FATAL:", err)
  process.exit(1)
})
