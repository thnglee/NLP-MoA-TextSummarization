#!/usr/bin/env tsx
/**
 * ablation-moa-vs-single.ts — MoA (no residual) vs Single-model GPT-4o
 *
 * Answers the question:
 *   "Does vanilla MoA (Wang et al. 2024, no articleSnippet) beat single-model GPT-4o?"
 *
 * Conditions:
 *   A. MoA-NoSnippet  — 3 proposers (gpt-4o-mini, gemini-2.5-flash, claude-haiku-4-5)
 *                       + gpt-4o aggregator WITHOUT articleSnippet
 *   B. Single-GPT4o   — plain gpt-4o summarizes the article directly (no ensemble)
 *
 * Metrics:
 *   Axis-A (Content Retention): ROUGE-1, ROUGE-2, ROUGE-L, BERTScore
 *   Axis-B (Quality):           Rubric judge (1-5), Pairwise win rate, Factuality
 *
 * Usage:
 *   cd backend
 *   npx tsx output-fusion/scripts/ablation-moa-vs-single.ts \
 *     --input ../demo/sample-urls-dataset-50.json \
 *     --limit 5
 *
 * Flags:
 *   --input        JSON file: { "urls": [...] }. Default: sample-urls-dataset-50.json
 *   --output       Result JSON path. Default: fusion_reports/results/moa-vs-single-<date>.json
 *   --proposers    Comma-separated proposer model names.
 *                  Default: gpt-4o-mini,gemini-2.5-flash,claude-haiku-4-5
 *   --aggregator   Aggregator (and single) model. Default: gpt-4o
 *   --judge-model  Judge model. Default: gpt-4o-mini
 *   --timeout      Per-URL timeout ms. Default: 300000
 *   --limit        Only process first N URLs.
 *   --skip-bert    Skip BERTScore.
 *   --skip-judge   Skip LLM judge and factuality.
 */

import * as fs from "node:fs"
import * as path from "node:path"
import { config as loadDotenv } from "dotenv"

loadDotenv({ path: path.resolve(__dirname, "../../.env") })

import { extractContentFromUrl } from "@/services/content-extraction.service"
import { performSummarize } from "@/services/summarize.service"
import { generateJsonCompletion } from "@/services/llm.service"
import { SummaryDataSchema, type SummaryData } from "@/domain/schemas"
import { calculateLexicalMetrics } from "@/services/evaluation.service"
import { calculateBertScore } from "@/services/bert.service"
import { getAllModelConfigs } from "@/services/model-config.service"
import { judgeRubric, judgePairwise } from "@/services/llm-judge.service"
import { scoreFactuality } from "@/services/factuality.service"
import { buildAggregatorPrompt, type AggregatorDraft } from "@/output-fusion/moa.prompt"
import type { ModelConfig } from "@/domain/types"

// ── CLI args ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2)
function getArg(name: string, fallback: string): string {
  const idx = args.indexOf(`--${name}`)
  if (idx !== -1 && args[idx + 1]) return args[idx + 1]
  return fallback
}
function getIntArg(name: string, fallback: number): number {
  const raw = getArg(name, "")
  if (!raw) return fallback
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

const DEFAULT_INPUT = path.resolve(__dirname, "sample-urls-dataset-50.json")
const DEFAULT_OUTPUT_DIR = path.resolve(__dirname, "../../../fusion_reports/results")

const INPUT_PATH = path.resolve(process.cwd(), getArg("input", DEFAULT_INPUT))
const OUTPUT_PATH = path.resolve(
  process.cwd(),
  getArg(
    "output",
    path.join(
      DEFAULT_OUTPUT_DIR,
      `moa-vs-single-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
    ),
  ),
)
const SUMMARY_PATH = OUTPUT_PATH.replace(/\.json$/, ".md")

const DEFAULT_PROPOSERS = ["gpt-4o-mini", "gemini-2.5-flash", "claude-haiku-4-5"]
const PROPOSERS = getArg("proposers", DEFAULT_PROPOSERS.join(","))
  .split(",")
  .map(s => s.trim())
  .filter(Boolean)
const AGGREGATOR = getArg("aggregator", "gpt-4o")
const JUDGE_MODEL_NAME = getArg("judge-model", "gpt-4o-mini")
const TIMEOUT_MS = getIntArg("timeout", 300_000)
const LIMIT = getIntArg("limit", 0)
const SKIP_BERT = args.includes("--skip-bert")
const SKIP_JUDGE = args.includes("--skip-judge")

// ── Types ─────────────────────────────────────────────────────────────────────

interface AxisAMetrics {
  rouge1: number | null
  rouge2: number | null
  rougeL: number | null
  bert_score: number | null
}

interface RubricScores {
  faithfulness: number | null
  coverage: number | null
  fluency: number | null
  conciseness: number | null
  overall: number | null
}

interface FactualityMetrics {
  entailed_ratio: number | null
  total_claims: number | null
  hallucination_count: number | null
  not_mentioned_count: number | null
}

interface AxisBMetrics {
  rubric: RubricScores
  factuality: FactualityMetrics
}

interface PairwiseResult {
  // "A" = MoA-NoSnippet, "B" = Single-GPT4o
  winner: "moa" | "single" | "tie" | null
  per_dimension: {
    faithfulness: "moa" | "single" | "tie" | null
    coverage: "moa" | "single" | "tie" | null
    fluency: "moa" | "single" | "tie" | null
    conciseness: "moa" | "single" | "tie" | null
  }
  justification: string | null
}

interface ConditionResult {
  summary: string | null
  prompt_tokens: number | null
  completion_tokens: number | null
  latency_ms: number
  axis_a: AxisAMetrics
  axis_b: AxisBMetrics
  error?: string
}

interface ArticleRecord {
  index: number
  url: string
  article_length: number
  proposers_used: string[]
  successful_drafts: number
  moa: ConditionResult        // Condition A: vanilla MoA (no residual)
  single: ConditionResult     // Condition B: single GPT-4o
  pairwise: PairwiseResult
  axis_a_delta: {
    rouge1: number | null
    rouge2: number | null
    rougeL: number | null
    bert_score: number | null
  }
  error?: string
}

// ── Vanilla MoA aggregator prompt (NO articleSnippet) ─────────────────────────

const DRAFT_CHAR_LIMIT = 3_000

function buildVanillaMoAPrompt(drafts: AggregatorDraft[]): string {
  const draftBlocks = drafts
    .map((draft, index) => {
      const trimmed =
        draft.summary.length > DRAFT_CHAR_LIMIT
          ? draft.summary.substring(0, DRAFT_CHAR_LIMIT)
          : draft.summary
      return `${index + 1}. [Mô hình ${draft.model_name}]\n"""\n${trimmed}\n"""`
    })
    .join("\n\n")

  return `Bạn đã được cung cấp một tập các bản tóm tắt do nhiều mô hình ngôn ngữ khác nhau đề xuất cho cùng một bài báo tiếng Việt. Nhiệm vụ của bạn là tổng hợp các bản tóm tắt này thành một bản tóm tắt cuối cùng duy nhất, chất lượng cao nhất.

Điều quan trọng là phải đánh giá có phản biện những thông tin trong các bản tóm tắt được đề xuất, nhận thức rằng một số thông tin có thể bị thiên lệch hoặc sai lệch. Bản tóm tắt của bạn KHÔNG nên chỉ sao chép nguyên văn các bản tóm tắt được đưa ra; thay vào đó hãy đưa ra một câu trả lời đã được tinh chỉnh, chính xác và toàn diện. Đảm bảo bản tóm tắt có cấu trúc tốt, mạch lạc, trung lập theo phong cách báo chí Việt Nam, và tuân thủ tiêu chuẩn cao nhất về độ chính xác và độ tin cậy.

Các bản tóm tắt do các mô hình đề xuất:
${draftBlocks}

Sau khi tổng hợp, hãy phân loại bài viết và ước tính thời gian đọc.

Yêu cầu đầu ra (JSON có cấu trúc, đúng schema):
- summary: Bản tóm tắt tổng hợp cuối cùng (tiếng Việt). Viết đầy đủ ý từ các bản đề xuất, không tự cắt ngắn.
- category: Thể loại chính của bài viết. Nếu phù hợp, dùng một trong các giá trị sau:
  * Chính trị - Xã hội
  * Kinh tế - Tài chính
  * Công nghệ - Khoa học
  * Sức khỏe - Y tế
  * Văn hóa - Giải trí
  * Thể thao
  * Giáo dục
  * Du lịch - Ẩm thực
  * Môi trường - Biến đổi Khí hậu
  * Pháp luật - Tội phạm
  * Quân sự - Quốc phòng
  Nếu không phù hợp, chọn thể loại phù hợp nhất dưới dạng chuỗi ngắn.
- readingTime: Thời gian đọc ước tính (số phút, số nguyên, làm tròn lên).

Định dạng trả về (JSON):
{
  "summary": "bản tóm tắt tổng hợp cuối cùng",
  "category": "thể loại",
  "readingTime": 3
}
`
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function loadUrls(inputPath: string): string[] {
  if (!fs.existsSync(inputPath)) throw new Error(`Input file not found: ${inputPath}`)
  const raw = fs.readFileSync(inputPath, "utf-8")
  const parsed = JSON.parse(raw)
  if (Array.isArray(parsed)) return parsed.filter(u => typeof u === "string")
  if (parsed && Array.isArray(parsed.urls)) return parsed.urls.filter((u: unknown) => typeof u === "string")
  throw new Error(`Input must be a JSON array of URLs or { "urls": [...] }`)
}

function fmt(n: number | null | undefined, digits = 4): string {
  if (n == null || !Number.isFinite(n)) return "—"
  return n.toFixed(digits)
}

function fmtDelta(n: number | null | undefined, digits = 4): string {
  if (n == null || !Number.isFinite(n)) return "—"
  const s = n.toFixed(digits)
  return n >= 0 ? `+${s}` : s
}

function mean(nums: Array<number | null | undefined>): number | null {
  const vals = nums.filter((n): n is number => typeof n === "number" && Number.isFinite(n))
  if (vals.length === 0) return null
  return vals.reduce((a, b) => a + b, 0) / vals.length
}

function computeDelta(a: number | null, b: number | null): number | null {
  if (a == null || b == null) return null
  return a - b
}

const ARTICLE_SNIPPET_LIMIT = 3_000

async function scoreAxisA(summary: string, articleText: string, skipBert: boolean): Promise<AxisAMetrics> {
  let rouge1: number | null = null
  let rouge2: number | null = null
  let rougeL: number | null = null
  let bert_score: number | null = null
  try {
    const l = calculateLexicalMetrics(summary, articleText)
    rouge1 = l.rouge1; rouge2 = l.rouge2; rougeL = l.rougeL
  } catch { /* optional */ }
  if (!skipBert) {
    try { bert_score = await calculateBertScore(articleText, summary) } catch { /* optional */ }
  }
  return { rouge1, rouge2, rougeL, bert_score }
}

const EMPTY_RUBRIC: RubricScores = { faithfulness: null, coverage: null, fluency: null, conciseness: null, overall: null }
const EMPTY_FACT: FactualityMetrics = { entailed_ratio: null, total_claims: null, hallucination_count: null, not_mentioned_count: null }
const EMPTY_AXIS_B: AxisBMetrics = { rubric: EMPTY_RUBRIC, factuality: EMPTY_FACT }

async function scoreAxisB(
  summary: string,
  articleText: string,
  judgeModel: ModelConfig,
  label: string,
  skipJudge: boolean,
): Promise<AxisBMetrics> {
  if (skipJudge) return EMPTY_AXIS_B

  const snippet = articleText.length > ARTICLE_SNIPPET_LIMIT
    ? articleText.substring(0, ARTICLE_SNIPPET_LIMIT) : articleText

  const [rubricRes, factRes] = await Promise.allSettled([
    judgeRubric(summary, snippet, { model: judgeModel, logContext: `moa-vs-single-rubric-${label}` }),
    scoreFactuality(summary, snippet, { model: judgeModel, logContext: `moa-vs-single-fact-${label}` }),
  ])

  const rubric: RubricScores = rubricRes.status === "fulfilled"
    ? { faithfulness: rubricRes.value.scores.faithfulness ?? null, coverage: rubricRes.value.scores.coverage ?? null, fluency: rubricRes.value.scores.fluency ?? null, conciseness: rubricRes.value.scores.conciseness ?? null, overall: rubricRes.value.scores.overall ?? null }
    : EMPTY_RUBRIC

  const factuality: FactualityMetrics = factRes.status === "fulfilled"
    ? { entailed_ratio: factRes.value.entailed_ratio ?? null, total_claims: factRes.value.total_claims ?? null, hallucination_count: factRes.value.hallucinations?.length ?? null, not_mentioned_count: factRes.value.not_mentioned?.length ?? null }
    : EMPTY_FACT

  return { rubric, factuality }
}

async function runAggregator(prompt: string, cfg: ModelConfig, label: string): Promise<{ summary: string | null; prompt_tokens: number | null; completion_tokens: number | null; latency_ms: number; error?: string }> {
  const start = performance.now()
  try {
    const result = await generateJsonCompletion<SummaryData>(
      { prompt, schema: SummaryDataSchema, provider: cfg.provider, model: cfg.model_name, modelType: cfg.model_type, temperature: cfg.temperature, topP: cfg.top_p ?? undefined, maxTokens: cfg.max_tokens ?? undefined, logContext: `moa-vs-single-${label}` },
      { summary: "", category: "Khác", readingTime: 1 },
    )
    return { summary: result.data?.summary ?? null, prompt_tokens: result.usage?.prompt_tokens ?? null, completion_tokens: result.usage?.completion_tokens ?? null, latency_ms: Math.round(performance.now() - start) }
  } catch (err) {
    return { summary: null, prompt_tokens: null, completion_tokens: null, latency_ms: Math.round(performance.now() - start), error: err instanceof Error ? err.message : String(err) }
  }
}

// ── Main pipeline for one article ─────────────────────────────────────────────

async function processUrl(
  url: string,
  proposerConfigs: ModelConfig[],
  aggregatorConfig: ModelConfig,
  judgeModel: ModelConfig,
  skipBert: boolean,
  skipJudge: boolean,
): Promise<Omit<ArticleRecord, "index" | "url">> {
  const emptyCondition = (msg: string): ConditionResult => ({
    summary: null, prompt_tokens: null, completion_tokens: null, latency_ms: 0,
    axis_a: { rouge1: null, rouge2: null, rougeL: null, bert_score: null },
    axis_b: EMPTY_AXIS_B, error: msg,
  })
  const emptyPairwise: PairwiseResult = {
    winner: null, per_dimension: { faithfulness: null, coverage: null, fluency: null, conciseness: null }, justification: null,
  }

  // 1. Extract article
  let articleText: string
  try {
    const extracted = await extractContentFromUrl(url)
    articleText = extracted.content
    if (!articleText || articleText.length < 50) throw new Error(`Too short (${articleText.length} chars)`)
  } catch (err) {
    const msg = `extract: ${err instanceof Error ? err.message : String(err)}`
    return { article_length: 0, proposers_used: proposerConfigs.map(p => p.model_name), successful_drafts: 0, moa: emptyCondition(msg), single: emptyCondition(msg), pairwise: emptyPairwise, axis_a_delta: { rouge1: null, rouge2: null, rougeL: null, bert_score: null }, error: msg }
  }

  // 2. Run proposers for MoA condition
  const draftResults = await Promise.allSettled(
    proposerConfigs.map(async (cfg) => {
      const resp = await performSummarize({ content: articleText, url }, cfg)
      return { model_name: cfg.model_name, summary: resp.summary }
    }),
  )

  const aggregatorDrafts: AggregatorDraft[] = draftResults
    .map(r => r.status === "fulfilled" && r.value.summary ? { model_name: r.value.model_name, summary: r.value.summary } : null)
    .filter((d): d is AggregatorDraft => d !== null)

  if (aggregatorDrafts.length === 0) {
    const msg = "all proposers failed"
    return { article_length: articleText.length, proposers_used: proposerConfigs.map(p => p.model_name), successful_drafts: 0, moa: emptyCondition(msg), single: emptyCondition(msg), pairwise: emptyPairwise, axis_a_delta: { rouge1: null, rouge2: null, rougeL: null, bert_score: null }, error: msg }
  }

  // 3. Run MoA aggregator (no snippet) + Single GPT-4o concurrently
  const moaPrompt = buildVanillaMoAPrompt(aggregatorDrafts)

  const [moaAgg, singleAgg] = await Promise.all([
    runAggregator(moaPrompt, aggregatorConfig, "moa"),
    // Single GPT-4o: use performSummarize with the article content directly
    (async () => {
      const start = performance.now()
      try {
        const resp = await performSummarize({ content: articleText, url }, aggregatorConfig)
        return {
          summary: resp.summary ?? null,
          prompt_tokens: null as number | null,
          completion_tokens: null as number | null,
          latency_ms: Math.round(performance.now() - start),
        }
      } catch (err) {
        return {
          summary: null as string | null,
          prompt_tokens: null as number | null,
          completion_tokens: null as number | null,
          latency_ms: Math.round(performance.now() - start),
          error: err instanceof Error ? err.message : String(err),
        }
      }
    })(),
  ])

  // 4. Score both conditions in parallel (Axis-A + Axis-B)
  const [axisAMoA, axisASingle, axisBMoA, axisBSingle] = await Promise.all([
    moaAgg.summary ? scoreAxisA(moaAgg.summary, articleText, skipBert) : Promise.resolve({ rouge1: null, rouge2: null, rougeL: null, bert_score: null }),
    singleAgg.summary ? scoreAxisA(singleAgg.summary, articleText, skipBert) : Promise.resolve({ rouge1: null, rouge2: null, rougeL: null, bert_score: null }),
    moaAgg.summary ? scoreAxisB(moaAgg.summary, articleText, judgeModel, "moa", skipJudge) : Promise.resolve(EMPTY_AXIS_B),
    singleAgg.summary ? scoreAxisB(singleAgg.summary, articleText, judgeModel, "single", skipJudge) : Promise.resolve(EMPTY_AXIS_B),
  ])

  // 5. Pairwise judge (MoA as caller's "a", Single as caller's "b")
  let pairwise: PairwiseResult = emptyPairwise
  if (!skipJudge && moaAgg.summary && singleAgg.summary) {
    try {
      const snippet = articleText.length > ARTICLE_SNIPPET_LIMIT ? articleText.substring(0, ARTICLE_SNIPPET_LIMIT) : articleText
      const verdict = await judgePairwise(
        { label: "moa_no_snippet", text: moaAgg.summary },
        { label: "single_gpt4o", text: singleAgg.summary },
        snippet,
        { model: judgeModel, logContext: "moa-vs-single-pairwise" },
      )
      const mapV = (v: string): "moa" | "single" | "tie" =>
        v === "tie" ? "tie" : v === "A" ? "moa" : "single"
      pairwise = {
        winner: mapV(verdict.winner),
        per_dimension: {
          faithfulness: mapV(verdict.per_dimension.faithfulness),
          coverage: mapV(verdict.per_dimension.coverage),
          fluency: mapV(verdict.per_dimension.fluency),
          conciseness: mapV(verdict.per_dimension.conciseness),
        },
        justification: verdict.justification,
      }
    } catch { /* pairwise optional */ }
  }

  const moaResult: ConditionResult = {
    summary: moaAgg.summary, prompt_tokens: moaAgg.prompt_tokens, completion_tokens: moaAgg.completion_tokens,
    latency_ms: moaAgg.latency_ms, axis_a: axisAMoA, axis_b: axisBMoA,
    ...(moaAgg.error ? { error: moaAgg.error } : {}),
  }
  const singleResult: ConditionResult = {
    summary: singleAgg.summary, prompt_tokens: singleAgg.prompt_tokens, completion_tokens: singleAgg.completion_tokens,
    latency_ms: singleAgg.latency_ms, axis_a: axisASingle, axis_b: axisBSingle,
    ...("error" in singleAgg ? { error: (singleAgg as any).error } : {}),
  }

  return {
    article_length: articleText.length,
    proposers_used: proposerConfigs.map(p => p.model_name),
    successful_drafts: aggregatorDrafts.length,
    moa: moaResult,
    single: singleResult,
    pairwise,
    axis_a_delta: {
      rouge1: computeDelta(axisAMoA.rouge1, axisASingle.rouge1),
      rouge2: computeDelta(axisAMoA.rouge2, axisASingle.rouge2),
      rougeL: computeDelta(axisAMoA.rougeL, axisASingle.rougeL),
      bert_score: computeDelta(axisAMoA.bert_score, axisASingle.bert_score),
    },
  }
}

// ── Markdown report ────────────────────────────────────────────────────────────

function buildMarkdownReport(records: ArticleRecord[], startedAt: string, finishedAt: string): string {
  const lines: string[] = []
  const ok = records.filter(r => !r.error)

  lines.push("# MoA (No Residual) vs Single GPT-4o — Ablation Study")
  lines.push("")
  lines.push("## Experiment Design")
  lines.push("")
  lines.push("| Parameter | Value |")
  lines.push("|-----------|-------|")
  lines.push(`| **Condition A** | Vanilla MoA — ${PROPOSERS.join(", ")} → ${AGGREGATOR} aggregator (NO articleSnippet) |`)
  lines.push(`| **Condition B** | Single ${AGGREGATOR} — direct summarization, no ensemble |`)
  lines.push(`| **Judge model** | ${SKIP_JUDGE ? "Skipped" : JUDGE_MODEL_NAME} |`)
  lines.push(`| **Articles** | ${records.length} (${ok.length} successful) |`)
  lines.push(`| **Started** | ${startedAt} |`)
  lines.push(`| **Finished** | ${finishedAt} |`)
  lines.push(`| **BERTScore** | ${SKIP_BERT ? "Skipped" : "Enabled"} |`)
  lines.push("")
  lines.push("> **Hypothesis**: Vanilla MoA (ensemble without residual connection) outperforms a single GPT-4o, validating the ensemble architecture itself independently of the residual connection innovation.")
  lines.push("")
  lines.push("---")
  lines.push("")

  // ── AXIS A ─────────────────────────────────────────────────────────────────
  lines.push("## Axis-A: Content Retention")
  lines.push("")
  lines.push("| Metric | MoA (no residual) | Single GPT-4o | Δ (MoA − Single) |")
  lines.push("|--------|-------------------|----------------|------------------|")
  for (const { key, label } of [
    { key: "rouge1" as const, label: "ROUGE-1" },
    { key: "rouge2" as const, label: "ROUGE-2" },
    { key: "rougeL" as const, label: "ROUGE-L" },
    { key: "bert_score" as const, label: "BERTScore" },
  ]) {
    const mMoA = mean(ok.map(r => r.moa.axis_a[key]))
    const mSingle = mean(ok.map(r => r.single.axis_a[key]))
    const delta = computeDelta(mMoA, mSingle)
    const arrow = delta != null ? (delta > 0.001 ? " ▲" : delta < -0.001 ? " ▼" : " ─") : ""
    lines.push(`| **${label}** | ${fmt(mMoA)} | ${fmt(mSingle)} | ${fmtDelta(delta)}${arrow} |`)
  }
  lines.push("")

  lines.push("### Axis-A Win Rate (n=" + ok.length + ")")
  lines.push("")
  lines.push("| Metric | MoA wins | Single wins | Ties | MoA win% |")
  lines.push("|--------|----------|------------|------|----------|")
  for (const { key, label } of [
    { key: "rouge1" as const, label: "ROUGE-1" },
    { key: "rouge2" as const, label: "ROUGE-2" },
    { key: "rougeL" as const, label: "ROUGE-L" },
    { key: "bert_score" as const, label: "BERTScore" },
  ]) {
    let wA = 0, wB = 0, ties = 0
    for (const r of ok) {
      const a = r.moa.axis_a[key], b = r.single.axis_a[key]
      if (a == null || b == null) continue
      if (Math.abs(a - b) < 0.0001) { ties++; continue }
      if (a > b) wA++; else wB++
    }
    const decisive = wA + wB
    const pct = decisive > 0 ? ((wA / decisive) * 100).toFixed(0) + "%" : "—"
    lines.push(`| **${label}** | ${wA} | ${wB} | ${ties} | **${pct}** |`)
  }
  lines.push("")
  lines.push("---")
  lines.push("")

  // ── AXIS B ─────────────────────────────────────────────────────────────────
  lines.push("## Axis-B: Summary Quality (LLM Judge)")
  lines.push("")

  lines.push("### B-1: Rubric Scores (1–5 scale)")
  lines.push("")
  lines.push("| Dimension | MoA (no residual) | Single GPT-4o | Δ |")
  lines.push("|-----------|-------------------|---------------|---|")
  for (const { key, label } of [
    { key: "faithfulness" as const, label: "Faithfulness" },
    { key: "coverage" as const, label: "Coverage" },
    { key: "fluency" as const, label: "Fluency" },
    { key: "conciseness" as const, label: "Conciseness" },
    { key: "overall" as const, label: "**Overall**" },
  ]) {
    const mMoA = mean(ok.map(r => r.moa.axis_b.rubric[key]))
    const mSingle = mean(ok.map(r => r.single.axis_b.rubric[key]))
    const delta = computeDelta(mMoA, mSingle)
    const arrow = delta != null ? (delta > 0.05 ? " ▲" : delta < -0.05 ? " ▼" : " ─") : ""
    lines.push(`| ${label} | ${fmt(mMoA, 2)} | ${fmt(mSingle, 2)} | ${fmtDelta(delta, 2)}${arrow} |`)
  }
  lines.push("")

  lines.push("### B-2: Pairwise Judge (MoA vs Single GPT-4o)")
  lines.push("")
  const pairwiseRecords = ok.filter(r => r.pairwise.winner !== null)
  if (pairwiseRecords.length > 0) {
    const wA = pairwiseRecords.filter(r => r.pairwise.winner === "moa").length
    const wB = pairwiseRecords.filter(r => r.pairwise.winner === "single").length
    const ties = pairwiseRecords.filter(r => r.pairwise.winner === "tie").length
    const decisive = wA + wB
    const pct = decisive > 0 ? ((wA / decisive) * 100).toFixed(1) + "%" : "—"
    lines.push("| Outcome | Count | % of decisive |")
    lines.push("|---------|-------|---------------|")
    lines.push(`| **MoA (no residual) wins** | **${wA}** | **${pct}** |`)
    lines.push(`| Single GPT-4o wins | ${wB} | ${decisive > 0 ? ((wB / decisive) * 100).toFixed(1) + "%" : "—"} |`)
    lines.push(`| Ties | ${ties} | — |`)
    lines.push(`| Total evaluated | ${pairwiseRecords.length} | |`)
    lines.push("")
    lines.push("**Per-dimension pairwise:**")
    lines.push("")
    lines.push("| Dimension | MoA wins | Single wins | Ties |")
    lines.push("|-----------|----------|------------|------|")
    for (const dim of ["faithfulness", "coverage", "fluency", "conciseness"] as const) {
      let dA = 0, dB = 0, dT = 0
      for (const r of pairwiseRecords) {
        const v = r.pairwise.per_dimension[dim]
        if (v === "moa") dA++; else if (v === "single") dB++; else if (v === "tie") dT++
      }
      lines.push(`| ${dim} | ${dA} | ${dB} | ${dT} |`)
    }
  } else {
    lines.push("*No pairwise verdicts (judge skipped).*")
  }
  lines.push("")

  lines.push("### B-3: Factuality")
  lines.push("")
  const factMoA = mean(ok.map(r => r.moa.axis_b.factuality.entailed_ratio))
  const factSingle = mean(ok.map(r => r.single.axis_b.factuality.entailed_ratio))
  const hallMoA = mean(ok.map(r => r.moa.axis_b.factuality.hallucination_count))
  const hallSingle = mean(ok.map(r => r.single.axis_b.factuality.hallucination_count))
  lines.push("| Metric | MoA (no residual) | Single GPT-4o | Δ |")
  lines.push("|--------|-------------------|---------------|---|")
  const fd = computeDelta(factMoA, factSingle)
  const hd = computeDelta(hallMoA, hallSingle)
  lines.push(`| **Entailed ratio** (higher = better) | ${fmt(factMoA, 3)} | ${fmt(factSingle, 3)} | ${fmtDelta(fd, 3)}${fd != null ? (fd > 0.005 ? " ▲" : fd < -0.005 ? " ▼" : " ─") : ""} |`)
  lines.push(`| Avg hallucination count (lower = better) | ${fmt(hallMoA, 2)} | ${fmt(hallSingle, 2)} | ${fmtDelta(hd, 2)} |`)
  lines.push("")
  lines.push("---")
  lines.push("")

  // ── PER-ARTICLE TABLE ──────────────────────────────────────────────────────
  lines.push("## Per-Article Results")
  lines.push("")
  lines.push("| # | ROUGE-L (MoA/Single) | BERTScore (MoA/Single) | Rubric Overall (MoA/Single) | Factuality (MoA/Single) | Pairwise |")
  lines.push("|---|---|---|---|---|---|")
  for (const r of records) {
    if (r.error && !r.moa.summary) { lines.push(`| ${r.index} | ERROR | ERROR | ERROR | ERROR | — |`); continue }
    const rL = `${fmt(r.moa.axis_a.rougeL)} / ${fmt(r.single.axis_a.rougeL)}`
    const bs = `${fmt(r.moa.axis_a.bert_score)} / ${fmt(r.single.axis_a.bert_score)}`
    const ov = `${fmt(r.moa.axis_b.rubric.overall, 1)} / ${fmt(r.single.axis_b.rubric.overall, 1)}`
    const fa = `${fmt(r.moa.axis_b.factuality.entailed_ratio, 2)} / ${fmt(r.single.axis_b.factuality.entailed_ratio, 2)}`
    const pw = r.pairwise.winner ? (r.pairwise.winner === "moa" ? "✅ MoA" : r.pairwise.winner === "single" ? "❌ Single" : "═ Tie") : "—"
    lines.push(`| ${r.index} | ${rL} | ${bs} | ${ov} | ${fa} | ${pw} |`)
  }
  lines.push("")

  // ── CONCLUSION ─────────────────────────────────────────────────────────────
  lines.push("---")
  lines.push("")
  lines.push("## Summary & Conclusion")
  lines.push("")
  const axisAWins = [
    computeDelta(mean(ok.map(r => r.moa.axis_a.rouge1)), mean(ok.map(r => r.single.axis_a.rouge1))),
    computeDelta(mean(ok.map(r => r.moa.axis_a.rouge2)), mean(ok.map(r => r.single.axis_a.rouge2))),
    computeDelta(mean(ok.map(r => r.moa.axis_a.rougeL)), mean(ok.map(r => r.single.axis_a.rougeL))),
    computeDelta(mean(ok.map(r => r.moa.axis_a.bert_score)), mean(ok.map(r => r.single.axis_a.bert_score))),
  ].filter(d => d != null && d > 0).length
  const overallMoA = mean(ok.map(r => r.moa.axis_b.rubric.overall))
  const overallSingle = mean(ok.map(r => r.single.axis_b.rubric.overall))
  lines.push(`- **Axis-A**: MoA (no residual) wins ${axisAWins}/4 metrics vs single GPT-4o — ${axisAWins >= 3 ? "ensemble architecture has standalone value ✅" : axisAWins >= 2 ? "marginal improvement" : "single model holds its own ⚠️"}`)
  if (pairwiseRecords.length > 0) {
    const wA = pairwiseRecords.filter(r => r.pairwise.winner === "moa").length
    const decisive = pairwiseRecords.filter(r => r.pairwise.winner !== "tie").length
    lines.push(`- **Pairwise judge**: MoA wins ${wA}/${pairwiseRecords.length} verdicts (${decisive > 0 ? ((wA / decisive) * 100).toFixed(0) + "% of decisive" : "—"})`)
  }
  lines.push(`- **Rubric overall**: MoA=${fmt(overallMoA, 2)}, Single=${fmt(overallSingle, 2)} (Δ=${fmtDelta(computeDelta(overallMoA, overallSingle), 2)})`)
  lines.push(`- **Factuality**: MoA entailed ratio=${fmt(factMoA, 3)}, Single=${fmt(factSingle, 3)} (Δ=${fmtDelta(fd, 3)})`)
  lines.push("")
  lines.push("*Use paired sign-test for statistical significance in thesis reporting.*")

  return lines.join("\n")
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const urlsAll = loadUrls(INPUT_PATH)
  const urls = LIMIT > 0 ? urlsAll.slice(0, LIMIT) : urlsAll
  if (urls.length === 0) { console.error("No URLs to process."); process.exit(1) }

  console.log("=".repeat(70))
  console.log("MoA (NO RESIDUAL) vs SINGLE GPT-4o ABLATION STUDY")
  console.log("=".repeat(70))
  console.log(`Input:       ${INPUT_PATH}`)
  console.log(`Output:      ${OUTPUT_PATH}`)
  console.log(`Articles:    ${urls.length}`)
  console.log(`Proposers:   ${PROPOSERS.join(", ")}`)
  console.log(`Aggregator:  ${AGGREGATOR}`)
  console.log(`Judge:       ${SKIP_JUDGE ? "Skipped" : JUDGE_MODEL_NAME}`)
  console.log(`BERTScore:   ${SKIP_BERT ? "Skipped" : "Enabled"}`)
  console.log("=".repeat(70))
  console.log("")

  const allModels = await getAllModelConfigs()

  const proposerConfigs = PROPOSERS.map(name => {
    const cfg = allModels.find(m => m.model_name === name)
    if (!cfg) throw new Error(`Proposer "${name}" not found in model_configurations`)
    return cfg
  })
  const aggregatorConfig = allModels.find(m => m.model_name === AGGREGATOR)
  if (!aggregatorConfig) throw new Error(`Aggregator "${AGGREGATOR}" not found`)
  const judgeModel = allModels.find(m => m.model_name === JUDGE_MODEL_NAME)
  if (!judgeModel && !SKIP_JUDGE) throw new Error(`Judge "${JUDGE_MODEL_NAME}" not found`)

  const startedAt = new Date().toISOString()
  const records: ArticleRecord[] = []

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i]
    console.log(`\n[${i + 1}/${urls.length}] ${url}`)

    let result: Omit<ArticleRecord, "index" | "url">
    try {
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Timeout after ${TIMEOUT_MS}ms`)), TIMEOUT_MS),
      )
      result = await Promise.race([
        processUrl(url, proposerConfigs, aggregatorConfig, judgeModel!, SKIP_BERT, SKIP_JUDGE),
        timeoutPromise,
      ])
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.log(`  ✗ ${msg}`)
      result = {
        article_length: 0, proposers_used: PROPOSERS, successful_drafts: 0,
        moa: { summary: null, prompt_tokens: null, completion_tokens: null, latency_ms: 0, axis_a: { rouge1: null, rouge2: null, rougeL: null, bert_score: null }, axis_b: EMPTY_AXIS_B, error: msg },
        single: { summary: null, prompt_tokens: null, completion_tokens: null, latency_ms: 0, axis_a: { rouge1: null, rouge2: null, rougeL: null, bert_score: null }, axis_b: EMPTY_AXIS_B, error: msg },
        pairwise: { winner: null, per_dimension: { faithfulness: null, coverage: null, fluency: null, conciseness: null }, justification: null },
        axis_a_delta: { rouge1: null, rouge2: null, rougeL: null, bert_score: null },
        error: msg,
      }
    }

    records.push({ index: i + 1, url, ...result })

    if (!result.error) {
      const m = result.moa, s = result.single
      console.log(
        `  ✓ drafts=${result.successful_drafts}  |` +
        `  ROUGE-L  MoA=${fmt(m.axis_a.rougeL)} Single=${fmt(s.axis_a.rougeL)} Δ=${fmtDelta(result.axis_a_delta.rougeL)}  |` +
        `  BERT  MoA=${fmt(m.axis_a.bert_score)} Single=${fmt(s.axis_a.bert_score)}`,
      )
      console.log(
        `  Rubric overall  MoA=${fmt(m.axis_b.rubric.overall, 1)} Single=${fmt(s.axis_b.rubric.overall, 1)}  |` +
        `  Factuality  MoA=${fmt(m.axis_b.factuality.entailed_ratio, 2)} Single=${fmt(s.axis_b.factuality.entailed_ratio, 2)}  |` +
        `  Pairwise: ${result.pairwise.winner ?? "—"}`,
      )
    }
  }

  const finishedAt = new Date().toISOString()

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true })
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify({
    experiment: "moa-no-residual-vs-single-gpt4o",
    started_at: startedAt, finished_at: finishedAt,
    config: { proposers: PROPOSERS, aggregator: AGGREGATOR, judge_model: JUDGE_MODEL_NAME, bert_enabled: !SKIP_BERT, judge_enabled: !SKIP_JUDGE, articles_processed: records.length },
    records,
  }, null, 2))
  fs.writeFileSync(SUMMARY_PATH, buildMarkdownReport(records, startedAt, finishedAt))

  const ok = records.filter(r => !r.error)
  console.log("")
  console.log("=".repeat(70))
  console.log("AGGREGATE RESULTS")
  console.log("=".repeat(70))
  console.log("Axis-A (Content Retention):")
  for (const { key, label } of [
    { key: "rouge1" as const, label: "ROUGE-1  " },
    { key: "rouge2" as const, label: "ROUGE-2  " },
    { key: "rougeL" as const, label: "ROUGE-L  " },
    { key: "bert_score" as const, label: "BERTScore" },
  ]) {
    const mA = mean(ok.map(r => r.moa.axis_a[key]))
    const mB = mean(ok.map(r => r.single.axis_a[key]))
    const d = computeDelta(mA, mB)
    console.log(`  ${label}  MoA=${fmt(mA)}  Single=${fmt(mB)}  Δ=${fmtDelta(d)} ${d != null ? (d > 0 ? "▲" : "▼") : ""}`)
  }
  console.log("Axis-B (Quality — LLM Judge):")
  for (const key of ["faithfulness", "coverage", "fluency", "conciseness", "overall"] as const) {
    const mA = mean(ok.map(r => r.moa.axis_b.rubric[key]))
    const mB = mean(ok.map(r => r.single.axis_b.rubric[key]))
    console.log(`  Rubric ${key.padEnd(11)}  MoA=${fmt(mA, 2)}  Single=${fmt(mB, 2)}  Δ=${fmtDelta(computeDelta(mA, mB), 2)}`)
  }
  const pairwiseOk = ok.filter(r => r.pairwise.winner !== null)
  if (pairwiseOk.length > 0) {
    const wA = pairwiseOk.filter(r => r.pairwise.winner === "moa").length
    const wB = pairwiseOk.filter(r => r.pairwise.winner === "single").length
    const t = pairwiseOk.filter(r => r.pairwise.winner === "tie").length
    console.log(`  Pairwise           MoA wins=${wA}  Single wins=${wB}  Ties=${t}  (n=${pairwiseOk.length})`)
  }
  const fA = mean(ok.map(r => r.moa.axis_b.factuality.entailed_ratio))
  const fB = mean(ok.map(r => r.single.axis_b.factuality.entailed_ratio))
  console.log(`  Factuality ratio   MoA=${fmt(fA, 3)}  Single=${fmt(fB, 3)}  Δ=${fmtDelta(computeDelta(fA, fB), 3)}`)
  console.log("")
  console.log(`JSON  → ${OUTPUT_PATH}`)
  console.log(`MD    → ${SUMMARY_PATH}`)
}

main().catch(err => { console.error("FATAL:", err); process.exit(1) })
