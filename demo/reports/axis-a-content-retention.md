# Trục A — Content Retention Metrics

> Generated: 2026-05-25T15:57:41.709Z
> Total rows: 3236

> **Lưu ý:** ROUGE / BLEU / BERTScore được tính so với bài gốc (không phải
> tóm tắt tham chiếu). Chúng đo content retention, không phải chất lượng tóm tắt.
> Axis B là tín hiệu chính; Axis A chỉ là bổ sung.

## Table 4.1 — Content Retention by Approach

| Approach (mode | model) | n | ROUGE-1 | ROUGE-2 | ROUGE-L | BLEU | BERTScore | Compression % |
| --- | --- | --- | --- | --- | --- | --- | --- |
| fusion | moa:gpt-4.1 | 1 | 0.9808 | 0.9126 | 0.9423 | 0.5361 | 0.8543 | 121.74 |
| sync | VietAI/vit5-large-vietnews-summarization | 124 | 0.2479 | 0.2470 | 0.2479 | 0.1174 | 0.8514 | 25.59 |
| sync | gpt-4.1-2025-04-14 | 1 | 0.9519 | 0.7864 | 0.8654 | 0.3842 | 0.7980 | 122.83 |
| fusion | moa:gpt-4o-mini | 2 | 0.9712 | 0.8058 | 0.8846 | 0.3661 | 0.7603 | 148.37 |
| sync | gemini-flash-latest | 1 | 0.9242 | 0.7077 | 0.6515 | 0.1926 | 0.6717 | 151.79 |
| sync | claude-sonnet-4-5-20250929 | 16 | 0.3295 | 0.2909 | 0.2650 | 0.0852 | 0.6644 | 32.37 |
| sync | claude-haiku-4-5-20251001 | 289 | 0.3546 | 0.3094 | 0.2897 | 0.0906 | 0.6551 | 36.09 |
| sync | gemini-2.5-flash | 228 | 0.3467 | 0.2961 | 0.2678 | 0.0873 | 0.6525 | 33.41 |
| fusion_ranker_only | ranker:gemini-2.5-flash | 4 | 0.3772 | 0.3296 | 0.2824 | 0.0978 | 0.6493 | 35.22 |
| stream | gpt-4o-mini-2024-07-18 | 313 | 0.2484 | 0.1983 | 0.1889 | 0.0330 | 0.6426 | 23.31 |
| fusion | moa:gpt-4o | 431 | 0.3273 | 0.2752 | 0.2532 | 0.0747 | 0.6387 | 34.91 |
| sync | o4-mini-2025-04-16 | 203 | 0.3250 | 0.2693 | 0.2470 | 0.0592 | 0.6364 | 33.78 |
| fusion_ranker_only | ranker:claude-haiku-4-5 | 3 | 0.3013 | 0.2668 | 0.2357 | 0.0537 | 0.6360 | 29.57 |
| sync | gpt-4.1-mini-2025-04-14 | 213 | 0.2974 | 0.2466 | 0.2262 | 0.0489 | 0.6285 | 28.94 |
| sync | gpt-4o-mini-2024-07-18 | 945 | 0.2467 | 0.1985 | 0.1910 | 0.0308 | 0.6256 | 26.45 |
| sync | gpt-4o-2024-08-06 | 327 | 0.3453 | 0.2809 | 0.2477 | 0.0669 | 0.6255 | 48.41 |
| sync | gemini-3.1-flash-lite-preview | 14 | 0.2852 | 0.2194 | 0.2075 | 0.0550 | 0.6205 | 28.86 |
| fusion_ranker_only | ranker:gpt-4o-mini | 3 | 0.2871 | 0.2335 | 0.2310 | 0.0530 | 0.6198 | 27.33 |
| sync | gemini-3-flash-preview | 25 | 0.2971 | 0.2357 | 0.2128 | 0.0488 | 0.6166 | 27.69 |
| stream | gpt-4o | 57 | 0.2801 | 0.2266 | 0.2021 | 0.0208 | 0.6041 | 25.10 |
| stream | gpt-4o-mini | 33 | 0.1242 | 0.1059 | 0.1002 | 0.0079 | 0.5890 | 11.64 |
| sync | o3-mini-2025-01-31 | 3 | 0.1401 | 0.1183 | 0.1044 | 0.0008 | 0.5835 | 12.80 |

## Δ (Fused − Từng model đơn lẻ)

| vs | Δ ROUGE-1 | Δ ROUGE-L | Δ BLEU | Δ BERTScore |
| --- | --- | --- | --- | --- |
| sync | VietAI/vit5-large-vietnews-summarization | 0.7329 | 0.6944 | 0.4187 | 0.0029 |
| sync | gpt-4.1-2025-04-14 | 0.0289 | 0.0769 | 0.1519 | 0.0563 |
| sync | gemini-flash-latest | 0.0566 | 0.2908 | 0.3435 | 0.1826 |
| sync | claude-sonnet-4-5-20250929 | 0.6513 | 0.6773 | 0.4509 | 0.1899 |
| sync | claude-haiku-4-5-20251001 | 0.6262 | 0.6526 | 0.4455 | 0.1992 |
| sync | gemini-2.5-flash | 0.6341 | 0.6745 | 0.4488 | 0.2018 |
| fusion_ranker_only | ranker:gemini-2.5-flash | 0.6036 | 0.6599 | 0.4383 | 0.2050 |
| stream | gpt-4o-mini-2024-07-18 | 0.7324 | 0.7534 | 0.5031 | 0.2117 |
| sync | o4-mini-2025-04-16 | 0.6558 | 0.6953 | 0.4769 | 0.2179 |
| fusion_ranker_only | ranker:claude-haiku-4-5 | 0.6795 | 0.7066 | 0.4824 | 0.2182 |
| sync | gpt-4.1-mini-2025-04-14 | 0.6834 | 0.7161 | 0.4872 | 0.2258 |
| sync | gpt-4o-mini-2024-07-18 | 0.7341 | 0.7513 | 0.5053 | 0.2287 |
| sync | gpt-4o-2024-08-06 | 0.6355 | 0.6946 | 0.4692 | 0.2288 |
| sync | gemini-3.1-flash-lite-preview | 0.6956 | 0.7348 | 0.4811 | 0.2338 |
| fusion_ranker_only | ranker:gpt-4o-mini | 0.6937 | 0.7113 | 0.4831 | 0.2345 |
| sync | gemini-3-flash-preview | 0.6837 | 0.7295 | 0.4873 | 0.2376 |
| stream | gpt-4o | 0.7007 | 0.7402 | 0.5153 | 0.2502 |
| stream | gpt-4o-mini | 0.8566 | 0.8421 | 0.5282 | 0.2653 |
| sync | o3-mini-2025-01-31 | 0.8407 | 0.8379 | 0.5353 | 0.2708 |
