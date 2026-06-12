# MoA Residual Connection Ablation Study

## Experiment Design

| Parameter | Value |
|-----------|-------|
| **Proposer models** | gpt-4o-mini, gemini-2.5-flash, claude-haiku-4-5 |
| **Aggregator model** | gpt-4o |
| **Articles processed** | 2 |
| **Started** | 2026-06-04T09:17:31.727Z |
| **Finished** | 2026-06-04T09:18:02.989Z |
| **BERTScore** | Skipped |

> **Hypothesis**: Injecting the original article (`articleSnippet`) as a residual connection into the MoA aggregator prompt improves content retention (Axis-A) and/or summary quality (Axis-B).

## Aggregate Statistics

### Axis-A: Content Retention (similarity to source article)

Higher is better for all Axis-A metrics.

| Metric | With `articleSnippet` | Without `articleSnippet` | Δ (With − Without) |
|--------|----------------------|--------------------------|---------------------|
| **ROUGE-1** | 0.3700 | 0.3033 | +0.0667 ▲ |
| **ROUGE-2** | 0.3474 | 0.2717 | +0.0758 ▲ |
| **ROUGE-L** | 0.3333 | 0.2397 | +0.0937 ▲ |
| **BERTScore** | — | — | — |

### Axis-B: Summary Quality

Higher BLEU = more fluent. Lower compression rate = more concise.

| Metric | With `articleSnippet` | Without `articleSnippet` | Δ (With − Without) |
|--------|----------------------|--------------------------|---------------------|
| **BLEU-4** | 0.1479 | 0.0671 | +0.0808 ▲ |
| **Compression Rate** | 35.7100 | 29.3250 | +6.3850 |
| **Avg Word Count** | 331 | 280 | +52 |

### Win Rate Summary (With vs. Without `articleSnippet`)

*A win = higher metric value on Axis-A; for Compression Rate: lower = better.*

| Metric | With wins | Without wins | Ties |
|--------|-----------|-------------|------|
| **ROUGE-1** | 2 | 0 | 0 |
| **ROUGE-2** | 2 | 0 | 0 |
| **ROUGE-L** | 2 | 0 | 0 |
| **BERTScore** | 0 | 0 | 0 |
| **BLEU-4** | 2 | 0 | 0 |
| **Compression Rate** | 0 | 2 | 0 |

## Per-Article Side-by-Side Comparison

| # | Axis-A: ROUGE-1 (With / No) | Axis-A: BERTScore (With / No) | Axis-B: BLEU (With / No) | Δ ROUGE-1 | Δ BERTScore |
|---|---|---|---|---|---|
| 1 | 0.2504 / 0.2239 | — / — | 0.0197 / 0.0100 | +0.0265 | — |
| 2 | 0.4897 / 0.3827 | — / — | 0.2760 / 0.1242 | +0.1070 | — |

## Sample Summaries (first 3 successful articles)

### Article 1

**URL:** `https://tienphong.vn/chu-nhat-do-2026-gap-nu-sinh-gan-10-lan-hien-mau-post1823998.tpo`

**With `articleSnippet` (Condition A):**

> Bài viết kể về những sinh viên tham gia ngày hội hiến máu tình nguyện "Chủ Nhật Đỏ", một sự kiện do Báo Tiền Phong phát động nhằm lan tỏa tinh thần sẻ chia và trách nhiệm của tuổi trẻ. Nguyễn Nguyễn Khánh Huyền, sinh viên ngành Quản lý kinh tế tại Trường ĐH Tài chính - Marketing, đã ghi dấu ấn với 6 lần hiến máu. Đối với Huyền, mỗi lần hiến máu không chỉ là hành động cho đi mà còn là cách sống trọ…

**Without `articleSnippet` (Condition B):**

> Bài viết miêu tả sự tham gia nhiệt tình và trách nhiệm của các sinh viên trong ngày hội hiến máu "Chủ Nhật Đỏ", một sự kiện do Báo Tiền Phong và Viện Huyết học - Truyền máu Trung ương tổ chức. Sự kiện này nhằm khuyến khích tinh thần sẻ chia và truyền tải thông điệp hiến máu cứu người.   Nguyễn Khánh Huyền, sinh viên Trường ĐH Tài chính - Marketing, đã tham gia hiến máu 6 lần, đồng thời tích cực hỗ…

| Metric | With | Without | Δ |
|--------|------|---------|---|
| ROUGE-1 | 0.2504 | 0.2239 | +0.0265 |
| ROUGE-L | 0.2021 | 0.1558 | +0.0463 |
| BERTScore | — | — | — |
| BLEU-4 | 0.0197 | 0.0100 | +0.0097 |
| Compression Rate | 24.4900 | 23.2000 | +1.2900 |
| Word Count | 303 | 283 | — |

### Article 2

**URL:** `https://tienphong.vn/ong-tran-sy-thanh-cam-ket-gi-voi-cu-tri-lang-son-post1823987.tpo`

**With `articleSnippet` (Condition A):**

> Ngày 1/3, tại xã Lộc Bình, tỉnh Lạng Sơn, Ủy ban Mặt trận Tổ quốc Việt Nam đã tổ chức hội nghị tiếp xúc cử tri với các ứng cử viên Đại biểu Quốc hội khóa XVI. Trong số các ứng cử viên có ông Trần Sỹ Thanh - Chủ nhiệm Ủy ban Kiểm tra Trung ương, bà Đoàn Thu Hà - Chủ tịch Ủy ban MTTQ Việt Nam tỉnh Lạng Sơn và các lãnh đạo tòa án. Ông Trần Sỹ Thanh cam kết nếu được cử tri bầu làm Đại biểu Quốc hội sẽ…

**Without `articleSnippet` (Condition B):**

> Ngày 1/3, tại xã Lộc Bình, tỉnh Lạng Sơn, Ủy ban Mặt trận Tổ quốc Việt Nam đã tổ chức hội nghị tiếp xúc cử tri với các ứng cử viên Đại biểu Quốc hội khóa XVI. Trong số các ứng cử viên có ông Trần Sỹ Thanh - Chủ nhiệm Ủy ban Kiểm tra Trung ương, bà Đoàn Thu Hà - Chủ tịch Ủy ban MTTQ Việt Nam tỉnh Lạng Sơn và các lãnh đạo tòa án. Tại hội nghị, ông Trần Sỹ Thanh cam kết nếu được bầu làm Đại biểu Quốc…

| Metric | With | Without | Δ |
|--------|------|---------|---|
| ROUGE-1 | 0.4897 | 0.3827 | +0.1070 |
| ROUGE-L | 0.4645 | 0.3235 | +0.1410 |
| BERTScore | — | — | — |
| BLEU-4 | 0.2760 | 0.1242 | +0.1518 |
| Compression Rate | 46.9300 | 35.4500 | +11.4800 |
| Word Count | 359 | 276 | — |

## Preliminary Conclusion

**Axis-A (Content Retention):** 3/4 metrics favour WITH articleSnippet — the residual connection appears to improve source grounding. ✅

*Statistical significance should be computed via paired t-test / sign-test on the full 50-article dataset.*
