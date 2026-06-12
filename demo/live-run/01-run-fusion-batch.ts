#!/usr/bin/env tsx
/**
 * 01-run-fusion-batch.ts — Live-run Fusion Batch
 *
 * Calls the running backend API with `routing_mode: "fusion"` for 20 articles.
 * Includes judge_config to automatically run LLM-Judge (rubric, gpt-4o-mini).
 * Output is saved and the start timestamp is echoed so the next scripts can use it.
 *
 * Usage:
 *   cd demo
 *   npx tsx live-run/01-run-fusion-batch.ts
 */

import * as fs from "node:fs"
import * as path from "node:path"

const args = process.argv.slice(2)
function getArg(name: string, fallback = ""): string {
  const idx = args.indexOf(`--${name}`)
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback
}

const API_BASE = getArg("api", "http://localhost:3000")
const INPUT_PATH = path.resolve(__dirname, "sample-urls-long-2.json")
const TIMEOUT_MS = 600000 // 10 mins since fusion can take a while

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

function safeHostname(url: string): string | undefined {
  try { return new URL(url).hostname } catch { return undefined }
}

async function runFusion(url: string) {
  const start = Date.now()
  try {
    const res = await fetchWithTimeout(
      `${API_BASE}/api/summarize`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url,
          website: safeHostname(url),
          routing_mode: "fusion",
          judge_config: {
            judge_mode: "both",
            judge_style: "rubric",
            judge_model: "gpt-4o-mini",
          },
        }),
      },
      TIMEOUT_MS,
    )
    const latency = Date.now() - start
    if (!res.ok) {
      const text = await res.text().catch(() => "")
      return { url, ok: false, latency_ms: latency, error: `HTTP ${res.status}: ${text.slice(0, 100)}` }
    }
    const data: any = await res.json()
    const cost = data.estimated_cost_usd ?? 0
    return { url, ok: true, latency_ms: latency, cost_usd: cost }
  } catch (err) {
    return { url, ok: false, latency_ms: Date.now() - start, error: err instanceof Error ? err.message : String(err) }
  }
}

async function main() {
  console.log("=".repeat(70))
  console.log("LIVE-RUN: FUSION BATCH (20 articles)")
  console.log("=".repeat(70))

  const startedAt = new Date().toISOString()
  console.log(`Timestamp (--since): ${startedAt}`)
  console.log("Save this timestamp to run the next scripts!\n")

  if (!fs.existsSync(INPUT_PATH)) {
    console.error(`Input not found: ${INPUT_PATH}`)
    process.exit(1)
  }
  const urls: string[] = JSON.parse(fs.readFileSync(INPUT_PATH, "utf-8")).urls

  let okCount = 0
  let failCount = 0
  let totalCost = 0

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i]
    process.stdout.write(`[${i + 1}/${urls.length}] ${url.slice(0, 60)}... `)
    const result = await runFusion(url)
    if (result.ok) {
      okCount++
      if (result.cost_usd) totalCost += result.cost_usd
      console.log(`✓ ${result.latency_ms}ms · cost $${(result.cost_usd || 0).toFixed(6)}`)
    } else {
      failCount++
      console.log(`✗ ${result.error}`)
    }
  }

  console.log("\n" + "=".repeat(70))
  console.log(`Successful: ${okCount}/${urls.length}`)
  console.log(`Failed:     ${failCount}`)
  console.log(`Total cost: $${totalCost.toFixed(6)}`)
  console.log(`\nNext step: Run 02-run-gpt4o-alone.ts`)
  console.log(`Timestamp to use later: ${startedAt}`)
}

main().catch(err => {
  console.error("FATAL:", err)
  process.exit(1)
})
