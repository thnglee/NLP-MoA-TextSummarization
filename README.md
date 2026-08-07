# Tóm tắt văn bản tiếng Việt — ViT5 vs. Extractive

> **Bài tập lớn học phần Xử lý Ngôn ngữ Tự nhiên**  
> Trường Đại học Công nghệ — Đại học Quốc gia Hà Nội  
> Giáo viên hướng dẫn: TS. Trần Hồng Việt · 2026

Dự án thực nghiệm so sánh hiệu năng giữa mô hình tóm tắt trừu tượng hóa **ViT5** và các thuật toán tóm tắt trích xuất (**TextRank**, **LexRank**) trên bộ dữ liệu **vietnews**. Kết quả được đánh giá qua 7 độ đo: ROUGE-1, ROUGE-2, ROUGE-L, BLEU, BERTScore, Compression Ratio và Processing Time.

---

## Nhóm thực hiện

| STT | Họ và tên        | MSSV     |
| --- | ---------------- | -------- |
| 1   | Phạm Vân Anh     | 22028099 |
| 2   | Bùi Đức Duy      | 22021201 |
| 3   | Lê Văn Thắng     | 20228313 |
| 4   | Nguyễn Tiến Mạnh | 24020220 |

---

## Tổng quan

Bài toán tóm tắt văn bản tiếng Việt có hai hướng tiếp cận chính:

- **Trích xuất (Extractive)** — Chọn các câu quan trọng nhất từ văn bản gốc (TextRank, LexRank). Nhanh, không cần GPU, nhưng kết quả kém tự nhiên.
- **Trừu tượng hóa (Abstractive)** — Sinh văn bản tóm tắt mới dựa trên nội dung (ViT5). Linh hoạt hơn, trôi chảy hơn, nhưng yêu cầu tài nguyên tính toán lớn hơn.

Dự án chạy cả hai hướng trên cùng bộ dữ liệu, sau đó so sánh định lượng để rút ra nhận xét về sự đánh đổi giữa chất lượng, tốc độ và độ bám từ ngữ gốc.

---

## Cấu trúc repository

```
├── main.py                          # Entry point: chạy ViT5 / extractive trên vietnews
│
├── models/
│   ├── install/                     # Script tải mô hình về local
│   │   ├── install_vit5.py          # Tải VietAI/vit5-large-vietnews-summarization
│   │   ├── install_mt5.py           # Tải mT5
│   │   ├── install_t5vi.py          # Tải t5-small-vi-summarization
│   │   └── install_qwen.py          # Tải Qwen2.5-1.5B-Instruct
│   └── use_models/
│       ├── load_models.py           # Nạp model, tokenizer, hàm summarize seq2seq / causal
│       └── summary_vietnews.py      # Chạy ViT5 trên toàn bộ tập test vietnews
│
├── utils/
│   ├── textrank.py                  # Thuật toán TextRank (extractive baseline)
│   └── lexrank.py                   # Thuật toán LexRank (extractive baseline)
│
├── dataset/
│   ├── vietnews/                    # Bộ dữ liệu chính (test.jsonl)
│   ├── ViMs/                        # Bộ dữ liệu phụ
│   └── VietnameseMDS/               # Bộ dữ liệu phụ
│
├── output/
│   └── summary/
│       ├── vit5/                    # Kết quả tóm tắt của ViT5
│       ├── textrank/                # Kết quả tóm tắt của TextRank
│       └── lexrank/                 # Kết quả tóm tắt của LexRank
│
├── bert/                            # BERTScore microservice (FastAPI + PhoBERT)
├── backend/                         # Next.js backend — API + metrics dashboard
├── w-latex-reports/                 # Báo cáo LaTeX bài tập lớn
└── w-slides-presentation/           # Slide thuyết trình
```

---

## Mô hình và thuật toán

### Mô hình (Abstractive)

| Mô hình                                               | Kiến trúc                  | Ghi chú                                                   |
| ----------------------------------------------------- | -------------------------- | --------------------------------------------------------- |
| **ViT5** (`VietAI/vit5-large-vietnews-summarization`) | Encoder-Decoder (T5-based) | Mô hình chính của bài tập lớn; đã fine-tune trên vietnews |
| mT5                                                   | Encoder-Decoder            | Mô hình phụ                                               |
| t5-small-vi                                           | Encoder-Decoder            | Mô hình phụ                                               |
| Qwen2.5-1.5B-Instruct                                 | Decoder-only (Causal LM)   | Mô hình phụ                                               |

> ViT5 dùng tiền tố `"vietnews: <nội dung> </s>"` khi inference, theo đúng cách fine-tune gốc.

### Thuật toán (Extractive)

| Thuật toán   | Mô tả                                                                |
| ------------ | -------------------------------------------------------------------- |
| **TextRank** | Xây đồ thị câu dựa trên độ tương đồng TF-IDF, xếp hạng bằng PageRank |
| **LexRank**  | Tương tự TextRank nhưng dùng độ tương đồng cosine từ TF-IDF matrix   |

---

## Bộ dữ liệu

**Bộ dữ liệu chính**: [vietnews](https://huggingface.co/datasets/vietnews) — tập tin tức báo chí tiếng Việt.

- Định dạng: JSONL (`test.jsonl`), mỗi dòng có trường `article` (văn bản gốc) và `abstract` (tóm tắt tham chiếu).
- Đặt tại: `dataset/vietnews/test.jsonl`

---

## Độ đo đánh giá

| Độ đo                 | Mô tả                                                     |
| --------------------- | --------------------------------------------------------- |
| **ROUGE-1**           | Overlap unigram giữa tóm tắt sinh ra và tham chiếu        |
| **ROUGE-2**           | Overlap bigram                                            |
| **ROUGE-L**           | Chuỗi con chung dài nhất (LCS)                            |
| **BLEU**              | Độ chính xác n-gram có penalty độ dài                     |
| **BERTScore**         | Độ tương đồng ngữ nghĩa dùng PhoBERT (vinai/phobert-base) |
| **Compression Ratio** | `len(tóm tắt) / len(gốc)` — đo mức độ rút gọn             |
| **Processing Time**   | Thời gian sinh mỗi bản tóm tắt (giây/mẫu)                 |

> **Lưu ý phương pháp luận**: ROUGE, BLEU và BERTScore được tính so với bản tóm tắt tham chiếu (`abstract`) trong vietnews. Các độ đo này đo _độ bám từ ngữ_, không trực tiếp đo chất lượng ngữ nghĩa hay mức độ trôi chảy.

---

## Cài đặt và chạy

### Yêu cầu

- Python 3.10+
- GPU (khuyến nghị) hoặc CPU
- ~5 GB disk space cho ViT5-large

### 1. Cài đặt dependencies

```bash
pip install torch transformers datasets rouge-score nltk
```

Hoặc dùng file requirements (nếu có):

```bash
pip install -r requirements.txt
```

### 2. Tải mô hình về local

```bash
# Tải ViT5 (mô hình chính)
python models/install/install_vit5.py

# Tải các mô hình khác (tuỳ chọn)
python models/install/install_mt5.py
python models/install/install_t5vi.py
python models/install/install_qwen.py
```

Mô hình được lưu vào `models/vit5/`, `models/mt5/`, v.v.

### 3. Chuẩn bị dataset

Đặt file `test.jsonl` của vietnews vào:

```
dataset/vietnews/test.jsonl
```

### 4. Chạy ViT5 trên vietnews

```bash
python main.py
```

Hoặc gọi trực tiếp từ code:

```python
from models.use_models.summary_vietnews import run_vit5_on_vietnews_test

run_vit5_on_vietnews_test(
    dataset_path="dataset/vietnews/test.jsonl",
    output_dir="output/summary/vit5/vietnews_test",
    start_index=0,       # Bắt đầu từ mẫu nào
    max_samples=500,     # None = chạy toàn bộ
)
```

Kết quả được lưu vào `output/summary/vit5/vietnews_test/`, mỗi mẫu một file `.txt` gồm: văn bản gốc, tóm tắt tham chiếu, tóm tắt do ViT5 sinh, và thời gian xử lý.

### 5. Chạy extractive baseline

```python
from utils.textrank import run_textrank_on_vietnews
from utils.lexrank import run_lexrank_on_vietnews
from pathlib import Path

# TextRank
run_textrank_on_vietnews(
    dataset_path=Path("dataset/vietnews/test.jsonl"),
    output_dir=Path("output/summary/textrank/vietnews_test"),
)

# LexRank
run_lexrank_on_vietnews(
    dataset_path=Path("dataset/vietnews/test.jsonl"),
    output_dir=Path("output/summary/lexrank/vietnews_test"),
)
```

---

## BERTScore microservice (tuỳ chọn)

Dịch vụ tính BERTScore dùng `vinai/phobert-base`, triển khai bằng FastAPI:

```bash
cd bert
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 7860
# → http://localhost:7860
```

Có thể deploy lên [Hugging Face Spaces](https://huggingface.co/spaces) bằng `Dockerfile` đi kèm.

---

## Backend & Metrics Dashboard (tuỳ chọn)

Thư mục `backend/` chứa một Next.js API server phục vụ dashboard theo dõi kết quả đánh giá:

```bash
cd backend
npm install
# Tạo file .env với SUPABASE_URL, SUPABASE_ANON_KEY, ...
npm run dev
# → http://localhost:3000
```

Dashboard hiển thị các kết quả ROUGE/BLEU/BERTScore theo từng mô hình và lượt chạy, lưu trữ trong Supabase (PostgreSQL).

---

## Tài liệu

| Thư mục                  | Nội dung                                                           |
| ------------------------ | ------------------------------------------------------------------ |
| `w-latex-reports/`       | Báo cáo bài tập lớn (LaTeX) — build bằng `latexmk -pdf thesis.tex` |
| `w-slides-presentation/` | Slide thuyết trình                                                 |

---

## License

MIT
