# HƯỚNG DẪN KỸ THUẬT CHUYÊN SÂU & BẢO VỆ KHÓA LUẬN

**Đề tài:** Nghiên cứu, xây dựng hệ thống tóm tắt và kiểm chứng tin tức tiếng Việt sử dụng mô hình ngôn ngữ lớn.  
**Tác giả:** Lê Văn Thắng (MSV: 22028313) | **Giảng viên hướng dẫn:** TS. Vương Thị Hồng

Tài liệu này phân tích cặn kẽ cấu trúc code của hệ thống, luồng nghiệp vụ chi tiết, quy trình thực hiện các script thử nghiệm batch, các công thức toán học và NLP đầy đủ, cùng kịch bản trả lời chất vấn trước Hội đồng bảo vệ khóa luận.

---

## MỤC LỤC

1. [Bản Đồ Codebase & Vai Trò Các File Core](#1-bản-đồ-codebase--vai-trò-các-file-core)
2. [Quy Trình Nghiệp Vụ Step-by-Step (Execution Flows)](#2-quy-trình-nghiệp-vụ-step-by-step-execution-flows)
3. [Quy Trình Đánh Giá Hệ Thống & Các Scripts Thực Nghiệm](#3-quy-trình-đánh-giá-hệ-thống--các-scripts-thực-nghiệm)
4. [Hệ Thống Công Thức Toán Học & NLP Đầy Đủ](#4-hệ-thống-công-thức-toán-học--nlp-đầy-đủ)
5. [Phân Tích Kết Quả Thực Nghiệm Cụ Thể (Data Interpretation)](#5-phân-tích-kết-quả-thực-nghiệm-cụ-thể-data-interpretation)
6. [Kịch Bản Bảo Vệ Khóa Luận & Trả Lời Chất Vấn Chi Tiết](#6-kịch-bản-bảo-vệ-khóa-luận--trả-lời-chất-vấn-chi-tiết)

---

## 1. BẢN ĐỒ CODEBASE & VAI TRÒ CÁC FILE CORE

Hệ thống được cấu trúc rõ ràng thành 3 thành phần chính: **Browser Extension**, **Backend API**, và **BERTScore Service**.

### 1.1 Thư mục Backend (`backend/`)

Chứa toàn bộ logic xử lý API, định tuyến, thực hiện Mixture-of-Agents (MoA) và quản trị đánh giá.

- **[app/api/summarize/route.ts](file:///Users/thanglee/something%20beautiful/UniThesis/backend/app/api/summarize/route.ts)**:
  - _Vai trò:_ Endpoint xử lý chính (`POST /api/summarize`). Nhận các tham số đầu vào như `content`, `url`, `routing_mode`, `fusion_config`, `judge_config`.
  - _Nhiệm vụ:_ Giải mã yêu cầu, gọi dịch vụ định tuyến để chọn model, điều phối luồng xử lý đồng bộ/streaming, kích hoạt các tác vụ ghi log và tính toán metric nền (qua `waitUntil` của Vercel).
- **[services/summarize.service.ts](file:///Users/thanglee/something%20beautiful/UniThesis/backend/services/summarize.service.ts)**:
  - _Vai trò:_ Trái tim điều phối luồng tóm tắt.
  - _Nhiệm vụ:_ Định nghĩa hai hàm chính: `performSummarize` (xử lý đồng bộ, tạo callback nền chạy song song các phép đo chất lượng) và `performSummarizeStream` (sinh dữ liệu dạng Server-Sent Events qua generator).
- **[services/routing.service.ts](file:///Users/thanglee/something%20beautiful/UniThesis/backend/services/routing.service.ts)**:
  - _Vai trò:_ Phân loại độ phức tạp bài báo và định tuyến mô hình.
  - _Nhiệm vụ:_ Phân tích độ dài text tiếng Việt, ánh xạ sang 3 phân khúc (Ngắn $\le 400$t, Trung bình $\le 1500$t, Dài $> 1500$t) để chọn model ưu tiên và kiểm soát fallback chain khi có lỗi API.
- **[services/fusion.service.ts](file:///Users/thanglee/something%20beautiful/UniThesis/backend/services/fusion.service.ts)**:
  - _Vai trò:_ Quản lý chế độ định tuyến `evaluation` (không phải MoA).
  - _Nhiệm vụ:_ Cho chạy tất cả model cấu hình trong nhóm song song, gửi kết quả sang dịch vụ BERTScore, sau đó chọn ra bản tóm tắt có điểm ngữ nghĩa BERTScore F1 cao nhất trả về cho user.
- **[output-fusion/moa.service.ts](file:///Users/thanglee/something%20beautiful/UniThesis/backend/output-fusion/moa.service.ts)**:
  - _Vai trò:_ Hiện thực hóa kiến trúc Mixture-of-Agents (MoA).
  - _Nhiệm vụ:_ Chạy parallel các model Layer 1 (Proposers), sinh prompt kết nối thặng dư (residual connection), gọi Aggregator sinh kết quả cuối cùng qua JSON Schema, chọn draft tốt nhất qua LLM-Judge và so sánh pairwise.
- **[output-fusion/moa.config.ts](file:///Users/thanglee/something%20beautiful/UniThesis/backend/output-fusion/moa.config.ts)**:
  - _Vai trò:_ Quản lý cấu hình, kiểm tra API key của các LLM providers.
  - _Nhiệm vụ:_ Lọc và trả về danh sách các model sẵn có, xác định model nào đủ tiêu chuẩn làm proposer (mức giá rẻ) và model nào đủ điều kiện làm aggregator (hỗ trợ Structured Output).
- **[output-fusion/moa.prompt.ts](file:///Users/thanglee/something%20beautiful/UniThesis/backend/output-fusion/moa.prompt.ts)**:
  - _Vai trò:_ Kỹ nghệ prompt (Prompt Engineering) cho Aggregator.
  - _Nhiệm vụ:_ Chuyển đổi prompt Table 1 của bài báo MoA gốc sang văn phong báo chí tiếng Việt trung lập và chèn văn bản gốc (Residual Connection).
- **[output-fusion/moa.evaluation.ts](file:///Users/thanglee/something%20beautiful/UniThesis/backend/output-fusion/moa.evaluation.ts)**:
  - _Vai trò:_ Triển khai đánh giá tự động tích hợp trong MoA.
  - _Nhiệm vụ:_ Chạy chấm điểm BERTScore/ROUGE/BLEU cho từng draft; chạy N-way ranker để LLM tự bầu chọn draft tốt nhất; chạy chấm điểm so sánh cặp (pairwise) giữa Fused Summary vs Best Draft.
- **[output-fusion/moa.persistence.ts](file:///Users/thanglee/something%20beautiful/UniThesis/backend/output-fusion/moa.persistence.ts)**:
  - _Vai trò:_ Giao tiếp database Supabase cho MoA.
  - _Nhiệm vụ:_ Lưu kết quả tổng hợp vào bảng `moa_fusion_results`, chi tiết các bản nháp vào `moa_draft_results` và kết quả judge vào `llm_judge_pairwise`.
- **[services/bert.service.ts](file:///Users/thanglee/something%20beautiful/UniThesis/backend/services/bert.service.ts)**:
  - _Vai trò:_ Giao tiếp dịch vụ semantic metric.
  - _Nhiệm vụ:_ Gọi hàm warmup wake-up endpoint `/healthz` tránh cold-start trên HF Spaces, sau đó gửi payload chứa Candidate + Reference để lấy điểm BERTScore F1.
- **[services/factuality.service.ts](file:///Users/thanglee/something%20beautiful/UniThesis/backend/services/factuality.service.ts)**:
  - _Vai trò:_ Đánh giá chất lượng thực tế thông tin.
  - _Nhiệm vụ:_ Chạy 2 bước LLM: tách câu tóm tắt thành các mệnh đề nguyên tử và đối chiếu bài gốc để ra nhãn `entailed`/`contradicted`/`not_mentioned`.
- **[utils/rouge-custom.ts](file:///Users/thanglee/something%20beautiful/UniThesis/backend/utils/rouge-custom.ts)**:
  - _Vai trò:_ Thư viện tính toán ROUGE tùy biến.
  - _Nhiệm vụ:_ Token hóa văn bản bằng thư viện `natural` và tính toán ROUGE-1, ROUGE-2, ROUGE-L dạng Recall-based.

### 1.2 Thư mục Tiện ích Trình duyệt (`extension/`)

Xây dựng giao diện hiển thị và tương tác trực tiếp của người dùng.

- **[contents/summary-sidebar.tsx](file:///Users/thanglee/something%20beautiful/UniThesis/extension/contents/summary-sidebar.tsx)**: Content script tạo sidebar trượt. Tự động nhận diện bài báo, gửi request streaming SSE đến Backend và vẽ biểu đồ metrics trực quan cho người dùng.
- **[lib/api-client.ts](file:///Users/thanglee/something%20beautiful/UniThesis/extension/lib/api-client.ts)**: SDK phía client để wrap các cuộc gọi API `/summarize` và `/fact-check`, hỗ trợ xử lý luồng streaming qua `ReadableStream` bất đồng bộ.

### 1.3 Thư mục Dịch vụ BERT (`bert/`)

- **[bert/main.py](file:///Users/thanglee/something%20beautiful/UniThesis/bert/main.py)**: Web service viết bằng FastAPI tải mô hình PhoBERT-base lên bộ nhớ CPU. Thực hiện token hóa tối đa 256 tokens và trả về điểm BERTScore F1 ngữ nghĩa cho văn bản tiếng Việt.

---

## 2. QUY TRÌNH NGHIỆP VỤ STEP-BY-STEP (EXECUTION FLOWS)

Dưới đây là chi tiết kỹ thuật từng bước chạy trong 4 chế độ tóm tắt cốt lõi của hệ thống.

### 2.1 Chế độ MoA Fusion Mode (Quy trình chính)

Khi client gửi yêu cầu có `routing_mode = 'fusion'`:

```
[Client] --> Gửi Request (URL/Content)
  |
  v
[App Route] --> Gọi extractContentFromUrl() (nếu chỉ truyền URL)
  |
  v
[moa.config.ts] --> Gọi buildMoAConfig()
  |                  - Chọn Proposers (gpt-4o-mini, haiku, gemini-flash)
  |                  - Chọn Aggregator (gpt-4o)
  v
[moa.service.ts] --> Chạy runMoAFusion()
  |
  +---> [Bước 1: Layer 1 Proposers]
  |       - Promise.all() chạy song song các proposers với cơ chế timeout 15s.
  |       - Trả về danh sách Drafts (thành công / thất bại).
  |
  +---> [Bước 2: Layer 2 Aggregator]
  |       - Gọi buildAggregatorPrompt(): Chèn bài gốc + chèn các drafts.
  |       - Gọi generateJsonCompletion(): gpt-4o sinh JSON cấu trúc chứa: summary, category, readingTime.
  |
  +---> [Bước 3: Tích hợp Đánh giá tự động]
  |       - Đo ROUGE/BLEU/BERTScore cho bản Fused và từng bản Drafts.
  |       - Bầu chọn Best Draft qua N-way Ranker LLM Judge.
  |       - So sánh Fused vs Best Draft qua Pairwise Judge (B.2).
  |       - So sánh Fused vs Mọi Draft cá thể nếu có flag `judge_vs_all_drafts` (B.2b).
  |
  v
[App Route] --> Phản hồi thông tin JSON về cho Client
  |
  v (Khởi động luồng chạy nền waitUntil)
[moa.persistence.ts] --> Gọi saveMoAFusionResult() & saveLLMJudgePairwise()
  |
[evaluation.service.ts] --> Gọi runJudgeForSummary() (Lấy điểm Rubric B.1 của bản Fused)
  |                         và saveEvaluationMetrics() lưu vào DB.
```

### 2.2 Chế độ Tự Động (Auto Mode)

Khi yêu cầu sử dụng `routing_mode = 'auto'`:

1.  **Phân tích bài viết:** Hàm `classifyComplexity(articleText)` được gọi để đếm số ký tự và chia cho 4 để ước lượng số lượng tokens.
2.  **Định tuyến mô hình:**
    - Nếu Tokens $\le 400$: Chọn model `ViT5-large`.
    - Nếu $400 < \text{Tokens} \le 1500$: Chọn model `gpt-4o-mini`.
    - Nếu Tokens $> 1500$: Chọn model `gpt-4o`.
3.  **Xử lý lỗi và Fallback:**
    - Hệ thống gọi `performSummarize` với model đã chọn.
    - Nếu xảy ra lỗi mạng hoặc lỗi quá hạn ngạch (quota), hệ thống sẽ bắt lỗi bằng khối `catch`, gọi hàm `getFallbackModel(currentModelName)` để lấy tên model tiếp theo trong chuỗi định tuyến (ví dụ: `ViT5` $\rightarrow$ `gpt-4o-mini` $\rightarrow$ `gpt-4o`).
    - Lặp lại cuộc gọi cho đến khi thành công hoặc hết chuỗi fallback.
4.  **Lưu quyết định:** Ghi nhận thông tin định tuyến (model gốc, model thực tế sử dụng, lý do dùng fallback) vào bảng `routing_decisions`.

### 2.3 Chế độ Đánh Giá Song Song (Evaluation Mode)

Khi yêu cầu sử dụng `routing_mode = 'evaluation'`:

1.  **Gọi song song:** Gọi đồng thời tất cả các model được cấu hình trong `routing_config` ở bảng `app_settings` (mặc định là cặp `ViT5` + `gpt-4o-mini` + `gpt-4o`).
2.  **Đo điểm ngữ nghĩa:** Gửi tất cả các bản tóm tắt thu được cùng bài báo gốc sang dịch vụ BERTScore.
3.  **Chọn lọc:** So sánh các điểm số thu được. Bản tóm tắt có điểm BERTScore F1 cao nhất sẽ được chọn làm **Winner**.
4.  **Trả kết quả:** Lưu thông tin so sánh đối chiếu của các ứng viên vào bảng `model_comparison_results` và trả bản tóm tắt Winner về cho người dùng.

---

## 3. QUY TRÌNH ĐÁNH GIÁ HỆ THỐNG & CÁC SCRIPTS THỰC NGHIỆM

Đây là quy trình sinh dữ liệu kiểm định thực nghiệm và xuất báo cáo kết quả của khóa luận.

### 3.1 Quy trình thực nghiệm 3 giai đoạn (Pipeline)

```
[BƯỚC 1: Tạo Baseline]             [BƯỚC 2: Chạy Batch MoA]            [BƯỚC 3: Sinh Kết Quả Đối Chiếu]
run-single-baseline.ts     -->     collect-metrics.ts         -->      compare-fused-vs-single.ts
(Tạo tóm tắt gpt-4o đơn lẻ)          (Chạy MoA & đo metrics)             (Pairwise judge Fused vs Single)
                                                                                  |
                                                                                  v
                                                                        [BƯỚC 4: Xuất Báo Cáo]
                                                                        unified-report.ts
                                                                        (Đọc DB -> Tính Toán -> Xuất MD)
```

### 3.2 Script 1: Sinh dữ liệu mẫu cơ sở (`run-single-baseline.ts`)

- _Đường dẫn file:_ **[run-single-baseline.ts](file:///Users/thanglee/something%20beautiful/UniThesis/backend/output-fusion/scripts/run-single-baseline.ts)**
- _Mục đích:_ Tạo ra tập dữ liệu tóm tắt từ mô hình đơn lẻ (gpt-4o) làm baseline đối chiếu cho thực nghiệm P0-8.
- _Cách thức hoạt động:_
  1.  Đọc danh sách các URLs từ file JSON đầu vào (ví dụ: `sample-urls-dataset-50.json`).
  2.  Với mỗi URL, gửi request đến Backend API `/api/summarize` với các tham số: `routing_mode = 'forced'`, `model = 'gpt-4o-2024-08-06'` (hoặc model tùy chọn khác).
  3.  Tóm tắt của mô hình đơn sẽ tự động được lưu vào bảng `evaluation_metrics` với trường `mode = 'sync'` để phân biệt.

### 3.3 Script 2: Chạy kiểm nghiệm Batch MoA (`collect-metrics.ts`)

- _Đường dẫn file:_ **[collect-metrics.ts](file:///Users/thanglee/something%20beautiful/UniThesis/backend/output-fusion/scripts/collect-metrics.ts)**
- _Mục đích:_ Chạy toàn bộ pipeline MoA cho tập mẫu, thực hiện so sánh cặp tự động.
- _Tham số CLI quan trọng:_
  - `--input`: Đường dẫn file JSON chứa mảng URLs.
  - `--judge-mode both`: Vừa tính metrics từ vựng/ngữ nghĩa vừa gọi LLM-Judge chấm điểm.
  - `--judge-style rubric`: Chấm điểm theo rubric 5 tiêu chí của FLASK.
  - `--judge-model gpt-4o-mini`: Chỉ định mô hình đóng vai trò làm trọng tài chấm điểm.
  - `--judge-vs-all`: So sánh pairwise Fused Summary với từng Proposer Draft riêng biệt.
- _Luồng logic trong code:_
  1.  Tải danh sách URL và gửi request `routing_mode = 'fusion'` đến API.
  2.  Nhận payload chứa Fused Summary, danh sách các Drafts của Proposers và các chỉ số đo đạc đi kèm.
  3.  Thực hiện gọi API chấm điểm cặp (Fused vs Best Draft) và lưu kết quả.
  4.  Gọi hàm `computeStatistics()` tính toán trung bình, độ lệch chuẩn và giá trị p-value (Sign Test) cho các metrics từ vựng/ngữ nghĩa.
  5.  Xuất một file JSON lưu trữ chi tiết và một file Markdown tóm tắt nhanh kết quả thực nghiệm của lượt chạy đó.

### 3.4 Script 3: So sánh Fused vs Single Aggregator (`compare-fused-vs-single.ts`)

- _Đường dẫn file:_ **[compare-fused-vs-single.ts](file:///Users/thanglee/something%20beautiful/UniThesis/backend/output-fusion/scripts/compare-fused-vs-single.ts)**
- _Mục đích:_ Triển khai thực nghiệm cốt lõi P0-8, loại bỏ yếu tố khác biệt mô hình để chứng minh giá trị của thuật toán MoA.
- _Luồng logic trong code:_
  1.  Query cơ sở dữ liệu để lấy toàn bộ các bản ghi trong bảng `moa_fusion_results` (đại diện cho kết quả của Fused).
  2.  Query bảng `evaluation_metrics` để lấy các bản ghi có `mode = 'sync'` và `model = 'gpt-4o-2024-08-06'` (đại diện cho kết quả của Single Aggregator).
  3.  Ghép cặp các bản ghi này dựa trên trường `url` chung.
  4.  Với mỗi cặp bài viết khớp nhau, script gọi hàm `judgePairwise` gửi nội dung của bản tóm tắt Fused và bản tóm tắt Single lên mô hình trọng tài (`gpt-4o-mini` hoặc `gpt-4o`).
  5.  Kết quả phân định thắng/thua/hòa của trọng tài được lưu trực tiếp vào bảng `llm_judge_pairwise` với trường phân loại `comparison_type = 'vs_single_aggregator'`.

### 3.5 Dựng báo cáo tổng hợp ba trục (`unified-report.ts`)

- _Đường dẫn file:_ **[unified-report.ts](file:///Users/thanglee/something%20beautiful/UniThesis/backend/output-fusion/scripts/unified-report.ts)**
- _Mục đích:_ Quét toàn bộ CSDL Supabase để tổng hợp dữ liệu thực nghiệm thành một báo cáo Markdown hoàn chỉnh phục vụ viết chương 4 của khóa luận.
- _Cách thức xử lý dữ liệu:_
  1.  **Axis A (Độ giữ lại nội dung):** Đọc bảng `evaluation_metrics`, gom nhóm theo cặp `(mode, model)`. Tính điểm trung bình của ROUGE-1/2/L, BLEU-4, BERTScore và Compression Rate.
  2.  **Axis B.1 (LLM-Judge Rubric):** Tính điểm trung bình cộng các tiêu chí Faithfulness, Coverage, Fluency, Conciseness, Overall của các nhóm summaries.
  3.  **Axis B.2 (LLM-Judge Pairwise - Fused vs Best Draft):** Tổng hợp số trận thắng/thua/hòa từ bảng `llm_judge_pairwise` có `comparison_type = 'vs_best_draft'`.
  4.  **Axis B.2b (Fused vs Proposers):** Tính win rate chi tiết của Fused khi đấu với `gpt-4o-mini`, `claude-haiku-4-5`, `gemini-2.5-flash` dựa trên `comparison_type = 'vs_individual_draft'`.
  5.  **Axis B.2c (Fused vs Single Aggregator - P0-8):** Đếm kết quả của các bản ghi có `comparison_type = 'vs_single_aggregator'`.
  6.  **Axis B.3 (Factuality):** Tính tỷ lệ trung bình của các trường `factuality_entailed_ratio`, đếm trung bình số lần phát hiện lỗi sai (`factuality_hallucinations`).
  7.  **Axis C (Human Validation):** Đọc các bảng xếp hạng từ con người, chạy hàm `fleissKappaFromRankings` tính chỉ số $\kappa$ và xếp hạng trung bình cho các mô hình.
  8.  **Đầu ra:** Ghi đè vào file Markdown `unified-report.md`.

---

## 4. CÁC CÔNG THỨC TOÁN HỌC & NLP ĐẦY ĐỦ

Hội đồng bảo vệ khóa luận rất chú trọng đến tính chính xác toán học. Dưới đây là các công thức chi tiết:

### 4.1 ROUGE-N Recall (Từ vựng)

Tính toán dựa trên số lượng n-gram trùng khớp giữa bản tóm tắt ứng viên ($C$) và bài viết gốc ($R$):
$$\text{ROUGE-N} = \frac{\sum_{s \in R} \sum_{\text{gram}_n \in s} \text{Count}_{\text{match}}(\text{gram}_n)}{\sum_{s \in R} \sum_{\text{gram}_n \in s} \text{Count}(\text{gram}_n)}$$

- Với $N=1$, n-gram là từ đơn (Unigrams).
- Với $N=2$, n-gram là cặp từ liền kề (Bigrams).
- $\text{Count}_{\text{match}}(\text{gram}_n)$ là số lượng n-gram tối đa xuất hiện đồng thời trong cả bản tóm tắt và văn bản gốc để tránh tính lặp từ.

### 4.2 ROUGE-L Recall (Longest Common Subsequence)

Sử dụng độ dài chuỗi con chung dài nhất (không nhất thiết phải liên tiếp) giữa Candidate ($C$ có độ dài $m$) và Reference ($R$ có độ dài $n$):
$$\text{ROUGE-L} = \frac{\text{LCS}(C, R)}{n}$$

### 4.3 BLEU-4 (Brevity Penalty + Precision)

$$\text{BLEU-4} = \text{BP} \times \exp \left( \sum_{n=1}^{4} w_n \ln p_n \right)$$

- $p_n$ là độ chính xác n-gram (n-gram Precision):
  $$p_n = \frac{\sum_{C} \sum_{\text{gram}_n \in C} \text{Count}_{\text{match}}(\text{gram}_n)}{\sum_{C} \sum_{\text{gram}_n \in C} \text{Count}(\text{gram}_n)}$$
- $w_n = 0.25$ là trọng số đồng đều cho các n-gram từ 1 đến 4.
- $\text{BP}$ (Brevity Penalty) là hình phạt cho văn bản quá ngắn:
  $$
  \text{BP} = \begin{cases}
    1 & \text{nếu } c > r \\
    e^{(1 - r/c)} & \text{nếu } c \le r
  \end{cases}
  $$
  Trong đó: $c$ là độ dài bản tóm tắt Candidate, $r$ là độ dài bài gốc Reference.

### 4.4 BERTScore Ngữ nghĩa (Cosine Similarity với PhoBERT)

Gọi $x$ là các token đại diện cho Candidate, $y$ là các token đại diện cho Reference. Sử dụng PhoBERT để lấy các contextual vectors $\mathbf{x}_j$ và $\mathbf{y}_i$.

- **Recall (Độ phủ ngữ nghĩa):**
  $$R_{\text{BERT}} = \frac{1}{|y|} \sum_{y_i \in y} \max_{x_j \in x} \cos(\mathbf{y}_i, \mathbf{x}_j)$$
- **Precision (Độ chính xác ngữ nghĩa):**
  $$P_{\text{BERT}} = \frac{1}{|x|} \sum_{x_j \in x} \max_{y_i \in y} \cos(\mathbf{y}_i, \mathbf{x}_j)$$
- **BERTScore F1 (Chỉ số tổng hợp):**
  $$F_{\text{BERT}} = 2 \times \frac{P_{\text{BERT}} \times R_{\text{BERT}}}{P_{\text{BERT}} + R_{\text{BERT}}}$$
  Trong đó: $\cos(\mathbf{a}, \mathbf{b}) = \frac{\mathbf{a} \cdot \mathbf{b}^\top}{\|\mathbf{a}\| \|\mathbf{b}\|}$.

### 4.5 Kiểm định Nhị thức Sign Test (Hai đuôi)

Tính toán xác suất quan sát thấy sự chênh lệch thắng/thua lớn hơn hoặc bằng thực tế dưới giả thuyết ngẫu nhiên $\text{H}_0$:
$$\text{p-value} = 2 \times \sum_{i=0}^{k} \binom{n}{i} (0.5)^n$$

- $n$ là số lượng mẫu có kết quả phân định rõ ràng (loại trừ các mẫu hòa - ties).
- $k = \min(\text{wins}, \text{losses})$ là số lượng chiến thắng của bên yếu hơn.
- Hệ số nhị thức $\binom{n}{i}$ được tính qua log-factorial để duy trì độ chính xác số học:
  $$\binom{n}{i} = \exp\Big( \ln(n!) - \ln(i!) - \ln((n-i)!) \Big)$$
  Với $\ln(n!) = \sum_{j=1}^{n} \ln(j)$.

### 4.6 Hệ số đồng thuận Fleiss' Kappa ($\kappa$)

$$\kappa = \frac{\bar{P} - \bar{P}_e}{1 - \bar{P}_e}$$

- **Đồng thuận quan sát được ($\bar{P}$):**
  $$P_i = \frac{1}{n(n-1)} \left( \sum_{j=1}^{M} n_{ij}^2 - n \right), \quad \bar{P} = \frac{1}{N} \sum_{i=1}^{N} P_i$$
  - $N$ là số lượng thực thể tóm tắt được đánh giá.
  - $M$ là số lượng thang xếp hạng (hạng 1, hạng 2, hạng 3).
  - $n$ là số lượng raters đánh giá mỗi thực thể.
  - $n_{ij}$ là số lượng rater đã xếp thực thể $i$ vào hạng $j$.
- **Đồng thuận ngẫu nhiên kỳ vọng ($\bar{P}_e$):**
  $$p_j = \frac{1}{Nn} \sum_{i=1}^{N} n_{ij}, \quad \bar{P}_e = \sum_{j=1}^{M} p_j^2$$

### 4.7 Điều tiết độ dài (Length-Bucketed Win Rate)

Gọi $V$ là tập hợp các cặp đánh giá hợp lệ. Với mỗi cặp $v \in V$, tính tỷ lệ độ dài $r_v = \frac{\text{lenA}_v}{\text{lenB}_v}$.
Phân bổ các mẫu vào 3 buckets:
$$B_1 = \{v \in V \mid r_v < 0.85\}, \quad B_2 = \{v \in V \mid 0.85 \le r_v \le 1.15\}, \quad B_3 = \{v \in V \mid r_v > 1.15\}$$
Với mỗi bucket $B_d$ có số lượng mẫu quyết định $N_d \ge 5$, tính tỷ lệ thắng thô:
$$W_d = \frac{\text{Số trận A thắng trong } B_d}{N_d}$$
Điểm số điều hòa độ dài cuối cùng là trung bình cộng không trọng số của các buckets đủ điều kiện:
$$\text{Win Rate}_{\text{bucketed}} = \frac{1}{|D_{\text{valid}}|} \sum_{d \in D_{\text{valid}}} W_d$$

- Trong đó: $D_{\text{valid}}$ là tập hợp các chỉ mục bucket có $N_d \ge 5$. Nếu không có bucket nào đạt chuẩn, hệ thống tự động fallback sử dụng Win Rate thô (raw rate).

---

## 5. PHÂN TÍCH KẾT QUẢ THỰC NGHIỆM CỤ THỂ (DATA INTERPRETATION)

Dưới đây là phần giải thích sâu sắc về các con số thực nghiệm thu được để trả lời các câu hỏi về mặt học thuật của khóa luận.

### 5.1 Giải mã "Nghịch lý ROUGE" trên Axis A

- **Số liệu thực tế:**
  - Điểm ROUGE-1 của Fused MoA ($0.3273$) thấp hơn mô hình đơn lẻ `gpt-4o` ($0.3453$).
  - Điểm BERTScore F1 của Fused MoA ($0.6387$) lại cao hơn `gpt-4o` ($0.6255$).
- **Nguyên nhân gốc rễ:**
  - Tỷ lệ nén (Compression Rate) của Fused rất cao: **$34.91\%$** (bản tóm tắt cực kỳ ngắn gọn và cô đọng), trong khi `gpt-4o` đơn lẻ có tỷ lệ nén lên tới **$48.41\%$** (bản tóm tắt dài hơn, giữ nhiều câu gốc rườm rà).
  - Do các hệ thống tính ROUGE bằng cách so sánh trực tiếp với văn bản gốc của bài báo (không có bản tóm tắt mẫu từ con người làm mốc), mô hình nào viết dài hơn hoặc sao chép nguyên văn các cụm từ trong bài viết sẽ tự động đạt điểm ROUGE từ vựng cao hơn.
  - Tuy nhiên, Fused MoA đã thực hiện tổng hợp ngữ nghĩa ở mức cao (abstractive synthesis), viết lại ý chính bằng từ vựng ngắn gọn hơn. Điểm BERTScore ngữ nghĩa cao hơn đã xác nhận điều này.
  - _Kết luận bảo vệ:_ **ROUGE-1 thô phạt các mô hình có khả năng tóm tắt và nén tốt**. Do đó, cần sử dụng BERTScore làm hệ quy chiếu ngữ nghĩa chính cho Axis A.

### 5.2 Phân tích ý nghĩa thống kê của P0-8 (Fused vs GPT-4o-alone)

- **Số liệu:** Fused MoA thắng 37/48 bài báo, đạt tỷ lệ thắng **$77.1\%$** với mức ý nghĩa $p = 0.0002$.
- _Lập luận khoa học:_ Vì cả hai phương pháp đều dùng chung Aggregator là `gpt-4o`, sự vượt trội này hoàn toàn thuộc về kiến trúc Mixture-of-Agents. Việc cung cấp các bản nháp đa dạng từ các proposers ở Layer 1 đã cung cấp một tập hợp các thông tin cô đọng chất lượng cao, giúp Aggregator ở Layer 2 dễ dàng chọn lọc và sắp xếp cấu trúc thông tin tối ưu hơn việc tự đọc toàn bộ văn bản nguồn từ đầu.

### 5.3 Lý giải điểm Factuality vượt trội của Fused

- **Số liệu:** Tỷ lệ chính xác sự kiện (Entailment Ratio) của `gpt-4o-alone` chỉ đạt **$90.6\%$** (thấp nhất), trong khi Fused MoA đạt tới **$92.3\%$**.
- _Lập luận khoa học:_ Các mô hình nhỏ ở Layer 1 (như Claude Haiku hay Gemini Flash) có tính sáng tạo thấp hơn nên chúng bám sát văn bản gốc rất tốt khi tóm tắt (thể hiện qua điểm Entailment cao: Haiku đạt $96.7\%$). Aggregator `gpt-4o` mặc dù lập luận rất mạnh nhưng khi chạy đơn lẻ dễ bị xu hướng "sáng tạo quá mức" (hallucinatory drift). Khi chạy MoA, các drafts bám sát sự kiện của Proposers kết hợp với Residual Connection đã tạo nên một bộ khung giới hạn vững chắc, giữ cho Aggregator không sinh ra các suy luận ngoài văn bản gốc.

---

## 6. KỊCH BẢN BẢO VỆ KHÓA LUẬN & TRẢ LỜI CHẤT VẤN CHI TIẾT

Hội đồng bảo vệ thường xoáy sâu vào các điểm yếu thiết kế hoặc các thông số bất thường. Dưới đây là kịch bản trả lời tối ưu:

#### Q1: Tại sao em tự viết code tính ROUGE trong `rouge-custom.ts` thay vì dùng các thư viện Python chuẩn như `rouge-score`?

> **Trả lời:** Các thư viện Python chuẩn như `rouge-score` được thiết kế tối ưu cho tiếng Anh với cơ chế tách từ (tokenization) dựa trên khoảng trắng. Tiếng Việt là ngôn ngữ đa âm tiết, từ ghép gồm nhiều âm tiết phân tách bằng khoảng trắng (ví dụ: "sinh viên" là một từ nhưng có hai âm tiết).
>
> Nếu sử dụng thư viện tiếng Anh trực tiếp, ROUGE sẽ đếm "sinh" và "viên" là hai unigrams độc lập, làm sai lệch bản chất ngữ pháp. Để kiểm soát chặt chẽ việc này, em đã tự viết module **[rouge-custom.ts](file:///Users/thanglee/something%20beautiful/UniThesis/backend/utils/rouge-custom.ts)**, tích hợp bộ Tokenizer của thư viện `natural` để làm sạch văn bản, chuyển chữ thường và bóc tách các token unigram/bigram một cách nhất quán trước khi thực hiện so khớp. Điều này đảm bảo tính khách quan của thực nghiệm trên văn bản tiếng Việt.

#### Q2: Em nói MoA tốt hơn, nhưng tại sao thời gian phản hồi (Latency) của MoA lại lớn hơn rất nhiều so với mô hình đơn lẻ? Hệ thống có thực tế không?

> **Trả lời:** Latency của MoA lớn hơn là một trade-off vật lý hiển nhiên của kiến trúc đa tầng. Trong khi mô hình đơn lẻ chỉ thực hiện 1 cuộc gọi API, MoA phải thực hiện 2 tầng tuần tự: Tầng 1 gọi song song 3 proposers (mất thời gian bằng mô hình chậm nhất, thường $\approx 2$-$4$ giây), sau đó Tầng 2 gọi Aggregator tổng hợp (mất thêm $\approx 2$-$3$ giây). Tổng latency của MoA dao động khoảng $5$-$7$ giây.
>
> Để hệ thống mang tính thực tế cao, em đề xuất mô hình vận hành lai (Hybrid Deployment):
>
> 1. Trải nghiệm người dùng mặc định trên extension sẽ sử dụng chế độ **Auto Mode** (định tuyến mô hình đơn lẻ, có streaming SSE) để đảm bảo thời gian phản hồi cực nhanh, dưới 1 giây.
> 2. Chế độ **MoA Fusion** sẽ được thiết kế dạng nút bấm nâng cao (ví dụ: "Tóm tắt chuyên gia" hoặc "Tóm tắt chuyên sâu") khi người dùng sẵn sàng đánh đổi vài giây chờ đợi để lấy bản tóm tắt có chất lượng phủ thông tin tốt nhất.

#### Q3: Chỉ số Fleiss' Kappa của em rất thấp ($\kappa = 0.113$). Phải chăng mô hình của em không thực sự thuyết phục được người dùng?

> **Trả lời:** Chỉ số Fleiss' Kappa $\kappa = 0.113$ thuộc nhóm "Slight Agreement" (đồng thuận nhẹ). Điều này không phản ánh chất lượng tóm tắt kém, mà phản ánh **sự khác biệt rất lớn trong thị hiếu thẩm mỹ văn bản của con người**.
>
> Khi tóm tắt tin tức, rater A có thể thích bản tóm tắt siêu ngắn gọn để đọc nhanh (ưu tiên tiêu chí Conciseness), trong khi rater B lại yêu cầu phải giữ lại toàn bộ số liệu chi tiết (ưu tiên tiêu chí Coverage). Sự mâu thuẫn trong tiêu chí cá nhân này dẫn đến việc xếp hạng mù (blind ranking) của các raters trên cùng một bài viết dễ bị phân tán.
>
> Chính sự bất đồng thuận tự nhiên này của con người là luận điểm khoa học vững chắc nhất để em khẳng định: **Việc sử dụng các bộ tiêu chí Rubric chuẩn hóa chấm điểm bởi LLM-Judge (Axis B.1) là bắt buộc** để chúng ta có thể đánh giá các mô hình thế hệ mới một cách định lượng và nhất quán, loại bỏ tính chủ quan của con người.

#### Q4: Thuật toán MoA gốc của Wang et al. (2024) sử dụng 2 vòng lặp (iterations) để các proposers tự cải thiện bản nháp trước khi đưa vào aggregator. Tại sao hệ thống của em chỉ chạy 1 vòng (1 iteration)?

> **Trả lời:** Trong nghiên cứu gốc của Wang và các cộng sự, việc chạy nhiều vòng (multiple iterations) giúp các mô hình thảo luận chéo để giải quyết các câu hỏi logic phức tạp hoặc sinh mã nguồn. Tuy nhiên, đối với bài toán tóm tắt tin tức (Summarization):
>
> 1. **Mục tiêu là cô đọng thông tin hiện có**, không phải suy luận logic sâu hay sáng tạo nội dung mới. Chạy nhiều vòng chỉ làm tăng nguy cơ Aggregator tự biến đổi câu chữ xa rời văn bản nguồn (hallucinatory drift).
> 2. **Vấn đề chi phí và Latency:** Chạy thêm 1 vòng MoA sẽ nhân đôi số lượng cuộc gọi API và tăng gấp đôi Latency lên mức $12$-$15$ giây, vượt quá ngưỡng chịu đựng của một ứng dụng Chrome Extension thực tế.
>
> Thực nghiệm 1 vòng của em đã chứng minh Fused MoA vượt trội gpt-4o đơn lẻ đến **$77.1\%$** ($p=0.0002$). Do đó, cấu hình 1 vòng là điểm dừng tối ưu giữa hiệu năng thực tế và chất lượng học thuật.

#### Q5: Em giải thích thế nào về thiết kế của bước Factuality? Tại sao em lại tách thành 2 bước (Claim Splitting và Entailment)?

> **Trả lời:** Nếu chúng ta yêu cầu LLM đọc một bài báo dài và một bản tóm tắt rồi trả lời ngay câu hỏi "Bản tóm tắt này có đúng sự thật không?", LLM thường đưa ra phán quyết rất cảm tính, bỏ qua các chi tiết nhỏ hoặc bị đánh lừa bởi văn phong trôi chảy (gọi là hiện tượng ảo giác phán quyết).
>
> Để giải quyết, em áp dụng framework đánh giá thực tế dựa trên **mệnh đề nguyên tử (Atomic Claims)**:
>
> - **Bước 1:** Ép mô hình đóng vai trò biên tập viên báo chí bóc tách bản tóm tắt thành các mệnh đề cực nhỏ, có thể kiểm chứng độc lập. Việc này giúp cô lập thông tin.
> - **Bước 2:** Với từng mệnh đề cô lập đó, ép mô hình làm kiểm chứng viên đối chiếu trực tiếp với bài gốc để ra nhãn rõ ràng (`entailed`, `contradicted`, `not_mentioned`).
>
> Chia nhỏ quy trình giúp giảm tải suy luận cho LLM trên mỗi bước, giúp kết quả fact-check có độ chính xác cao hơn và cung cấp được bằng chứng giải thích cụ thể cho người dùng.

#### Q6: Tại sao BERTScore của em lại phải giới hạn ở 256 tokens? Nếu bài viết hoặc bản tóm tắt dài hơn thì sao?

> **Trả lời:** Mô hình pre-trained PhoBERT (`vinai/phobert-base`) được huấn luyện với giới hạn kiến trúc độ dài chuỗi tối đa (Max Sequence Length) là 256 tokens. Đây là giới hạn vật lý của mô hình Transformer mã hóa (Encoder-only) được sử dụng.
>
> Nếu chúng ta đưa chuỗi dài hơn 256 tokens vào mô hình, thư viện PyTorch sẽ báo lỗi tràn chỉ mục bộ nhớ hoặc tự động cắt xén thô bạo làm mất thông tin ngữ nghĩa.
>
> Để khắc phục, trong file **[main.py](file:///Users/thanglee/something%20beautiful/UniThesis/bert/main.py#L112-L116)** của microservice, em đã chủ động dùng chính bộ Tokenizer của PhoBERT để mã hóa văn bản gốc và bản tóm tắt, sau đó thực hiện cắt gọn an toàn (truncation) về đúng 256 tokens rồi mới giải mã ngược lại để truyền vào tính BERTScore. Điều này đảm bảo microservice luôn hoạt động ổn định trên môi trường production mà không bị crash.

#### Q7: Tại sao điểm ROUGE-L và BLEU của Fusion lại cao hơn gpt-4o đơn lẻ, mặc dù điểm ROUGE-1 lại thấp hơn?

> **Trả lời:**
>
> - **ROUGE-1** chỉ đo sự trùng khớp của các từ đơn lẻ (Unigrams). Một mô hình viết dài, lặp lại nhiều từ gốc sẽ dễ ăn điểm ROUGE-1 cao hơn.
> - **ROUGE-L** đo chuỗi từ chung dài nhất (Longest Common Subsequence). Điều này chứng minh Fused MoA giữ được **cấu trúc tuần tự và mạch logic** của thông tin tốt hơn, không bị đảo lộn thứ tự sự kiện.
> - **BLEU-4** đo độ chính xác của các cụm 4 từ liên tiếp (4-gram Precision) kèm theo hình phạt ngắn. Việc BLEU-4 của Fusion cao hơn ($0.0747$ vs $0.0669$) chứng minh các câu văn do Fused MoA tạo ra có **độ trôi chảy, tự nhiên** và khớp các cụm từ ngữ nghĩa dài tốt hơn hẳn việc gắp chữ đơn lẻ của mô hình đơn.

#### Q8: Chi phí thực nghiệm của em là bao nhiêu? Em quản lý hạn mức và chi phí thế nào để không bị vượt ngân sách?

> **Trả lời:** Toàn bộ thực nghiệm quy mô 50 bài báo tienphong.vn với 4 mô hình chạy forced và 1 lần chạy fusion (tổng cộng $4 \times 50 + 50 = 250$ lượt tóm tắt kèm theo hàng trăm lượt judge pairwise tự động) tiêu tốn tổng cộng khoảng **$1.24 USD** tiền API key OpenAI.
>
> Để đạt được mức chi phí tối ưu này, em đã thiết lập chính sách quản lý chi phí nghiêm ngặt:
>
> 1. Tầng Proposer (Layer 1) chỉ sử dụng các mô hình thuộc phân khúc giá rẻ (Affordable Tier) như `gpt-4o-mini`, `gemini-2.5-flash` và `claude-haiku-4-5`.
> 2. Mô hình đắt tiền `gpt-4o` chỉ được gọi duy nhất 1 lần ở tầng Aggregator (Layer 2) để thực hiện tổng hợp kết quả cuối cùng.
> 3. Trong file **[moa.prompt.ts](file:///Users/thanglee/something%20beautiful/UniThesis/backend/output-fusion/moa.prompt.ts#L28-L29)**, em đặt giới hạn cắt chuỗi đầu vào của các bản nháp Proposers ở mức `3000` ký tự và bài viết gốc ở mức `5000` ký tự để tránh việc gửi payloads quá lớn lên API làm tăng chi phí token ngoài kiểm soát.
