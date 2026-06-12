#!/usr/bin/env tsx
/**
 * ablation-residual.ts — MoA Residual Connection Ablation Study
 *
 * Tests whether injecting the original article (`articleSnippet`) into the
 * aggregator prompt (the "residual connection") genuinely improves
 * summarization quality vs. the vanilla MoA prompt that only sees proposer drafts.
 *
 * For each URL, the pipeline is:
 *   1. Extract article text
 *   2. Run Layer-1 proposers in parallel (gpt-4o-mini, gemini-2.5-flash, claude-haiku-4-5)
 *   3. Run two aggregators concurrently with gpt-4o:
 *      - Condition A (WITH articleSnippet): current prod prompt
 *      - Condition B (NO articleSnippet):   vanilla MoA (Wang et al. 2024)
 *   4. Score both outputs on two metric axes:
 *      - Axis-A (Content Retention): ROUGE-1, ROUGE-2, ROUGE-L, BERTScore
 *      - Axis-B (Quality):           Rubric judge (faith/coverage/fluency/conciseness/overall),
 *                                    Pairwise judge win rate (WITH vs WITHOUT),
 *                                    Factuality (entailed_ratio, hallucination_count)
 *   5. Write JSON + Markdown side-by-side comparison report
 *
 * Usage:
 *   cd backend
 *   npx tsx output-fusion/scripts/ablation-residual.ts \
 *     --input ../demo/sample-urls-dataset-50.json \
 *     --output ../fusion_reports/results/residual-ablation-<date>.json \
 *     --limit 5
 *
 * Flags:
 *   --input          JSON file: { "urls": [...] }. Default: sample-urls-dataset-50.json
 *   --output         Result JSON path. Default: fusion_reports/results/residual-ablation-<date>.json
 *   --proposers      Comma-separated proposer model names.
 *                    Default: gpt-4o-mini,gemini-2.5-flash,claude-haiku-4-5
 *   --aggregator     Aggregator model. Default: gpt-4o
 *   --judge-model    Judge model for rubric/pairwise/factuality. Default: gpt-4o-mini
 *   --timeout        Per-URL timeout in ms. Default: 300000
 *   --limit          Only process the first N URLs.
 *   --skip-bert      Skip BERTScore (faster, no BERT service needed).
 *   --skip-judge     Skip LLM judge and factuality (metrics-only mode).
 */

import * as fs from "node:fs"
import * as path from "node:path"
import { config as loadDotenv } from "dotenv"

// ── Must load env BEFORE importing any service that reads process.env ────────
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

// ── CLI args ─────────────────────────────────────────────────────────────────

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
      `residual-ablation-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
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
  winner: "with" | "without" | "tie" | null
  per_dimension: {
    faithfulness: "with" | "without" | "tie" | null
    coverage: "with" | "without" | "tie" | null
    fluency: "with" | "without" | "tie" | null
    conciseness: "with" | "without" | "tie" | null
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
  with_snippet: ConditionResult
  no_snippet: ConditionResult
  pairwise: PairwiseResult
  axis_a_delta: {
    rouge1: number | null
    rouge2: number | null
    rougeL: number | null
    bert_score: number | null
  }
  error?: string
}

// ── Ablation prompt builder (NO residual connection) ─────────────────────────

const DRAFT_CHAR_LIMIT = 3_000

/**
 * Vanilla MoA aggregator prompt — identical to buildAggregatorPrompt() but
 * WITHOUT the original article block (no residual connection). This matches
 * Wang et al. (2024) Table 1 exactly.
 */
function buildAggregatorPromptNoResidual(drafts: AggregatorDraft[]): string {
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

// ── Helpers ──────────────────────────────────────────────────────────────────

function loadUrls(inputPath: string): string[] {
  if (!fs.existsSync(inputPath)) {
    throw new Error(`Input file not found: ${inputPath}`)
  }
  const raw = fs.readFileSync(inputPath, "utf-8")
  const parsed = JSON.parse(raw)
  if (Array.isArray(parsed)) return parsed.filter(u => typeof u === "string")
  if (parsed && Array.isArray(parsed.urls)) {
    return parsed.urls.filter((u: unknown) => typeof u === "string")
  }
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

async function scoreAxisA(
  summary: string,
  articleText: string,
  skipBert: boolean,
): Promise<AxisAMetrics> {
  let rouge1: number | null = null
  let rouge2: number | null = null
  let rougeL: number | null = null
  let bert_score: number | null = null

  try {
    const lexical = calculateLexicalMetrics(summary, articleText)
    rouge1 = lexical.rouge1
    rouge2 = lexical.rouge2
    rougeL = lexical.rougeL
  } catch { /* optional */ }

  if (!skipBert) {
    try { bert_score = await calculateBertScore(articleText, summary) } catch { /* optional */ }
  }

  return { rouge1, rouge2, rougeL, bert_score }
}

async function scoreAxisB(
  summary: string,
  articleText: string,
  judgeModel: ModelConfig,
  conditionLabel: string,
  skipJudge: boolean,
): Promise<AxisBMetrics> {
  const emptyRubric: RubricScores = {
    faithfulness: null, coverage: null, fluency: null, conciseness: null, overall: null,
  }
  const emptyFact: FactualityMetrics = {
    entailed_ratio: null, total_claims: null, hallucination_count: null, not_mentioned_count: null,
  }

  if (skipJudge) return { rubric: emptyRubric, factuality: emptyFact }

  const articleSnippet = articleText.length > ARTICLE_SNIPPET_LIMIT
    ? articleText.substring(0, ARTICLE_SNIPPET_LIMIT)
    : articleText

  // Run rubric + factuality in parallel
  const [rubricResult, factualityResult] = await Promise.allSettled([
    judgeRubric(summary, articleSnippet, {
      model: judgeModel,
      logContext: `ablation-rubric-${conditionLabel}`,
    }),
    scoreFactuality(summary, articleSnippet, {
      model: judgeModel,
      logContext: `ablation-factuality-${conditionLabel}`,
    }),
  ])

  const rubric: RubricScores = rubricResult.status === "fulfilled"
    ? {
        faithfulness: rubricResult.value.scores.faithfulness ?? null,
        coverage: rubricResult.value.scores.coverage ?? null,
        fluency: rubricResult.value.scores.fluency ?? null,
        conciseness: rubricResult.value.scores.conciseness ?? null,
        overall: rubricResult.value.scores.overall ?? null,
      }
    : emptyRubric

  const factuality: FactualityMetrics = factualityResult.status === "fulfilled"
    ? {
        entailed_ratio: factualityResult.value.entailed_ratio ?? null,
        total_claims: factualityResult.value.total_claims ?? null,
        hallucination_count: factualityResult.value.hallucinations?.length ?? null,
        not_mentioned_count: factualityResult.value.not_mentioned?.length ?? null,
      }
    : emptyFact

  return { rubric, factuality }
}

async function runAggregator(
  prompt: string,
  aggregatorConfig: ModelConfig,
  label: string,
): Promise<{
  summary: string | null
  prompt_tokens: number | null
  completion_tokens: number | null
  latency_ms: number
  error?: string
}> {
  const start = performance.now()
  try {
    const result = await generateJsonCompletion<SummaryData>(
      {
        prompt,
        schema: SummaryDataSchema,
        provider: aggregatorConfig.provider,
        model: aggregatorConfig.model_name,
        modelType: aggregatorConfig.model_type,
        temperature: aggregatorConfig.temperature,
        topP: aggregatorConfig.top_p ?? undefined,
        maxTokens: aggregatorConfig.max_tokens ?? undefined,
        logContext: `ablation-${label}`,
      },
      { summary: "", category: "Khác", readingTime: 1 },
    )
    return {
      summary: result.data?.summary ?? null,
      prompt_tokens: result.usage?.prompt_tokens ?? null,
      completion_tokens: result.usage?.completion_tokens ?? null,
      latency_ms: Math.round(performance.now() - start),
    }
  } catch (err) {
    return {
      summary: null,
      prompt_tokens: null,
      completion_tokens: null,
      latency_ms: Math.round(performance.now() - start),
      error: err instanceof Error ? err.message : String(err),
    }
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
    axis_b: {
      rubric: { faithfulness: null, coverage: null, fluency: null, conciseness: null, overall: null },
      factuality: { entailed_ratio: null, total_claims: null, hallucination_count: null, not_mentioned_count: null },
    },
    error: msg,
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
    return {
      article_length: 0,
      proposers_used: proposerConfigs.map(p => p.model_name),
      successful_drafts: 0,
      with_snippet: emptyCondition(msg),
      no_snippet: emptyCondition(msg),
      pairwise: emptyPairwise,
      axis_a_delta: { rouge1: null, rouge2: null, rougeL: null, bert_score: null },
      error: msg,
    }
  }

  // 2. Run proposers in parallel
  const draftResults = await Promise.allSettled(
    proposerConfigs.map(async (cfg) => {
      const resp = await performSummarize({ content: articleText, url }, cfg)
      return { model_name: cfg.model_name, summary: resp.summary }
    }),
  )

  const aggregatorDrafts: AggregatorDraft[] = draftResults
    .map((r, i) =>
      r.status === "fulfilled" && r.value.summary
        ? { model_name: r.value.model_name, summary: r.value.summary }
        : null,
    )
    .filter((d): d is AggregatorDraft => d !== null)

  if (aggregatorDrafts.length === 0) {
    const msg = "all proposers failed"
    return {
      article_length: articleText.length,
      proposers_used: proposerConfigs.map(p => p.model_name),
      successful_drafts: 0,
      with_snippet: emptyCondition(msg),
      no_snippet: emptyCondition(msg),
      pairwise: emptyPairwise,
      axis_a_delta: { rouge1: null, rouge2: null, rougeL: null, bert_score: null },
      error: msg,
    }
  }

  // 3. Build both prompts and run aggregators concurrently
  const promptWith = buildAggregatorPrompt(articleText, aggregatorDrafts)
  const promptNo = buildAggregatorPromptNoResidual(aggregatorDrafts)

  const [aggWith, aggNo] = await Promise.all([
    runAggregator(promptWith, aggregatorConfig, "with-snippet"),
    runAggregator(promptNo, aggregatorConfig, "no-snippet"),
  ])

  // 4. Score both conditions in parallel (Axis-A + Axis-B)
  const [axisAWith, axisANo, axisBWith, axisBNo] = await Promise.all([
    aggWith.summary ? scoreAxisA(aggWith.summary, articleText, skipBert) : Promise.resolve({ rouge1: null, rouge2: null, rougeL: null, bert_score: null }),
    aggNo.summary ? scoreAxisA(aggNo.summary, articleText, skipBert) : Promise.resolve({ rouge1: null, rouge2: null, rougeL: null, bert_score: null }),
    aggWith.summary ? scoreAxisB(aggWith.summary, articleText, judgeModel, "with", skipJudge) : Promise.resolve({ rubric: { faithfulness: null, coverage: null, fluency: null, conciseness: null, overall: null }, factuality: { entailed_ratio: null, total_claims: null, hallucination_count: null, not_mentioned_count: null } }),
    aggNo.summary ? scoreAxisB(aggNo.summary, articleText, judgeModel, "no", skipJudge) : Promise.resolve({ rubric: { faithfulness: null, coverage: null, fluency: null, conciseness: null, overall: null }, factuality: { entailed_ratio: null, total_claims: null, hallucination_count: null, not_mentioned_count: null } }),
  ])

  // 5. Pairwise judge (WITH vs WITHOUT)
  let pairwise: PairwiseResult = emptyPairwise
  if (!skipJudge && aggWith.summary && aggNo.summary) {
    try {
      const articleSnippet = articleText.length > ARTICLE_SNIPPET_LIMIT
        ? articleText.substring(0, ARTICLE_SNIPPET_LIMIT)
        : articleText
      const verdict = await judgePairwise(
        { label: "with_snippet", text: aggWith.summary },
        { label: "no_snippet", text: aggNo.summary },
        articleSnippet,
        { model: judgeModel, logContext: "ablation-pairwise" },
      )
      // Map A/B back to with/without — caller's "a" = with_snippet
      const mapVerdict = (v: string): "with" | "without" | "tie" => {
        if (v === "tie") return "tie"
        if (v === "A") return "with"
        return "without"
      }
      pairwise = {
        winner: mapVerdict(verdict.winner),
        per_dimension: {
          faithfulness: mapVerdict(verdict.per_dimension.faithfulness),
          coverage: mapVerdict(verdict.per_dimension.coverage),
          fluency: mapVerdict(verdict.per_dimension.fluency),
          conciseness: mapVerdict(verdict.per_dimension.conciseness),
        },
        justification: verdict.justification,
      }
    } catch { /* pairwise optional */ }
  }

  const withResult: ConditionResult = {
    summary: aggWith.summary,
    prompt_tokens: aggWith.prompt_tokens,
    completion_tokens: aggWith.completion_tokens,
    latency_ms: aggWith.latency_ms,
    axis_a: axisAWith,
    axis_b: axisBWith,
    ...(aggWith.error ? { error: aggWith.error } : {}),
  }
  const noResult: ConditionResult = {
    summary: aggNo.summary,
    prompt_tokens: aggNo.prompt_tokens,
    completion_tokens: aggNo.completion_tokens,
    latency_ms: aggNo.latency_ms,
    axis_a: axisANo,
    axis_b: axisBNo,
    ...(aggNo.error ? { error: aggNo.error } : {}),
  }

  return {
    article_length: articleText.length,
    proposers_used: proposerConfigs.map(p => p.model_name),
    successful_drafts: aggregatorDrafts.length,
    with_snippet: withResult,
    no_snippet: noResult,
    pairwise,
    axis_a_delta: {
      rouge1: computeDelta(axisAWith.rouge1, axisANo.rouge1),
      rouge2: computeDelta(axisAWith.rouge2, axisANo.rouge2),
      rougeL: computeDelta(axisAWith.rougeL, axisANo.rougeL),
      bert_score: computeDelta(axisAWith.bert_score, axisANo.bert_score),
    },
  }
}

// ── Report builder ────────────────────────────────────────────────────────────

function buildMarkdownReport(
  records: ArticleRecord[],
  startedAt: string,
  finishedAt: string,
): string {
  const lines: string[] = []
  const ok = records.filter(r => !r.error)

  lines.push("# MoA Residual Connection Ablation Study")
  lines.push("")
  lines.push("## Experiment Design")
  lines.push("")
  lines.push("| Parameter | Value |")
  lines.push("|-----------|-------|")
  lines.push(`| **Proposer models** | ${PROPOSERS.join(", ")} |`)
  lines.push(`| **Aggregator model** | ${AGGREGATOR} |`)
  lines.push(`| **Judge model** | ${SKIP_JUDGE ? "Skipped" : JUDGE_MODEL_NAME} |`)
  lines.push(`| **Articles processed** | ${records.length} (${ok.length} successful) |`)
  lines.push(`| **Started** | ${startedAt} |`)
  lines.push(`| **Finished** | ${finishedAt} |`)
  lines.push(`| **BERTScore** | ${SKIP_BERT ? "Skipped" : "Enabled"} |`)
  lines.push("")
  lines.push("> **Hypothesis**: Injecting `articleSnippet` as a residual connection into the MoA aggregator prompt improves both content retention (Axis-A) and quality (Axis-B).")
  lines.push("")
  lines.push("---")
  lines.push("")

  // ── AXIS-A ──────────────────────────────────────────────────────────────
  lines.push("## Axis-A: Content Retention")
  lines.push("")
  lines.push("*Overlap metrics vs. original article. Higher = more source-faithful.*")
  lines.push("")
  lines.push("| Metric | With `articleSnippet` | Without `articleSnippet` | Δ |")
  lines.push("|--------|----------------------|--------------------------|---|")
  for (const { key, label } of [
    { key: "rouge1" as const, label: "ROUGE-1" },
    { key: "rouge2" as const, label: "ROUGE-2" },
    { key: "rougeL" as const, label: "ROUGE-L" },
    { key: "bert_score" as const, label: "BERTScore (semantic)" },
  ]) {
    const mWith = mean(ok.map(r => r.with_snippet.axis_a[key]))
    const mNo = mean(ok.map(r => r.no_snippet.axis_a[key]))
    const delta = computeDelta(mWith, mNo)
    const arrow = delta != null ? (delta > 0.001 ? " ▲" : delta < -0.001 ? " ▼" : " ─") : ""
    lines.push(`| **${label}** | ${fmt(mWith)} | ${fmt(mNo)} | ${fmtDelta(delta)}${arrow} |`)
  }
  lines.push("")

  lines.push("### Axis-A Win Rate (n=" + ok.length + ")")
  lines.push("")
  lines.push("| Metric | With wins | Without wins | Ties | With win% |")
  lines.push("|--------|-----------|-------------|------|-----------|")
  for (const { key, label } of [
    { key: "rouge1" as const, label: "ROUGE-1" },
    { key: "rouge2" as const, label: "ROUGE-2" },
    { key: "rougeL" as const, label: "ROUGE-L" },
    { key: "bert_score" as const, label: "BERTScore" },
  ]) {
    let winsA = 0, winsB = 0, ties = 0
    for (const r of ok) {
      const a = r.with_snippet.axis_a[key], b = r.no_snippet.axis_a[key]
      if (a == null || b == null) continue
      if (Math.abs(a - b) < 0.0001) { ties++; continue }
      if (a > b) winsA++; else winsB++
    }
    const decisive = winsA + winsB
    const pct = decisive > 0 ? ((winsA / decisive) * 100).toFixed(0) + "%" : "—"
    lines.push(`| **${label}** | ${winsA} | ${winsB} | ${ties} | **${pct}** |`)
  }
  lines.push("")
  lines.push("---")
  lines.push("")

  // ── AXIS-B ──────────────────────────────────────────────────────────────
  lines.push("## Axis-B: Summary Quality (LLM Judge)")
  lines.push("")

  // Rubric scores (1–5)
  lines.push("### B-1: Rubric Scores (1–5 scale, higher = better)")
  lines.push("")
  lines.push("*Rubric judge: ' + JUDGE_MODEL_NAME + ' evaluates each summary independently on 5 dimensions.*")
  lines.push("")
  lines.push("| Dimension | With `articleSnippet` | Without `articleSnippet` | Δ |")
  lines.push("|-----------|----------------------|--------------------------|---|")
  for (const { key, label } of [
    { key: "faithfulness" as const, label: "Faithfulness" },
    { key: "coverage" as const, label: "Coverage" },
    { key: "fluency" as const, label: "Fluency" },
    { key: "conciseness" as const, label: "Conciseness" },
    { key: "overall" as const, label: "**Overall**" },
  ]) {
    const mWith = mean(ok.map(r => r.with_snippet.axis_b.rubric[key]))
    const mNo = mean(ok.map(r => r.no_snippet.axis_b.rubric[key]))
    const delta = computeDelta(mWith, mNo)
    const arrow = delta != null ? (delta > 0.05 ? " ▲" : delta < -0.05 ? " ▼" : " ─") : ""
    lines.push(`| ${label} | ${fmt(mWith, 2)} | ${fmt(mNo, 2)} | ${fmtDelta(delta, 2)}${arrow} |`)
  }
  lines.push("")

  // Rubric win rate
  lines.push("### B-1: Rubric Win Rate")
  lines.push("")
  lines.push("| Dimension | With wins | Without wins | Ties | With win% |")
  lines.push("|-----------|-----------|-------------|------|-----------|")
  for (const { key, label } of [
    { key: "faithfulness" as const, label: "Faithfulness" },
    { key: "coverage" as const, label: "Coverage" },
    { key: "fluency" as const, label: "Fluency" },
    { key: "conciseness" as const, label: "Conciseness" },
    { key: "overall" as const, label: "**Overall**" },
  ]) {
    let winsA = 0, winsB = 0, ties = 0
    for (const r of ok) {
      const a = r.with_snippet.axis_b.rubric[key], b = r.no_snippet.axis_b.rubric[key]
      if (a == null || b == null) continue
      if (Math.abs(a - b) < 0.01) { ties++; continue }
      if (a > b) winsA++; else winsB++
    }
    const decisive = winsA + winsB
    const pct = decisive > 0 ? ((winsA / decisive) * 100).toFixed(0) + "%" : "—"
    lines.push(`| ${label} | ${winsA} | ${winsB} | ${ties} | **${pct}** |`)
  }
  lines.push("")

  // Pairwise judge
  lines.push("### B-2: Pairwise Judge Win Rate (WITH vs WITHOUT)")
  lines.push("")
  lines.push("*AlpacaEval-style direct comparison: each article gets one verdict.*")
  lines.push("")
  const pairwiseRecords = ok.filter(r => r.pairwise.winner !== null)
  if (pairwiseRecords.length > 0) {
    let winsA = 0, winsB = 0, ties = 0
    for (const r of pairwiseRecords) {
      if (r.pairwise.winner === "with") winsA++
      else if (r.pairwise.winner === "without") winsB++
      else if (r.pairwise.winner === "tie") ties++
    }
    const decisive = winsA + winsB
    const pct = decisive > 0 ? ((winsA / decisive) * 100).toFixed(1) + "%" : "—"
    lines.push(`| Outcome | Count | % of decisive |`)
    lines.push(`|---------|-------|---------------|`)
    lines.push(`| **With snippet wins** | **${winsA}** | **${pct}** |`)
    lines.push(`| Without snippet wins | ${winsB} | ${decisive > 0 ? ((winsB / decisive) * 100).toFixed(1) + "%" : "—"} |`)
    lines.push(`| Ties | ${ties} | — |`)
    lines.push(`| Total evaluated | ${pairwiseRecords.length} | |`)
    lines.push("")

    // Per-dimension pairwise
    lines.push("**Per-dimension pairwise win rate:**")
    lines.push("")
    lines.push("| Dimension | With wins | Without wins | Ties |")
    lines.push("|-----------|-----------|-------------|------|")
    for (const dim of ["faithfulness", "coverage", "fluency", "conciseness"] as const) {
      let dA = 0, dB = 0, dT = 0
      for (const r of pairwiseRecords) {
        const v = r.pairwise.per_dimension[dim]
        if (v === "with") dA++
        else if (v === "without") dB++
        else if (v === "tie") dT++
      }
      lines.push(`| ${dim} | ${dA} | ${dB} | ${dT} |`)
    }
  } else {
    lines.push("*No pairwise verdicts collected (judge skipped or all failed).*")
  }
  lines.push("")

  // Factuality
  lines.push("### B-3: Factuality Scores")
  lines.push("")
  lines.push("*Claim-level entailment check: % of summary claims that can be grounded in the source.*")
  lines.push("")
  const factWith = mean(ok.map(r => r.with_snippet.axis_b.factuality.entailed_ratio))
  const factNo = mean(ok.map(r => r.no_snippet.axis_b.factuality.entailed_ratio))
  const hallWith = mean(ok.map(r => r.with_snippet.axis_b.factuality.hallucination_count))
  const hallNo = mean(ok.map(r => r.no_snippet.axis_b.factuality.hallucination_count))
  const nmWith = mean(ok.map(r => r.with_snippet.axis_b.factuality.not_mentioned_count))
  const nmNo = mean(ok.map(r => r.no_snippet.axis_b.factuality.not_mentioned_count))

  lines.push("| Metric | With `articleSnippet` | Without `articleSnippet` | Δ |")
  lines.push("|--------|----------------------|--------------------------|---|")
  const factDelta = computeDelta(factWith, factNo)
  const hallDelta = computeDelta(hallWith, hallNo)
  const nmDelta = computeDelta(nmWith, nmNo)
  lines.push(`| **Entailed ratio** (higher = fewer hallucinations) | ${fmt(factWith, 3)} | ${fmt(factNo, 3)} | ${fmtDelta(factDelta, 3)}${factDelta != null ? (factDelta > 0.005 ? " ▲" : factDelta < -0.005 ? " ▼" : " ─") : ""} |`)
  lines.push(`| Avg hallucination count (lower = better) | ${fmt(hallWith, 2)} | ${fmt(hallNo, 2)} | ${fmtDelta(hallDelta, 2)}${hallDelta != null ? (hallDelta < -0.05 ? " ▲" : hallDelta > 0.05 ? " ▼" : " ─") : ""} |`)
  lines.push(`| Avg not-mentioned count | ${fmt(nmWith, 2)} | ${fmt(nmNo, 2)} | ${fmtDelta(nmDelta, 2)} |`)
  lines.push("")

  // Factuality win rate
  let factWinsWith = 0, factWinsNo = 0, factTies = 0
  for (const r of ok) {
    const a = r.with_snippet.axis_b.factuality.entailed_ratio
    const b = r.no_snippet.axis_b.factuality.entailed_ratio
    if (a == null || b == null) continue
    if (Math.abs(a - b) < 0.001) { factTies++; continue }
    if (a > b) factWinsWith++; else factWinsNo++
  }
  const factDecisive = factWinsWith + factWinsNo
  lines.push(`*Entailed ratio per-article wins: WITH ${factWinsWith}/${factDecisive > 0 ? factDecisive : "?"} (${factDecisive > 0 ? ((factWinsWith / factDecisive) * 100).toFixed(0) + "%" : "—"}), WITHOUT ${factWinsNo}/${factDecisive > 0 ? factDecisive : "?"}, ties ${factTies}*`)
  lines.push("")
  lines.push("---")
  lines.push("")

  // ── PER-ARTICLE SUMMARY ─────────────────────────────────────────────────
  lines.push("## Per-Article Results")
  lines.push("")
  lines.push("| # | ROUGE-L (W/N) | BERTScore (W/N) | Rubric Overall (W/N) | Factuality (W/N) | Pairwise |")
  lines.push("|---|---|---|---|---|---|")
  for (const r of records) {
    if (r.error && !r.with_snippet.summary) {
      lines.push(`| ${r.index} | ERROR | ERROR | ERROR | ERROR | — |`)
      continue
    }
    const rL = `${fmt(r.with_snippet.axis_a.rougeL)} / ${fmt(r.no_snippet.axis_a.rougeL)}`
    const bs = `${fmt(r.with_snippet.axis_a.bert_score)} / ${fmt(r.no_snippet.axis_a.bert_score)}`
    const ov = `${fmt(r.with_snippet.axis_b.rubric.overall, 1)} / ${fmt(r.no_snippet.axis_b.rubric.overall, 1)}`
    const fa = `${fmt(r.with_snippet.axis_b.factuality.entailed_ratio, 2)} / ${fmt(r.no_snippet.axis_b.factuality.entailed_ratio, 2)}`
    const pw = r.pairwise.winner ? (r.pairwise.winner === "with" ? "✅ WITH" : r.pairwise.winner === "without" ? "❌ WITHOUT" : "═ Tie") : "—"
    lines.push(`| ${r.index} | ${rL} | ${bs} | ${ov} | ${fa} | ${pw} |`)
  }
  lines.push("")

  // ── CONCLUSION ──────────────────────────────────────────────────────────
  lines.push("---")
  lines.push("")
  lines.push("## Summary & Conclusion")
  lines.push("")

  const axisAWins = [
    computeDelta(mean(ok.map(r => r.with_snippet.axis_a.rouge1)), mean(ok.map(r => r.no_snippet.axis_a.rouge1))),
    computeDelta(mean(ok.map(r => r.with_snippet.axis_a.rouge2)), mean(ok.map(r => r.no_snippet.axis_a.rouge2))),
    computeDelta(mean(ok.map(r => r.with_snippet.axis_a.rougeL)), mean(ok.map(r => r.no_snippet.axis_a.rougeL))),
    computeDelta(mean(ok.map(r => r.with_snippet.axis_a.bert_score)), mean(ok.map(r => r.no_snippet.axis_a.bert_score))),
  ].filter(d => d != null && d > 0).length

  const axisBWins = [
    computeDelta(mean(ok.map(r => r.with_snippet.axis_b.rubric.overall)), mean(ok.map(r => r.no_snippet.axis_b.rubric.overall))),
    computeDelta(factWith, factNo),
  ].filter(d => d != null && d > 0).length

  lines.push(`- **Axis-A (Content Retention):** ${axisAWins}/4 metrics favour WITH — ${axisAWins >= 3 ? "residual connection improves source grounding ✅" : axisAWins >= 2 ? "inconclusive, slight positive trend" : "residual connection does not consistently help ❌"}`)
  lines.push(`- **Axis-B (Quality):**`)
  lines.push(`  - Rubric overall score WITH=${fmt(mean(ok.map(r => r.with_snippet.axis_b.rubric.overall)), 2)}, WITHOUT=${fmt(mean(ok.map(r => r.no_snippet.axis_b.rubric.overall)), 2)} (Δ=${fmtDelta(computeDelta(mean(ok.map(r => r.with_snippet.axis_b.rubric.overall)), mean(ok.map(r => r.no_snippet.axis_b.rubric.overall))), 2)})`)
  if (pairwiseRecords.length > 0) {
    const winsA = pairwiseRecords.filter(r => r.pairwise.winner === "with").length
    const decisive = pairwiseRecords.filter(r => r.pairwise.winner !== "tie").length
    lines.push(`  - Pairwise judge: WITH wins ${winsA}/${pairwiseRecords.length} verdicts (${decisive > 0 ? ((winsA / decisive) * 100).toFixed(0) + "% of decisive" : "—"})`)
  }
  lines.push(`  - Factuality (entailed ratio): WITH=${fmt(factWith, 3)}, WITHOUT=${fmt(factNo, 3)} (Δ=${fmtDelta(factDelta, 3)})`)
  lines.push("")
  lines.push("*Statistical significance: use paired sign-test on per-article deltas for thesis reporting.*")

  return lines.join("\n")
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const urlsAll = loadUrls(INPUT_PATH)
  const urls = LIMIT > 0 ? urlsAll.slice(0, LIMIT) : urlsAll

  if (urls.length === 0) { console.error("No URLs to process."); process.exit(1) }

  console.log("=".repeat(70))
  console.log("MoA RESIDUAL CONNECTION ABLATION STUDY")
  console.log("=".repeat(70))
  console.log(`Input:       ${INPUT_PATH}`)
  console.log(`Output:      ${OUTPUT_PATH}`)
  console.log(`Articles:    ${urls.length}`)
  console.log(`Proposers:   ${PROPOSERS.join(", ")}`)
  console.log(`Aggregator:  ${AGGREGATOR}`)
  console.log(`Judge:       ${SKIP_JUDGE ? "Skipped" : JUDGE_MODEL_NAME}`)
  console.log(`BERTScore:   ${SKIP_BERT ? "Skipped" : "Enabled"}`)
  console.log(`Timeout:     ${TIMEOUT_MS}ms`)
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
  if (!judgeModel && !SKIP_JUDGE) throw new Error(`Judge model "${JUDGE_MODEL_NAME}" not found`)

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
      const empty = (m: string): ConditionResult => ({
        summary: null, prompt_tokens: null, completion_tokens: null, latency_ms: 0,
        axis_a: { rouge1: null, rouge2: null, rougeL: null, bert_score: null },
        axis_b: { rubric: { faithfulness: null, coverage: null, fluency: null, conciseness: null, overall: null }, factuality: { entailed_ratio: null, total_claims: null, hallucination_count: null, not_mentioned_count: null } },
        error: m,
      })
      result = {
        article_length: 0, proposers_used: PROPOSERS, successful_drafts: 0,
        with_snippet: empty(msg), no_snippet: empty(msg),
        pairwise: { winner: null, per_dimension: { faithfulness: null, coverage: null, fluency: null, conciseness: null }, justification: null },
        axis_a_delta: { rouge1: null, rouge2: null, rougeL: null, bert_score: null },
        error: msg,
      }
    }

    records.push({ index: i + 1, url, ...result })

    if (!result.error) {
      const ws = result.with_snippet, ns = result.no_snippet
      console.log(
        `  ✓ drafts=${result.successful_drafts}  |` +
        `  ROUGE-L  W=${fmt(ws.axis_a.rougeL)} N=${fmt(ns.axis_a.rougeL)} Δ=${fmtDelta(result.axis_a_delta.rougeL)}  |` +
        `  BERT  W=${fmt(ws.axis_a.bert_score)} N=${fmt(ns.axis_a.bert_score)}`,
      )
      console.log(
        `  Rubric overall  W=${fmt(ws.axis_b.rubric.overall, 1)} N=${fmt(ns.axis_b.rubric.overall, 1)}  |` +
        `  Factuality  W=${fmt(ws.axis_b.factuality.entailed_ratio, 2)} N=${fmt(ns.axis_b.factuality.entailed_ratio, 2)}  |` +
        `  Pairwise: ${result.pairwise.winner ?? "—"}`,
      )
    }
  }

  const finishedAt = new Date().toISOString()

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true })
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify({
    experiment: "residual-connection-ablation",
    started_at: startedAt,
    finished_at: finishedAt,
    config: { proposers: PROPOSERS, aggregator: AGGREGATOR, judge_model: JUDGE_MODEL_NAME, bert_enabled: !SKIP_BERT, judge_enabled: !SKIP_JUDGE, articles_processed: records.length },
    records,
  }, null, 2))
  fs.writeFileSync(SUMMARY_PATH, buildMarkdownReport(records, startedAt, finishedAt))

  // Console aggregate
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
    const mW = mean(ok.map(r => r.with_snippet.axis_a[key]))
    const mN = mean(ok.map(r => r.no_snippet.axis_a[key]))
    console.log(`  ${label}  WITH=${fmt(mW)}  NO=${fmt(mN)}  Δ=${fmtDelta(computeDelta(mW, mN))} ${computeDelta(mW, mN) != null ? ((computeDelta(mW, mN)! > 0) ? "▲" : "▼") : ""}`)
  }
  console.log("Axis-B (Quality — LLM Judge):")
  const rubricKeys = ["faithfulness", "coverage", "fluency", "conciseness", "overall"] as const
  for (const key of rubricKeys) {
    const mW = mean(ok.map(r => r.with_snippet.axis_b.rubric[key]))
    const mN = mean(ok.map(r => r.no_snippet.axis_b.rubric[key]))
    console.log(`  Rubric ${key.padEnd(11)}  WITH=${fmt(mW, 2)}  NO=${fmt(mN, 2)}  Δ=${fmtDelta(computeDelta(mW, mN), 2)}`)
  }
  const pairwiseRecords = ok.filter(r => r.pairwise.winner !== null)
  if (pairwiseRecords.length > 0) {
    const wA = pairwiseRecords.filter(r => r.pairwise.winner === "with").length
    const wB = pairwiseRecords.filter(r => r.pairwise.winner === "without").length
    const t = pairwiseRecords.filter(r => r.pairwise.winner === "tie").length
    console.log(`  Pairwise           WITH wins=${wA}  WITHOUT wins=${wB}  Ties=${t}  (n=${pairwiseRecords.length})`)
  }
  const fW = mean(ok.map(r => r.with_snippet.axis_b.factuality.entailed_ratio))
  const fN = mean(ok.map(r => r.no_snippet.axis_b.factuality.entailed_ratio))
  console.log(`  Factuality ratio   WITH=${fmt(fW, 3)}  NO=${fmt(fN, 3)}  Δ=${fmtDelta(computeDelta(fW, fN), 3)}`)
  console.log("")
  console.log(`JSON  → ${OUTPUT_PATH}`)
  console.log(`MD    → ${SUMMARY_PATH}`)
}

main().catch(err => { console.error("FATAL:", err); process.exit(1) })
