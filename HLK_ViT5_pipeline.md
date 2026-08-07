# Pipeline HLK-ViT5

## Mục tiêu

Giữ **ViT5-base** làm mô hình chính, nhưng cải thiện khả năng tóm tắt văn bản dài, bao phủ ý và giảm thông tin bịa trên `8Opt/vietnamese-summarization-dataset-0001`.

## Pipeline

```text
Document + Keywords
        ↓
Chuẩn hóa và tách câu tiếng Việt
        ↓
Tạo các chunk theo câu
- 256 token/chunk
- chồng lấn 1 câu
        ↓
Chấm điểm toàn bộ chunk
- độ phủ từ khóa
- độ nổi bật từ vựng
- vị trí trong văn bản
        ↓
MMR chọn tối đa 4 chunk ít trùng nhau
        ↓
Sắp xếp chunk theo thứ tự gốc
        ↓
Tạo đầu vào tối đa 1.024 token
summarize: keywords: ... document: ...
        ↓
Fine-tune ViT5-base đa nhiệm
- nhiệm vụ chính: sinh tóm tắt
- nhiệm vụ phụ: sinh từ khóa (~20% mẫu)
        ↓
Lưu checkpoint đầy đủ mỗi 100 optimizer step
        ↓
Inference sinh 4 ứng viên bằng beam search
        ↓
Factuality reranking
- bám sát từ nguồn
- độ phủ từ khóa
- nhất quán số liệu
- nhất quán thực thể
- độ dài và mức lặp
        ↓
Tóm tắt cuối
```

## Cấu hình chính

| Tham số | Giá trị |
|---|---:|
| `MAX_INPUT_LENGTH` | 1024 |
| `MAX_TARGET_LENGTH` | 256 |
| `CHUNK_TOKEN_LENGTH` | 256 |
| `CHUNK_OVERLAP_SENTENCES` | 1 |
| `MAX_SELECTED_CHUNKS` | 4 |
| Batch train | 1 |
| Gradient accumulation | 15 |
| Checkpoint | mỗi 100 step |

## So sánh thực nghiệm

1. ViT5-base với 512 token.
2. ViT5-base với đầu vào 1.024 token nhưng chỉ truncation.
3. HLK-ViT5 với chunk selection.
4. HLK-ViT5 + keyword multi-task.
5. HLK-ViT5 + factuality reranking.

Đánh giá bằng ROUGE-1/2/L, BERTScore, độ phủ từ khóa, độ chính xác thực thể/số liệu, tỷ lệ hallucination, thời gian và VRAM.
