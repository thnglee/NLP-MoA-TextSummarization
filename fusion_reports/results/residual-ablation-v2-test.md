# MoA Residual Connection Ablation Study

## Experiment Design

| Parameter | Value |
|-----------|-------|
| **Proposer models** | gpt-4o-mini, gemini-2.5-flash, claude-haiku-4-5 |
| **Aggregator model** | gpt-4o |
| **Judge model** | gpt-4o-mini |
| **Articles processed** | 3 (3 successful) |
| **Started** | 2026-06-04T10:01:25.634Z |
| **Finished** | 2026-06-04T10:03:35.566Z |
| **BERTScore** | Skipped |

> **Hypothesis**: Injecting `articleSnippet` as a residual connection into the MoA aggregator prompt improves both content retention (Axis-A) and quality (Axis-B).

---

## Axis-A: Content Retention

*Overlap metrics vs. original article. Higher = more source-faithful.*

| Metric | With `articleSnippet` | Without `articleSnippet` | Δ |
|--------|----------------------|--------------------------|---|
| **ROUGE-1** | 0.3023 | 0.3180 | -0.0156 ▼ |
| **ROUGE-2** | 0.2633 | 0.2731 | -0.0098 ▼ |
| **ROUGE-L** | 0.2450 | 0.2237 | +0.0213 ▲ |
| **BERTScore (semantic)** | — | — | — |

### Axis-A Win Rate (n=3)

| Metric | With wins | Without wins | Ties | With win% |
|--------|-----------|-------------|------|-----------|
| **ROUGE-1** | 2 | 1 | 0 | **67%** |
| **ROUGE-2** | 2 | 1 | 0 | **67%** |
| **ROUGE-L** | 3 | 0 | 0 | **100%** |
| **BERTScore** | 0 | 0 | 0 | **—** |

---

## Axis-B: Summary Quality (LLM Judge)

### B-1: Rubric Scores (1–5 scale, higher = better)

*Rubric judge: ' + JUDGE_MODEL_NAME + ' evaluates each summary independently on 5 dimensions.*

| Dimension | With `articleSnippet` | Without `articleSnippet` | Δ |
|-----------|----------------------|--------------------------|---|
| Faithfulness | 5.00 | 5.00 | +0.00 ─ |
| Coverage | 4.67 | 4.67 | +0.00 ─ |
| Fluency | 5.00 | 5.00 | +0.00 ─ |
| Conciseness | 4.67 | 5.00 | -0.33 ▼ |
| **Overall** | 4.67 | 5.00 | -0.33 ▼ |

### B-1: Rubric Win Rate

| Dimension | With wins | Without wins | Ties | With win% |
|-----------|-----------|-------------|------|-----------|
| Faithfulness | 0 | 0 | 3 | **—** |
| Coverage | 0 | 0 | 3 | **—** |
| Fluency | 0 | 0 | 3 | **—** |
| Conciseness | 0 | 1 | 2 | **0%** |
| **Overall** | 0 | 1 | 2 | **0%** |

### B-2: Pairwise Judge Win Rate (WITH vs WITHOUT)

*AlpacaEval-style direct comparison: each article gets one verdict.*

| Outcome | Count | % of decisive |
|---------|-------|---------------|
| **With snippet wins** | **1** | **33.3%** |
| Without snippet wins | 2 | 66.7% |
| Ties | 0 | — |
| Total evaluated | 3 | |

**Per-dimension pairwise win rate:**

| Dimension | With wins | Without wins | Ties |
|-----------|-----------|-------------|------|
| faithfulness | 1 | 1 | 1 |
| coverage | 1 | 2 | 0 |
| fluency | 1 | 2 | 0 |
| conciseness | 1 | 2 | 0 |

### B-3: Factuality Scores

*Claim-level entailment check: % of summary claims that can be grounded in the source.*

| Metric | With `articleSnippet` | Without `articleSnippet` | Δ |
|--------|----------------------|--------------------------|---|
| **Entailed ratio** (higher = fewer hallucinations) | 0.804 | 0.717 | +0.087 ▲ |
| Avg hallucination count (lower = better) | 0.00 | 0.00 | +0.00 ─ |
| Avg not-mentioned count | 3.33 | 5.33 | -2.00 |

*Entailed ratio per-article wins: WITH 2/3 (67%), WITHOUT 1/3, ties 0*

---

## Per-Article Results

| # | ROUGE-L (W/N) | BERTScore (W/N) | Rubric Overall (W/N) | Factuality (W/N) | Pairwise |
|---|---|---|---|---|---|
| 1 | 0.1371 / 0.1236 | — / — | 4.0 / 5.0 | 0.59 / 0.50 | ❌ WITHOUT |
| 2 | 0.3235 / 0.3154 | — / — | 5.0 / 5.0 | 0.90 / 1.00 | ❌ WITHOUT |
| 3 | 0.2744 / 0.2322 | — / — | 5.0 / 5.0 | 0.92 / 0.65 | ✅ WITH |

---

## Summary & Conclusion

- **Axis-A (Content Retention):** 1/4 metrics favour WITH — residual connection does not consistently help ❌
- **Axis-B (Quality):**
  - Rubric overall score WITH=4.67, WITHOUT=5.00 (Δ=-0.33)
  - Pairwise judge: WITH wins 1/3 verdicts (33% of decisive)
  - Factuality (entailed ratio): WITH=0.804, WITHOUT=0.717 (Δ=+0.087)

*Statistical significance: use paired sign-test on per-article deltas for thesis reporting.*