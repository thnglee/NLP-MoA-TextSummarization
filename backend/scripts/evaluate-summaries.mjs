/**
 * evaluate-summaries.mjs
 *
 * Tính ROUGE-L, BLEU-4, BERTScore cho 2 bản tóm tắt so với câu gốc,
 * sử dụng đúng các service/module của Fiber đang chạy trên production:
 *   - ROUGE: custom implementation (natural WordTokenizer + LCS)
 *   - BLEU:  npm package "bleu-score"
 *   - BERTScore: HF Spaces API endpoint
 *
 * Chạy: node scripts/evaluate-summaries.mjs
 */

import natural from "natural";
import { bleu } from "bleu-score";

// ─── ROUGE Custom (port trực tiếp từ utils/rouge-custom.ts) ───────────────

const tokenizer = new natural.WordTokenizer();

function lcsLength(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }
  return dp[m][n];
}

function rougeL(candidate, reference) {
  const candidateTokens = tokenizer.tokenize(candidate.toLowerCase()) || [];
  const referenceTokens = tokenizer.tokenize(reference.toLowerCase()) || [];
  if (referenceTokens.length === 0) return 0;
  const lcs = lcsLength(candidateTokens, referenceTokens);
  return lcs / referenceTokens.length;
}

// ─── BERTScore via HF Spaces API ─────────────────────────────────────────

const BERT_SERVICE_URL = "https://heheeess22-bert-score-service.hf.space";
const BERT_TIMEOUT_MS = 90_000;

async function warmUpBert() {
  try {
    const res = await fetch(`${BERT_SERVICE_URL}/healthz`, {
      signal: AbortSignal.timeout(70_000),
    });
    if (res.ok) {
      console.log("  ✅ BERT service đã sẵn sàng");
    } else {
      console.log(`  ⚠️  BERT health check trả về status ${res.status}`);
    }
  } catch {
    console.log("  ⚠️  BERT service đang cold-start, sẽ thử lại khi tính...");
  }
}

async function fetchBertScore(reference, candidate) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BERT_TIMEOUT_MS);
  try {
    const res = await fetch(`${BERT_SERVICE_URL}/calculate-score`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reference_text: reference,
        candidate_text: candidate,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`HTTP ${res.status}: ${txt.substring(0, 120)}`);
    }
    const data = await res.json();
    return data.f1_score;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Dữ liệu đầu vào ────────────────────────────────────────────────────

const ref =
  "Báo cáo nghiên cứu chỉ ra rằng, biến đổi khí hậu toàn cầu và ô nhiễm môi trường nghiêm trọng, đã làm lượng khí nhà kính phát thải vào khí quyển đã tăng lên một mức đáng báo động trong thập kỷ qua.";

const s1 =
  "Nghiên cứu cho biết biến đổi khí hậu toàn cầu và ô nhiễm môi trường làm khí nhà kính tăng mức đáng báo động khí nhà kính.";

const s2 =
  "Nghiên cứu mới đây cho biết biến đổi khí hậu và ô nhiễm môi trường đã làm tăng đáng kể lượng khí nhà kính trong mười năm qua.";

// ─── Hàm đánh giá ────────────────────────────────────────────────────────

async function evaluateSummary(summary, name) {
  console.log(`\n${"=".repeat(50)}`);
  console.log(` ĐANG TÍNH TOÁN CHO: ${name}`);
  console.log(`${"=".repeat(50)}`);

  // 1. ROUGE-L (giống hệt Fiber evaluation.service.ts)
  const rougeLScore = rougeL(summary, ref);
  console.log(`ROUGE-L     : ${rougeLScore.toFixed(4)}`);

  // 2. BLEU-4 (giống hệt Fiber: bleu(reference, candidate, 4))
  const bleuScore = bleu(ref, summary, 4);
  console.log(`BLEU-4      : ${bleuScore.toFixed(4)}`);

  // 3. BERTScore (gọi API HF Spaces — giống bert.service.ts)
  try {
    const bertF1 = await fetchBertScore(ref, summary);
    console.log(`BERTScore   : ${bertF1.toFixed(4)}`);
  } catch (err) {
    console.log(`BERTScore   : ❌ Lỗi - ${err.message}`);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────

async function main() {
  console.log("🚀 Đang khởi động đánh giá bằng hệ thống Fiber...");
  console.log(`🔗 BERT Service: ${BERT_SERVICE_URL}`);
  console.log("");

  // Warm up BERT service trước
  console.log("⏳ Đang đánh thức BERT service (có thể mất 30-60s nếu cold-start)...");
  await warmUpBert();

  await evaluateSummary(s1, 'BẢN TÓM TẮT 1 (Nhiều từ trùng lặp)');
  await evaluateSummary(s2, 'BẢN TÓM TẮT 2 (Viết lại tự nhiên)');

  console.log("\n✅ Hoàn tất tính toán!");
}

main().catch((err) => {
  console.error("❌ Lỗi:", err);
  process.exit(1);
});
