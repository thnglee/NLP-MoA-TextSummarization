#!/usr/bin/env tsx
/**
 * 01-axis-a-report.ts — Trục A: Content Retention Metrics
 *
 * Maps to: Table 4.1 trong thesis (ROUGE-1, ROUGE-L, BLEU, BERTScore, Compression)
 *
 * Query evaluation_metrics, group by (mode, model), tính mean cho mỗi metric.
 * So sánh fusion vs từng model đơn lẻ.
 *
 * Usage:
 *   cd demo
 *   npx tsx from-database/01-axis-a-report.ts
 *   npx tsx from-database/01-axis-a-report.ts --help
 */

import {
  banner, showHelp, fmt, approachKey, meanOrNull,
  mdTable, writeReport, fetchAllEvalRows,
  type EvalRow,
} from "./_shared"

showHelp(`
Usage: npx tsx from-database/01-axis-a-report.ts [options]

Options:
  --help       Show this help message

Description:
  Trục A: Content Retention — so sánh metrics giữ lại nội dung (ROUGE-1,
  ROUGE-L, BLEU, BERTScore, Compression) của fused so với từng mô hình đơn lẻ.

  Output: console table + reports/axis-a-content-retention.md
`)

interface AxisAEntry {
  approach: string
  mode: string
  model: string
  n: number
  rouge1: number | null
  rouge2: number | null
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
      approach,
      mode: rs[0].mode ?? "—",
      model: rs[0].model ?? "—",
      n: rs.length,
      rouge1: meanOrNull(rs.map(r => r.rouge_1)),
      rouge2: meanOrNull(rs.map(r => r.rouge_2)),
      rougeL: meanOrNull(rs.map(r => r.rouge_l)),
      bleu: meanOrNull(rs.map(r => r.bleu)),
      bert: meanOrNull(rs.map(r => r.bert_score)),
      compression: meanOrNull(rs.map(r => r.compression_rate)),
    })
  }
  // Sort: best BERTScore first
  entries.sort((a, b) => (b.bert ?? -Infinity) - (a.bert ?? -Infinity))
  return entries
}

async function main() {
  banner("TRỤC A — Content Retention Metrics")

  console.log("\n⏳ Fetching evaluation_metrics from Supabase...")
  const evalRows = await fetchAllEvalRows()
  console.log(`  → ${evalRows.length} rows fetched`)

  const entries = buildAxisA(evalRows)

  if (entries.length === 0) {
    console.log("\n⚠️  No data found in evaluation_metrics.")
    return
  }

  // ── Console output ──────────────────────────────────────────────
  console.log("\n📊 Content Retention by Approach (sorted by BERTScore):\n")

  const tableData = entries.map(e => ({
    "Approach": e.approach,
    "n": e.n,
    "ROUGE-1": fmt(e.rouge1, 4),
    "ROUGE-2": fmt(e.rouge2, 4),
    "ROUGE-L": fmt(e.rougeL, 4),
    "BLEU": fmt(e.bleu, 4),
    "BERTScore": fmt(e.bert, 4),
    "Compression%": fmt(e.compression, 2),
  }))
  console.table(tableData)

  // ── Find fused entry for delta comparison ───────────────────────
  const fused = entries.find(e => e.mode === "fusion")
  if (fused) {
    console.log("\n📈 Δ (Fused − model đơn lẻ):\n")
    const deltaRows = entries
      .filter(e => e.mode !== "fusion")
      .map(e => ({
        "vs": e.approach,
        "Δ ROUGE-1": fmt((fused.rouge1 ?? 0) - (e.rouge1 ?? 0), 4),
        "Δ ROUGE-L": fmt((fused.rougeL ?? 0) - (e.rougeL ?? 0), 4),
        "Δ BLEU": fmt((fused.bleu ?? 0) - (e.bleu ?? 0), 4),
        "Δ BERTScore": fmt((fused.bert ?? 0) - (e.bert ?? 0), 4),
      }))
    console.table(deltaRows)
  }

  // ── Markdown report ─────────────────────────────────────────────
  const md: string[] = []
  md.push("# Trục A — Content Retention Metrics")
  md.push("")
  md.push(`> Generated: ${new Date().toISOString()}`)
  md.push(`> Total rows: ${evalRows.length}`)
  md.push("")
  md.push("> **Lưu ý:** ROUGE / BLEU / BERTScore được tính so với bài gốc (không phải")
  md.push("> tóm tắt tham chiếu). Chúng đo content retention, không phải chất lượng tóm tắt.")
  md.push("> Axis B là tín hiệu chính; Axis A chỉ là bổ sung.")
  md.push("")
  md.push("## Table 4.1 — Content Retention by Approach")
  md.push("")
  md.push(mdTable(
    ["Approach (mode | model)", "n", "ROUGE-1", "ROUGE-2", "ROUGE-L", "BLEU", "BERTScore", "Compression %"],
    entries.map(e => [
      e.approach, String(e.n),
      fmt(e.rouge1, 4), fmt(e.rouge2, 4), fmt(e.rougeL, 4),
      fmt(e.bleu, 4), fmt(e.bert, 4), fmt(e.compression, 2),
    ]),
  ))
  md.push("")

  if (fused) {
    md.push("## Δ (Fused − Từng model đơn lẻ)")
    md.push("")
    const singles = entries.filter(e => e.mode !== "fusion")
    md.push(mdTable(
      ["vs", "Δ ROUGE-1", "Δ ROUGE-L", "Δ BLEU", "Δ BERTScore"],
      singles.map(e => [
        e.approach,
        fmt((fused.rouge1 ?? 0) - (e.rouge1 ?? 0), 4),
        fmt((fused.rougeL ?? 0) - (e.rougeL ?? 0), 4),
        fmt((fused.bleu ?? 0) - (e.bleu ?? 0), 4),
        fmt((fused.bert ?? 0) - (e.bert ?? 0), 4),
      ]),
    ))
    md.push("")
  }

  writeReport("axis-a-content-retention.md", md.join("\n"))
}

main().catch(err => {
  console.error("FATAL:", err)
  process.exit(1)
})
