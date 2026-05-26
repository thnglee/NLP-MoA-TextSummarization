# Hướng dẫn Demo Thesis — The Fiber Project

Folder `demo` này chứa toàn bộ scripts cần thiết để demo hệ thống và kết quả nghiên cứu (được trình bày trong Chapter 4) trong buổi bảo vệ khóa luận.

## Yêu cầu hệ thống (Prerequisites)

1. Backend đang chạy ở terminal khác:
   ```bash
   cd backend
   npm run dev
   ```
2. `.env` file đã được config đúng với `SUPABASE_URL` và `SUPABASE_SERVICE_ROLE_KEY`.
3. Node dependencies đã được cài đặt (`npm install` trong folder `backend`).

---

## Phần 1: Live-Run (Chạy thực tế)
*Chứng minh pipeline thực sự hoạt động và trả về kết quả tốt hơn mô hình đơn lẻ.*

Phần này sẽ chạy 20 bài báo có nội dung dài qua cả 2 chế độ (Fusion và GPT-4o Alone), sau đó chấm điểm bằng LLM-Judge và so sánh.

**Bước 1: Chạy Fusion Batch**
```bash
cd demo
npx tsx live-run/01-run-fusion-batch.ts
```
*Lưu lại chuỗi `Timestamp` được in ra ở đầu script (ví dụ: `2026-05-25T15:25:00.000Z`). Bạn sẽ cần nó cho các bước sau.*

**Bước 2: Chạy GPT-4o Alone Baseline**
```bash
npx tsx live-run/02-run-gpt4o-alone.ts
```

**Bước 3: Chấm điểm Pairwise (so sánh trực tiếp)**
*Thay `TIMESTAMP` bằng timestamp lưu từ Bước 1:*
```bash
npx tsx live-run/03-compare-fused-vs-gpt4o.ts --since "TIMESTAMP"
```

**Bước 4: Xuất báo cáo**
```bash
npx tsx live-run/04-generate-live-report.ts --since "TIMESTAMP"
```
Kết quả sẽ được lưu vào file Markdown trong folder `demo/reports/`.

---

## Phần 2: Reports từ Database (Kết quả Database đầy đủ)
*Truy xuất kết quả nghiên cứu quy mô lớn đã chạy trước đó, map trực tiếp với các bảng trong Chapter 4.*

Các script có thể được chạy độc lập, xuất kết quả ra console dạng bảng và lưu vào `demo/reports/`.

```bash
cd demo

# Trục A: Content Retention (Table 4.1)
npx tsx from-database/01-axis-a-report.ts

# Trục B.1: Rubric Scores (Table 4.2)
npx tsx from-database/02-axis-b-rubric.ts

# Trục B.2a: Fused vs Best Single Draft (Table 4.3)
npx tsx from-database/03-axis-b-fused-vs-best.ts

# Trục B.2b: Fused vs Each Draft (Table 4.4)
npx tsx from-database/04-axis-b-fused-vs-each.ts

# Trục B.2c: Fused vs GPT-4o (Table 4.5)
npx tsx from-database/05-axis-b-fused-vs-gpt4o.ts

# Trục B.3: Factuality (Table 4.6)
npx tsx from-database/06-axis-b-factuality.ts

# Trục C: Human Evaluation (Tables 4.7, 4.8)
npx tsx from-database/07-axis-c-human-eval.ts

# TỔNG HỢP TOÀN BỘ (Table 4.9)
npx tsx from-database/08-full-unified-report.ts
```

### Các bảng kết quả map với Thesis Chapter 4:

- **01-axis-a**: Tương ứng Table 4.1. Đánh giá % nội dung bài báo gốc được giữ lại (thông qua ROUGE/BLEU).
- **02-axis-b-rubric**: Tương ứng Table 4.2. Đánh giá chất lượng độc lập dựa trên Rubric 5 tiêu chí.
- **03 & 04 & 05**: Pairwise comparison. Đây là bằng chứng cốt lõi của Thesis:
  - Table 4.3: So với bản nháp tốt nhất.
  - Table 4.4: So với từng Proposer model.
  - Table 4.5: So với GPT-4o khi chạy đơn độc (chứng minh giá trị của Multi-Agent).
- **06-axis-b-factuality**: Tương ứng Table 4.6. Kiểm tra xem tóm tắt có sinh ra thông tin ảo (hallucinate) hay không.
- **07-axis-c**: Tương ứng Table 4.7, 4.8. Kết quả đánh giá mù (Blind Test) từ con người.
- **08-full-unified**: Tổng hợp tất cả để tạo thành Table 4.9.
