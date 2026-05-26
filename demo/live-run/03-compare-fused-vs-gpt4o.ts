#!/usr/bin/env tsx
/**
 * 03-compare-fused-vs-gpt4o.ts — Live-run pairwise judge
 *
 * Queries Supabase for the 20 articles just run in mode="fusion" and
 * mode="sync" (model="gpt-4o"), and runs the pairwise judge on them.
 *
 * Usage:
 *   cd demo
 *   npx tsx live-run/03-compare-fused-vs-gpt4o.ts --since "2026-05-25T15:25:00Z"
 */

import * as path from "node:path"
import { config as loadDotenv } from "dotenv"

// Load env
loadDotenv({ path: path.resolve(__dirname, "../../backend/.env") })

import { createClient } from "@supabase/supabase-js"
import { judgePairwise } from "../../backend/services/llm-judge.service"
import { extractContentFromUrl } from "../../backend/services/content-extraction.service"
import type { ModelConfig } from "../../backend/domain/types"

const args = process.argv.slice(2)
function getArg(name: string, fallback = ""): string {
  const idx = args.indexOf(`--${name}`)
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback
}

const SINCE = getArg("since")
const JUDGE_MODEL_NAME = getArg("judge-model", "gpt-4o-mini")

if (!SINCE) {
  console.error("❌ You must provide the --since timestamp from script 01.")
  console.error('   Example: npx tsx live-run/03-compare-fused-vs-gpt4o.ts --since "2026-05-25T15:00:00Z"')
  process.exit(1)
}

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
if (!url || !key) {
  console.error("Missing Supabase env")
  process.exit(1)
}
const supabase = createClient(url, key, { auth: { persistSession: false } })

async function main() {
  console.log("=".repeat(70))
  console.log("LIVE-RUN: PAIRWISE JUDGE (Fused vs GPT-4o Alone)")
  console.log("=".repeat(70))
  console.log(`Since: ${SINCE}`)

  const { data: modelData } = await supabase
    .from("model_configurations")
    .select("*")
    .eq("model_name", JUDGE_MODEL_NAME)
    .maybeSingle()
  if (!modelData) {
    console.error(`Judge model ${JUDGE_MODEL_NAME} not found.`)
    return
  }
  const judgeModel = modelData as ModelConfig

  const { data: evalRows, error } = await supabase
    .from("evaluation_metrics")
    .select("id, url, mode, model, summary_text, created_at")
    .gte("created_at", SINCE)
    .order("created_at", { ascending: false })
  
  if (error) throw new Error(error.message)

  const isFusion = (r: any) => r.mode === "fusion"
  const isGpt4o = (r: any) => r.mode === "sync" && typeof r.model === "string" && r.model.startsWith("gpt-4o") && !r.model.includes("mini")

  const byUrl = new Map<string, any>()
  for (const row of evalRows ?? []) {
    if (!row.url || !row.summary_text) continue
    const b = byUrl.get(row.url) ?? {}
    if (!b.fused && isFusion(row)) b.fused = row
    if (!b.single && isGpt4o(row)) b.single = row
    byUrl.set(row.url, b)
  }

  const pairs = []
  for (const [u, b] of byUrl) {
    if (b.fused && b.single) pairs.push({ url: u, fused: b.fused, single: b.single })
  }

  console.log(`Found ${pairs.length} paired articles to judge.`)

  let fusedWins = 0, singleWins = 0, ties = 0, skipped = 0, saved = 0

  for (let i = 0; i < pairs.length; i++) {
    const pair = pairs[i]
    process.stdout.write(`[${i + 1}/${pairs.length}] ${pair.url.slice(0, 50)}... `)

    try {
      const extracted = await extractContentFromUrl(pair.url)
      const verdict = await judgePairwise(
        { label: "fused", text: pair.fused.summary_text },
        { label: "single_aggregator", text: pair.single.summary_text },
        extracted.content,
        { model: judgeModel, logContext: "demo-live" }
      )
      if (verdict.winner === "tie") ties++
      else if (verdict.winner_label === "fused") fusedWins++
      else singleWins++

      const { error: insErr } = await supabase.from("llm_judge_pairwise").insert({
        summary_a_label: "fused",
        summary_b_label: "single_aggregator",
        winner: verdict.winner,
        per_dimension: verdict.per_dimension,
        justification: verdict.justification,
        judge_model: verdict.judge_model,
        comparison_type: "vs_single_aggregator",
      })
      if (insErr) console.log(` ! save error: ${insErr.message}`)
      else saved++

      console.log(`✓ winner=${verdict.winner_label ?? verdict.winner}`)
    } catch (err: any) {
      console.log(`✗ error: ${err.message}`)
      skipped++
    }
  }

  console.log("\n" + "=".repeat(70))
  console.log(`Fused wins:  ${fusedWins}`)
  console.log(`Single wins: ${singleWins}`)
  console.log(`Ties:        ${ties}`)
  console.log(`Saved DB:    ${saved}`)
  
  if (fusedWins + singleWins > 0) {
    const rate = (fusedWins / (fusedWins + singleWins)) * 100
    console.log(`Fused win rate: ${rate.toFixed(1)}%`)
  }
}

main().catch(console.error)
