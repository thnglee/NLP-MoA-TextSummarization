# BÁO CÁO ĐÁNH GIÁ 3 MÔ HÌNH TÓM TẮT TIẾNG VIỆT

Số mẫu chung/model: **300**
ROUGE và BERTScore: model summary ↔ tóm tắt tham chiếu.
Factual consistency: model summary ↔ văn bản gốc.

## NHÓM 1 — Lexical overlap

| Độ đo | HKL-ViT5 | Nishikyen/vit5-vietnamese-news | thnhan/sft_model |
|---|---:|---:|---:|
| ROUGE-1 | 0.5184 | 0.4707 | 0.4321 |
| ROUGE-2 | 0.2932 | 0.2510 | 0.2227 |
| ROUGE-L | 0.3434 | 0.3148 | 0.2773 |

Các giá trị ROUGE trong bảng là **F1 macro trung bình trên toàn bộ mẫu**; càng cao càng tốt.

## NHÓM 2 — Semantic quality

| Độ đo | HKL-ViT5 | Nishikyen/vit5-vietnamese-news | thnhan/sft_model |
|---|---:|---:|---:|
| BERTScore Precision | 0.8996 | 0.8972 | 0.8960 |
| BERTScore Recall | 0.9020 | 0.8896 | 0.8790 |
| BERTScore F1 | 0.9008 | 0.8934 | 0.8874 |

BERTScore encoder: `xlm-roberta-base`. Càng cao càng tốt.

## NHÓM 3 — Factual consistency

| Độ đo | HKL-ViT5 | Nishikyen/vit5-vietnamese-news | thnhan/sft_model |
|---|---:|---:|---:|
| Entity precision | 0.8181 | 0.7916 | 0.7657 |
| Number consistency | 0.9854 | 0.9646 | 0.9755 |
| Contradiction rate | 0.0211 | 0.0290 | 0.0399 |

Entity precision và Number consistency: càng cao càng tốt. Contradiction rate: càng thấp càng tốt.
NLI model: `MoritzLaurer/mDeBERTa-v3-base-mnli-xnli`.

### Metric bổ sung

| Độ đo | HKL-ViT5 | Nishikyen/vit5-vietnamese-news | thnhan/sft_model |
|---|---:|---:|---:|
| Hallucination rate | 0.3904 | 0.4553 | 0.4845 |
| Mean entailment probability | 0.6063 | 0.5416 | 0.5153 |

## NHÓM 4 — Performance

| Độ đo | HKL-ViT5 | Nishikyen/vit5-vietnamese-news | thnhan/sft_model |
|---|---:|---:|---:|
| Inference time | 8.0535 s | 3.5313 s | 6.1358 s |

Inference time trong bảng = **thời gian trung bình / mẫu**, lấy trực tiếp từ `THỜI GIAN TÓM TẮT` trong file TXT; càng thấp càng tốt.

### Thống kê thời gian bổ sung

| Độ đo | HKL-ViT5 | Nishikyen/vit5-vietnamese-news | thnhan/sft_model |
|---|---:|---:|---:|
| Inference time median | 5.7128 s | 3.5053 s | 5.9035 s |
| Inference time P95 | 18.5620 s | 4.5211 s | 8.1466 s |
| Inference time std | 4.7382 s | 0.5923 s | 1.3003 s |
