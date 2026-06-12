# MoA Residual Connection Ablation Study

## Experiment Design

| Parameter | Value |
|-----------|-------|
| **Proposer models** | gpt-4o-mini, gemini-2.5-flash, claude-haiku-4-5 |
| **Aggregator model** | gpt-4o |
| **Judge model** | gpt-4o-mini |
| **Articles processed** | 50 (50 successful) |
| **Started** | 2026-06-04T10:10:55.556Z |
| **Finished** | 2026-06-04T10:41:45.057Z |
| **BERTScore** | Enabled |

> **Hypothesis**: Injecting `articleSnippet` as a residual connection into the MoA aggregator prompt improves both content retention (Axis-A) and quality (Axis-B).

---

## Axis-A: Content Retention

*Overlap metrics vs. original article. Higher = more source-faithful.*

| Metric | With `articleSnippet` | Without `articleSnippet` | Δ |
|--------|----------------------|--------------------------|---|
| **ROUGE-1** | 0.4277 | 0.3739 | +0.0538 ▲ |
| **ROUGE-2** | 0.3661 | 0.3050 | +0.0610 ▲ |
| **ROUGE-L** | 0.3286 | 0.2635 | +0.0650 ▲ |
| **BERTScore (semantic)** | 0.6618 | 0.6306 | +0.0312 ▲ |

### Axis-A Win Rate (n=50)

| Metric | With wins | Without wins | Ties | With win% |
|--------|-----------|-------------|------|-----------|
| **ROUGE-1** | 40 | 10 | 0 | **80%** |
| **ROUGE-2** | 41 | 9 | 0 | **82%** |
| **ROUGE-L** | 43 | 6 | 1 | **88%** |
| **BERTScore** | 36 | 7 | 0 | **84%** |

---

## Axis-B: Summary Quality (LLM Judge)

### B-1: Rubric Scores (1–5 scale, higher = better)

*Rubric judge: ' + JUDGE_MODEL_NAME + ' evaluates each summary independently on 5 dimensions.*

| Dimension | With `articleSnippet` | Without `articleSnippet` | Δ |
|-----------|----------------------|--------------------------|---|
| Faithfulness | 4.98 | 4.98 | +0.00 ─ |
| Coverage | 4.88 | 4.82 | +0.06 ▲ |
| Fluency | 4.98 | 5.00 | -0.02 ─ |
| Conciseness | 4.88 | 4.86 | +0.02 ─ |
| **Overall** | 4.94 | 4.88 | +0.06 ▲ |

### B-1: Rubric Win Rate

| Dimension | With wins | Without wins | Ties | With win% |
|-----------|-----------|-------------|------|-----------|
| Faithfulness | 1 | 1 | 48 | **50%** |
| Coverage | 7 | 4 | 39 | **64%** |
| Fluency | 0 | 1 | 49 | **0%** |
| Conciseness | 6 | 5 | 39 | **55%** |
| **Overall** | 5 | 2 | 43 | **71%** |

### B-2: Pairwise Judge Win Rate (WITH vs WITHOUT)

*AlpacaEval-style direct comparison: each article gets one verdict.*

| Outcome | Count | % of decisive |
|---------|-------|---------------|
| **With snippet wins** | **29** | **65.9%** |
| Without snippet wins | 15 | 34.1% |
| Ties | 6 | — |
| Total evaluated | 50 | |

**Per-dimension pairwise win rate:**

| Dimension | With wins | Without wins | Ties |
|-----------|-----------|-------------|------|
| faithfulness | 14 | 11 | 25 |
| coverage | 28 | 16 | 6 |
| fluency | 28 | 16 | 6 |
| conciseness | 17 | 24 | 9 |

### B-3: Factuality Scores

*Claim-level entailment check: % of summary claims that can be grounded in the source.*

| Metric | With `articleSnippet` | Without `articleSnippet` | Δ |
|--------|----------------------|--------------------------|---|
| **Entailed ratio** (higher = fewer hallucinations) | 0.847 | 0.830 | +0.017 ▲ |
| Avg hallucination count (lower = better) | 0.04 | 0.12 | -0.08 ▲ |
| Avg not-mentioned count | 2.86 | 2.90 | -0.04 |

*Entailed ratio per-article wins: WITH 25/40 (63%), WITHOUT 15/40, ties 10*

---

## Per-Article Results

| # | ROUGE-L (W/N) | BERTScore (W/N) | Rubric Overall (W/N) | Factuality (W/N) | Pairwise |
|---|---|---|---|---|---|
| 1 | 0.1740 / 0.1236 | 0.6074 / 0.5507 | 4.0 / 4.0 | 0.50 / 0.35 | ✅ WITH |
| 2 | 0.4007 / 0.3190 | — / 0.6161 | 5.0 / 5.0 | 0.80 / 1.00 | ✅ WITH |
| 3 | 0.3127 / 0.2401 | 0.6280 / 0.6081 | 5.0 / 5.0 | 0.90 / 0.88 | ❌ WITHOUT |
| 4 | 0.2704 / 0.2128 | 0.7094 / 0.6654 | 5.0 / 5.0 | 1.00 / 0.85 | ✅ WITH |
| 5 | 0.2709 / 0.2770 | 0.6714 / 0.6866 | 5.0 / 5.0 | 1.00 / 1.00 | ❌ WITHOUT |
| 6 | 0.2947 / 0.2792 | 0.6901 / — | 5.0 / 5.0 | 0.90 / 1.00 | ✅ WITH |
| 7 | 0.1794 / 0.1539 | 0.6230 / 0.5836 | 4.0 / 5.0 | 0.85 / 0.63 | ❌ WITHOUT |
| 8 | 0.3143 / 0.2573 | 0.6901 / 0.6142 | 5.0 / 5.0 | 0.94 / 1.00 | ✅ WITH |
| 9 | 0.3337 / 0.3230 | 0.6846 / 0.6592 | 5.0 / 5.0 | 1.00 / 0.81 | ❌ WITHOUT |
| 10 | 0.3366 / 0.3150 | 0.6885 / 0.6616 | 5.0 / 5.0 | 1.00 / 1.00 | ✅ WITH |
| 11 | 0.4297 / 0.3903 | 0.6303 / — | 5.0 / 5.0 | 1.00 / 1.00 | ❌ WITHOUT |
| 12 | 0.2281 / 0.2185 | 0.5484 / 0.5682 | 5.0 / 5.0 | 0.85 / 0.74 | ✅ WITH |
| 13 | 0.1770 / 0.1887 | 0.6253 / 0.6398 | 5.0 / 5.0 | 1.00 / 1.00 | ❌ WITHOUT |
| 14 | 0.3938 / 0.2693 | 0.6421 / 0.6303 | 5.0 / 5.0 | 1.00 / 0.89 | ✅ WITH |
| 15 | 0.5011 / 0.3490 | 0.7265 / 0.6594 | 5.0 / 5.0 | 1.00 / 1.00 | ✅ WITH |
| 16 | 0.3449 / 0.2156 | 0.7214 / 0.5984 | 5.0 / 4.0 | 1.00 / 1.00 | ✅ WITH |
| 17 | 0.2172 / 0.1564 | — / — | 4.0 / 5.0 | 0.79 / 0.79 | ✅ WITH |
| 18 | 0.3352 / 0.2276 | 0.6978 / 0.6763 | 5.0 / 4.0 | 0.80 / 0.71 | ✅ WITH |
| 19 | 0.3286 / 0.3585 | 0.6317 / 0.6249 | 5.0 / 5.0 | 0.90 / 1.00 | ✅ WITH |
| 20 | 0.1827 / 0.2003 | 0.5666 / 0.5647 | 5.0 / 5.0 | 0.78 / 0.85 | ❌ WITHOUT |
| 21 | 0.1359 / 0.1304 | 0.6578 / 0.6370 | 5.0 / 5.0 | 0.50 / 0.53 | ═ Tie |
| 22 | 0.3414 / 0.2497 | 0.6628 / 0.6300 | 5.0 / 5.0 | 1.00 / 1.00 | ❌ WITHOUT |
| 23 | 0.3342 / 0.2817 | — / 0.6644 | 5.0 / 5.0 | 1.00 / 0.94 | ✅ WITH |
| 24 | 0.4905 / 0.3190 | 0.6963 / 0.6392 | 5.0 / 5.0 | 1.00 / 1.00 | ✅ WITH |
| 25 | 0.1794 / 0.1588 | 0.6817 / 0.6752 | 5.0 / 4.0 | 0.56 / 0.72 | ✅ WITH |
| 26 | 0.2833 / 0.2675 | 0.6437 / 0.6245 | 5.0 / 5.0 | 1.00 / 0.94 | ✅ WITH |
| 27 | 0.3446 / 0.3108 | 0.7224 / 0.6482 | 5.0 / 5.0 | 1.00 / 0.95 | ❌ WITHOUT |
| 28 | 0.3790 / 0.2361 | 0.7330 / 0.6413 | 5.0 / 5.0 | 0.60 / 0.80 | ❌ WITHOUT |
| 29 | 0.2347 / 0.1982 | 0.6101 / 0.5804 | 5.0 / 5.0 | 0.30 / 0.35 | ✅ WITH |
| 30 | 0.2043 / 0.1748 | 0.6426 / 0.6145 | 5.0 / 4.0 | 0.65 / 0.60 | ✅ WITH |
| 31 | 0.3087 / 0.2361 | 0.6282 / 0.6048 | 5.0 / 5.0 | 0.93 / 0.90 | ❌ WITHOUT |
| 32 | 0.7824 / 0.2983 | 0.9005 / 0.6603 | 5.0 / 5.0 | 1.00 / 0.95 | ✅ WITH |
| 33 | 0.1287 / 0.0927 | 0.5675 / 0.5549 | 5.0 / 4.0 | 0.67 / 0.85 | ✅ WITH |
| 34 | 0.4254 / 0.3911 | 0.7403 / 0.7103 | 5.0 / 5.0 | 1.00 / 0.93 | ✅ WITH |
| 35 | 0.2876 / 0.2240 | — / 0.6106 | 5.0 / 5.0 | 0.90 / 0.85 | ═ Tie |
| 36 | 0.6705 / 0.4205 | 0.7757 / 0.7371 | 5.0 / 5.0 | 1.00 / 0.86 | ✅ WITH |
| 37 | 0.2620 / 0.2488 | 0.6628 / 0.6459 | 5.0 / 5.0 | 0.89 / 0.83 | ✅ WITH |
| 38 | 0.4176 / 0.3170 | 0.6980 / 0.6633 | 5.0 / 5.0 | 0.90 / 0.75 | ❌ WITHOUT |
| 39 | 0.3050 / 0.2532 | 0.5880 / 0.5874 | 5.0 / 5.0 | 0.89 / 0.93 | ❌ WITHOUT |
| 40 | 0.3279 / 0.2561 | 0.6726 / 0.6314 | 5.0 / 5.0 | 0.95 / 0.94 | ═ Tie |
| 41 | 0.2884 / 0.2884 | 0.6282 / 0.6311 | 5.0 / 5.0 | 0.60 / 0.65 | ❌ WITHOUT |
| 42 | 0.3372 / 0.3519 | 0.6193 / 0.6154 | 5.0 / 5.0 | 1.00 / 1.00 | ✅ WITH |
| 43 | 0.7087 / 0.5631 | 0.6757 / 0.6573 | 5.0 / 5.0 | 0.55 / 0.58 | ✅ WITH |
| 44 | 0.1800 / 0.1629 | 0.6118 / 0.6090 | 5.0 / 5.0 | 0.55 / 0.50 | ═ Tie |
| 45 | 0.3133 / 0.2522 | — / 0.6315 | 5.0 / 5.0 | 1.00 / 1.00 | ═ Tie |
| 46 | 0.2526 / 0.2583 | 0.6140 / 0.6328 | 5.0 / 5.0 | 0.83 / 0.89 | ✅ WITH |
| 47 | 0.6640 / 0.4720 | 0.7037 / 0.6146 | 5.0 / 5.0 | 0.50 / 0.55 | ✅ WITH |
| 48 | 0.2714 / 0.2132 | 0.6453 / 0.6433 | 5.0 / 5.0 | 0.90 / 0.88 | ✅ WITH |
| 49 | 0.3159 / 0.2483 | 0.5886 / 0.5999 | 5.0 / 5.0 | 0.95 / 0.65 | ❌ WITHOUT |
| 50 | 0.2288 / 0.2272 | 0.6269 / 0.6340 | 5.0 / 5.0 | 0.75 / 0.70 | ═ Tie |

---

## Summary & Conclusion

- **Axis-A (Content Retention):** 4/4 metrics favour WITH — residual connection improves source grounding ✅
- **Axis-B (Quality):**
  - Rubric overall score WITH=4.94, WITHOUT=4.88 (Δ=+0.06)
  - Pairwise judge: WITH wins 29/50 verdicts (66% of decisive)
  - Factuality (entailed ratio): WITH=0.847, WITHOUT=0.830 (Δ=+0.017)

*Statistical significance: use paired sign-test on per-article deltas for thesis reporting.*