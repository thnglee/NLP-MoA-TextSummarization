#!/usr/bin/env tsx
/**
 * 06-axis-b-factuality.ts — Trục B.3: Factuality (Entailment)
 *
 * Maps to: Table 4.6 trong thesis
 *
 * Query evaluation_metrics WHERE factuality_entailed_ratio IS NOT NULL.
 * Group by (mode, model), tính entailment %, avg hallucinations, worst case.
 *
 * Usage:
 *   cd demo
 *   npx tsx from-database/06-axis-b-factuality.ts
 */

import {
  banner, showHelp, fmt, fmtPctRaw, approachKey, meanOrNull,
  mdTable, writeReport, fetchAllEvalRows,
  type EvalRow,
} from "./_shared"

showHelp(`
Usage: npx tsx from-database/06-axis-b-factuality.ts [options]

Options:
  --help       Show this help message

Description:
  Trục B.3: Factuality — tỷ lệ entailment (claim-based) per model.
  Tính entailment %, avg hallucinations, worst case per approach.
  Output: console table + reports/axis-b3-factuality.md
`)

interface FactualityEntry {
  approach: string
  mode: string
  model: string
  n: number
  entailment_pct: number | null
  avg_hallucinations: number | null
  worst_case: number
  total_claims_avg: number | null
}

function buildFactuality(rows: EvalRow[]): FactualityEntry[] {
  const groups = new Map<string, EvalRow[]>()
  for (const r of rows) {
    if (r.factuality_entailed_ratio == null) continue
    const k = approachKey(r.mode, r.model)
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k)!.push(r)
  }
  const entries: FactualityEntry[] = []
  for (const [approach, rs] of groups) {
    const entailment = meanOrNull(rs.map(r => r.factuality_entailed_ratio))
    const hallCounts = rs.map(r =>
      Array.isArray(r.factuality_hallucinations)
        ? r.factuality_hallucinations.length
        : 0,
    )
    entries.push({
      approach,
      mode: rs[0].mode ?? "—",
      model: rs[0].model ?? "—",
      n: rs.length,
      entailment_pct: entailment == null ? null : entailment * 100,
      avg_hallucinations: meanOrNull(hallCounts),
      worst_case: hallCounts.reduce((m, c) => Math.max(m, c), 0),
      total_claims_avg: meanOrNull(rs.map(r => r.factuality_total_claims)),
    })
  }
  entries.sort(
    (a, b) => (b.entailment_pct ?? -Infinity) - (a.entailment_pct ?? -Infinity),
  )
  return entries
}

async function main() {
  banner("TRỤC B.3 — Factuality (Claim-Entailment)")

  console.log("\n⏳ Fetching evaluation_metrics from Supabase...")
  const evalRows = await fetchAllEvalRows()
  console.log(`  → ${evalRows.length} total rows, filtering for factuality...`)

  const entries = buildFactuality(evalRows)

  if (entries.length === 0) {
    console.log("\n⚠️  No factuality scores found.")
    return
  }

  // ── Console output ──────────────────────────────────────────────
  console.log("\n📊 Factuality by Approach (sorted by entailment %):\n")
  console.table(entries.map(e => ({
    "Approach": e.approach,
    "n": e.n,
    "Entailment %": fmtPctRaw(e.entailment_pct),
    "Avg hallucinations": fmt(e.avg_hallucinations, 2),
    "Worst case": e.worst_case,
    "Avg claims": fmt(e.total_claims_avg, 1),
  })))

  // ── Per-request factuality ─────────────────────────────────────
  console.log("\n📋 Factuality per request (tất cả rows):\n")
  const perRequest = evalRows
    .filter(r => r.factuality_entailed_ratio != null)
    .map(r => ({
      "URL": (r.url ?? "").slice(0, 60),
      "Mode": r.mode,
      "Model": r.model,
      "Entailment": fmtPctRaw((r.factuality_entailed_ratio ?? 0) * 100),
      "Hallucinations": Array.isArray(r.factuality_hallucinations)
        ? r.factuality_hallucinations.length
        : 0,
    }))
  if (perRequest.length <= 30) {
    console.table(perRequest)
  } else {
    console.table(perRequest.slice(0, 15))
    console.log(`  ... và ${perRequest.length - 15} rows nữa (xem report file)`)
  }

  // ── Markdown report ─────────────────────────────────────────────
  const md: string[] = []
  md.push("# Trục B.3 — Factuality (Claim-Entailment via gpt-4o-mini)")
  md.push("")
  md.push(`> Generated: ${new Date().toISOString()}`)
  md.push("")
  md.push("Mỗi claim trong summary được kiểm tra xem có entailed bởi bài gốc không.")
  md.push("Entailment % = tỷ lệ claims được xác nhận. Hallucinations = claims không supported.")
  md.push("")
  md.push("## Table 4.6 — Factuality by Approach")
  md.push("")
  md.push(mdTable(
    ["Approach (mode | model)", "n", "Entailment %", "Avg hallucinations", "Worst case", "Avg claims"],
    entries.map(e => [
      e.approach, String(e.n),
      fmtPctRaw(e.entailment_pct),
      fmt(e.avg_hallucinations, 2),
      String(e.worst_case),
      fmt(e.total_claims_avg, 1),
    ]),
  ))
  md.push("")

  // Per-request detail table
  md.push("## Per-request Factuality")
  md.push("")
  md.push("<details><summary>Chi tiết từng request</summary>")
  md.push("")
  const allFactRows = evalRows.filter(r => r.factuality_entailed_ratio != null)
  md.push(mdTable(
    ["URL", "Mode", "Model", "Entailment %", "Hallucinations", "Total claims"],
    allFactRows.map(r => [
      (r.url ?? "—").replace(/\|/g, "\\|"),
      r.mode ?? "—",
      r.model ?? "—",
      fmtPctRaw((r.factuality_entailed_ratio ?? 0) * 100),
      String(Array.isArray(r.factuality_hallucinations) ? r.factuality_hallucinations.length : 0),
      String(r.factuality_total_claims ?? 0),
    ]),
  ))
  md.push("")
  md.push("</details>")
  md.push("")

  writeReport("axis-b3-factuality.md", md.join("\n"))
}

main().catch(err => {
  console.error("FATAL:", err)
  process.exit(1)
})
