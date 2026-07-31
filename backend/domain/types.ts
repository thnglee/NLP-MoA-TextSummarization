/**
 * Domain Types
 * 
 * Core domain types used across the NLP MoA Text Summarization project.
 * Types are inferred from Zod schemas in schemas.ts for single source of truth.
 */

import type {
  SummarizeRequest,
  SummarizeResponse,
  SummarizeDebugInfo,
  SummaryData,
  LogEntry,
  Env,
} from "./schemas"

// Re-export schema-inferred types for convenience
export type {
  SummarizeRequest,
  SummarizeResponse,
  SummarizeDebugInfo,
  SummaryData,
  LogEntry,
  Env,
}

// ============================================================================
// Content Extraction Domain Types
// ============================================================================

/**
 * Extracted content from a URL
 */
export interface ExtractedContent {
  content: string
  title?: string
  excerpt?: string
}

// ============================================================================
// LLM Domain Types
// ============================================================================

/**
 * HuggingFace Inference API task types
 */
export type HFModelType = 'text-generation' | 'text2text-generation'

/**
 * Options for LLM completion requests
 */
export interface LLMCompletionOptions {
  prompt: string
  debug?: boolean
  logContext?: string
  schema?: any // Zod schema for structured output (z.ZodSchema<any>)
  // Multi-provider fields
  model?: string
  provider?: 'openai' | 'gemini' | 'anthropic' | 'huggingface'
  modelType?: 'standard' | 'reasoning' | 'chat' | 'base'
  hfModelId?: string    // full HF model ID e.g. 'VietAI/vit5-large-vietnews-summarization'
  hfTaskType?: HFModelType
  temperature?: number
  topP?: number
  topK?: number           // forwarded to Gemini/Anthropic only
  maxTokens?: number
  frequencyPenalty?: number  // OpenAI standard only
  presencePenalty?: number   // OpenAI standard only
  seed?: number              // OpenAI + Gemini only
}

/**
 * Token usage information from LLM completion
 */
export interface LLMUsage {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
}

/**
 * Result from LLM completion with parsed data
 */
export interface LLMCompletionResult<T = any> {
  data: T
  rawResponse: string
  model: string
  usage?: LLMUsage
  debugInfo?: {
    raw: string
    model: string
    usage?: LLMUsage
  }
}

/**
 * Model configuration from Supabase model_configurations table
 */
export interface ModelConfig {
  id: string
  provider: 'openai' | 'gemini' | 'anthropic' | 'huggingface'
  model_name: string
  display_name: string
  model_type: 'standard' | 'reasoning' | 'chat' | 'base'
  is_active: boolean
  temperature: number
  top_p: number | null
  top_k: number | null
  max_tokens: number | null
  min_tokens: number | null
  frequency_penalty: number | null
  presence_penalty: number | null
  seed: number | null
  context_window: number
  supports_streaming: boolean
  supports_structured_output: boolean
  supports_temperature: boolean
  input_cost_per_1m: number | null
  output_cost_per_1m: number | null
}

/**
 * Routing decision logged for every summarization request
 */
export interface RoutingDecision {
  id?: string
  article_length: number
  article_tokens: number
  category?: string
  complexity: 'short' | 'medium' | 'long'
  routing_mode: 'auto' | 'evaluation' | 'forced' | 'fusion'
  selected_model: string
  fallback_used: boolean
  fallback_reason?: string
  created_at?: string
}

/**
 * Per-model result in evaluation mode (parallel run)
 */
export interface ModelComparisonResult {
  id?: string
  routing_id?: string
  model_name: string
  summary: string
  bert_score?: number | null
  rouge1?: number | null
  prompt_tokens?: number | null
  completion_tokens?: number | null
  estimated_cost_usd?: number | null
  latency_ms?: number | null
  selected: boolean
  created_at?: string
}

/**
 * Result from fusion service (evaluation mode)
 */
export interface FusionResult {
  winner: { summary: string; model: string; category: string; readingTime: number }
  candidates: ModelComparisonResult[]
  routingId: string
}

// ============================================================================
// MoA Output Fusion — re-exports
// ============================================================================

export type {
  MoAConfig,
  MoADraftResult,
  MoADraftStatus,
  MoAFusionResult,
  MoAScoredDraft,
  MoAScores,
  ModelAvailability,
} from "@/output-fusion/moa.types"

// ============================================================================
// Logging Domain Types
// ============================================================================

/**
 * Log type categories
 */
export type LogType = "fact-check" | "summarize" | "search" | "llm" | "content-extraction" | "api"

/**
 * Log stage/phase within a process
 */
export type LogStage =
  | "input"
  | "output"
  | "prompt"
  | "response"
  | "content-extraction"
  | "content-input"
  | "schema-validation-fallback"
  | "json-parse-error"
  | "structured-output-parse-error"
  | "schema-validation-error"

/**
 * Log entry with typed category
 */
export interface TypedLogEntry extends Omit<LogEntry, "type" | "stage"> {
  type: LogType
  stage: LogStage
}

// ============================================================================
// API Error Types
// ============================================================================

/**
 * Standard API error response
 */
export interface ApiError {
  error: string
  message?: string
  code?: string
  details?: any
  hint?: string
}

/**
 * API response wrapper for consistent responses
 */
export interface ApiResponse<T = any> {
  data?: T
  error?: ApiError
  success: boolean
}

// ============================================================================
// HTTP Request/Response Types
// ============================================================================

/**
 * HTTP method types
 */
export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "OPTIONS"

/**
 * CORS headers configuration
 */
export interface CorsHeaders {
  "Access-Control-Allow-Origin": string
  "Access-Control-Allow-Methods": string
  "Access-Control-Allow-Headers": string
  "Access-Control-Max-Age"?: string
}

// ============================================================================
// Utility Types
// ============================================================================

/**
 * Make specific properties optional
 */
export type PartialBy<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>

/**
 * Make specific properties required
 */
export type RequiredBy<T, K extends keyof T> = Omit<T, K> & Required<Pick<T, K>>

/**
 * Extract debug info type from response types
 */
export type DebugInfo<T> = T extends { debug?: infer D } ? D : never

/**
 * Response type without debug info
 */
export type ResponseWithoutDebug<T> = Omit<T, "debug">
