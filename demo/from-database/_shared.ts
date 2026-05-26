#!/usr/bin/env tsx
/**
 * _shared.ts — Shared code for all from-database demo scripts.
 *
 * Provides:
 *   - Supabase client (reads backend/.env automatically)
 *   - CLI arg parsing helpers
 *   - Formatting utilities (tables, percentages, etc.)
 *   - Report file writer (saves MD to demo/reports/)
 */

import * as fs from "node:fs"
import * as path from "node:path"
import { config as loadDotenv } from "dotenv"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"

// ─── Bootstrap env ─────────────────────────────────────────────────────────

// Load from backend/.env (2 levels up from demo/from-database/)
loadDotenv({ path: path.resolve(__dirname, "../../backend/.env") })

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    "❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.\n" +
      "   Make sure backend/.env exists with the correct values.",
  )
  process.exit(1)
}

export const supabase: SupabaseClient = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
)

// ─── CLI helpers ───────────────────────────────────────────────────────────

const cliArgs = process.argv.slice(2)

export function getArg(name: string, fallback = ""): string {
  const idx = cliArgs.indexOf(`--${name}`)
  return idx !== -1 && cliArgs[idx + 1] ? cliArgs[idx + 1] : fallback
}

export function getIntArg(name: string, fallback: number): number {
  const raw = getArg(name)
  if (!raw) return fallback
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

export function hasFlag(name: string): boolean {
  return cliArgs.includes(`--${name}`)
}

export function showHelp(usage: string): void {
  if (hasFlag("help") || hasFlag("h")) {
    console.log(usage)
    process.exit(0)
  }
}

// ─── Formatting ────────────────────────────────────────────────────────────

/** Format a number with fixed digits, or "—" for null/NaN. */
export function fmt(n: number | null | undefined, digits = 3): string {
  if (n == null || !Number.isFinite(n)) return "—"
  return n.toFixed(digits)
}

/** Format a percentage (0-1 → "xx.x%"). */
export function fmtPct(n: number | null | undefined, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return "—"
  return (n * 100).toFixed(digits) + "%"
}

/** Format a number already in percent range. */
export function fmtPctRaw(n: number | null | undefined, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return "—"
  return n.toFixed(digits) + "%"
}

/** Approach key from (mode, model). */
export function approachKey(mode: string | null, model: string | null): string {
  return `${mode ?? "—"} | ${model ?? "—"}`
}

/** Mean of an array, skipping null/NaN. Returns null if empty. */
export function meanOrNull(nums: Array<number | null | undefined>): number | null {
  const vals = nums.filter(
    (n): n is number => typeof n === "number" && Number.isFinite(n),
  )
  if (vals.length === 0) return null
  return vals.reduce((a, b) => a + b, 0) / vals.length
}

// ─── Markdown table helpers ────────────────────────────────────────────────

/** Build a Markdown table from headers + rows. */
export function mdTable(headers: string[], rows: string[][]): string {
  const lines: string[] = []
  lines.push("| " + headers.join(" | ") + " |")
  lines.push("| " + headers.map(() => "---").join(" | ") + " |")
  for (const row of rows) {
    lines.push("| " + row.join(" | ") + " |")
  }
  return lines.join("\n")
}

// ─── Report writer ─────────────────────────────────────────────────────────

const REPORTS_DIR = path.resolve(__dirname, "../reports")

/** Write a markdown report to demo/reports/<filename>. */
export function writeReport(filename: string, content: string): string {
  fs.mkdirSync(REPORTS_DIR, { recursive: true })
  const outputPath = path.join(REPORTS_DIR, filename)
  fs.writeFileSync(outputPath, content)
  console.log(`\n📝 Report saved → ${outputPath}`)
  return outputPath
}

// ─── Console banner ────────────────────────────────────────────────────────

export function banner(title: string): void {
  console.log("═".repeat(70))
  console.log(`  ${title}`)
  console.log("═".repeat(70))
}

// ─── Common types ──────────────────────────────────────────────────────────

export interface EvalRow {
  id: string
  created_at: string
  url: string | null
  mode: string | null
  model: string | null
  rouge_1: number | null
  rouge_2: number | null
  rouge_l: number | null
  bleu: number | null
  bert_score: number | null
  compression_rate: number | null
  summary_text: string | null
  original_text_length: number | null
  judge_rubric: {
    faithfulness?: number | null
    coverage?: number | null
    fluency?: number | null
    conciseness?: number | null
    overall?: number | null
  } | null
  judge_absolute: number | null
  factuality_total_claims: number | null
  factuality_entailed_claims: number | null
  factuality_entailed_ratio: number | null
  factuality_hallucinations: unknown[] | null
}

export interface PairwiseRow {
  id: string
  created_at: string
  summary_a_label: string
  summary_b_label: string
  winner: "A" | "B" | "tie" | string
  judge_model: string | null
  comparison_type: string | null
  fusion_id: string | null
}

export interface HumanEvalTaskRow {
  id: string
  created_at: string
  article_url: string
  summaries: Array<{
    label: string
    text: string
    hidden_model?: string
    hidden_mode?: string
  }>
  notes: string | null
}

export interface HumanEvalResponseRow {
  id: string
  task_id: string
  rater_id: string
  ranking: string[]
  rationale: Record<string, string>
  created_at: string
}

// ─── Common fetchers ───────────────────────────────────────────────────────

/** Fetch all evaluation_metrics rows with pagination. */
export async function fetchAllEvalRows(): Promise<EvalRow[]> {
  const all: EvalRow[] = []
  const PAGE = 1000
  let from = 0
  while (true) {
    const { data, error } = await supabase
      .from("evaluation_metrics")
      .select(
        [
          "id", "created_at", "url", "mode", "model",
          "rouge_1", "rouge_2", "rouge_l", "bleu", "bert_score",
          "compression_rate", "summary_text", "original_text_length",
          "judge_rubric", "judge_absolute",
          "factuality_total_claims", "factuality_entailed_claims",
          "factuality_entailed_ratio", "factuality_hallucinations",
        ].join(", "),
      )
      .order("created_at", { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`evaluation_metrics: ${error.message}`)
    const rows = (data ?? []) as unknown as EvalRow[]
    all.push(...rows)
    if (rows.length < PAGE) break
    from += PAGE
  }
  return all
}

/** Fetch all llm_judge_pairwise rows. */
export async function fetchAllPairwiseRows(): Promise<PairwiseRow[]> {
  const { data, error } = await supabase
    .from("llm_judge_pairwise")
    .select(
      "id, created_at, summary_a_label, summary_b_label, winner, judge_model, comparison_type, fusion_id",
    )
    .order("created_at", { ascending: true })
  if (error) throw new Error(`llm_judge_pairwise: ${error.message}`)
  return (data ?? []) as unknown as PairwiseRow[]
}

/** Fetch human eval tasks + responses. */
export async function fetchHumanEval(): Promise<{
  tasks: HumanEvalTaskRow[]
  responses: HumanEvalResponseRow[]
}> {
  const { data: tdata, error: terr } = await supabase
    .from("human_eval_tasks")
    .select("id, created_at, article_url, summaries, notes")
    .order("created_at", { ascending: true })
  if (terr) throw new Error(`human_eval_tasks: ${terr.message}`)
  const tasks = (tdata ?? []) as unknown as HumanEvalTaskRow[]
  if (tasks.length === 0) return { tasks: [], responses: [] }

  const ids = tasks.map((t) => t.id)
  const { data: rdata, error: rerr } = await supabase
    .from("human_eval_responses")
    .select("id, task_id, rater_id, ranking, rationale, created_at")
    .in("task_id", ids)
    .order("created_at", { ascending: true })
  if (rerr) throw new Error(`human_eval_responses: ${rerr.message}`)
  return { tasks, responses: (rdata ?? []) as unknown as HumanEvalResponseRow[] }
}
