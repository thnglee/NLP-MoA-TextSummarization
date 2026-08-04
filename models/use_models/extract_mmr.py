import json
import math
import re
import time
from pathlib import Path

import numpy as np
import torch
from sentence_transformers import SentenceTransformer
from underthesea import sent_tokenize


# =============================== CẤU HÌNH ===============================
DATASET_PATH = Path("dataset/vietnews/test.jsonl")
MODEL_PATH = Path("models/mmr/paraphrase-multilingual-MiniLM-L12-v2")
OUTPUT_DIR = Path("output/summary/mmr_optimized/vietnews_test")

START_INDEX = 0
MAX_SAMPLES: int | None = 10

# MMR lấy nguyên câu; hai tham số này khống chế độ dài đầu ra.
MAX_SUMMARY_SENTENCES = 3
MAX_SUMMARY_WORDS = 55

# Bộ lọc câu ứng viên.
MIN_SENTENCE_WORDS = 6
MAX_SENTENCE_WORDS = 70

# Tổng trọng số nên bằng 1.0.
DOCUMENT_WEIGHT = 0.50
TITLE_WEIGHT = 0.20
POSITION_WEIGHT = 0.20
LENGTH_WEIGHT = 0.10

# Cao hơn: ưu tiên câu quan trọng. Thấp hơn: ưu tiên đa dạng.
MMR_LAMBDA = 0.74
TRIGRAM_OVERLAP_THRESHOLD = 0.35
ENCODE_BATCH_SIZE = 32

DEVICE = "cuda" if torch.cuda.is_available() else "cpu"


def normalize_text(text: str) -> str:
    text = str(text).replace("_", " ")
    text = re.sub(r"\s+", " ", text)
    text = re.sub(r"\s+([.,!?;:%])", r"\1", text)
    text = re.sub(r"([([{])\s+", r"\1", text)
    text = re.sub(r"\s+([)\]}])", r"\1", text)
    text = re.sub(r'"\s+', '"', text)
    text = re.sub(r'\s+"', '"', text)
    return text.strip()


def split_sentences(text: str) -> list[str]:
    text = normalize_text(text)
    if not text:
        return []

    return [
        normalize_text(sentence)
        for sentence in sent_tokenize(text)
        if isinstance(sentence, str) and sentence.strip()
    ]


def tokenize_simple(text: str) -> list[str]:
    return re.findall(r"(?u)\b[\wÀ-ỹ]+\b", text.lower())


def count_words(text: str) -> int:
    return len(tokenize_simple(text))


def looks_like_noise(sentence: str) -> bool:
    lowered = sentence.lower().strip()
    words = tokenize_simple(sentence)

    if not words:
        return True

    if any(
        re.search(pattern, lowered)
        for pattern in (
            r"^(ảnh|hình|video)\s*:",
            r"^(nguồn|theo)\s*:",
            r"^(tác giả|phóng viên)\s*:",
        )
    ):
        return True

    # Ví dụ chú thích ảnh: "Huy tại phiên toà."
    return len(words) <= 5 and not re.search(r"[!?]", sentence)


def build_candidates(sentences: list[str]) -> list[tuple[int, str]]:
    candidates = [
        (index, sentence)
        for index, sentence in enumerate(sentences)
        if MIN_SENTENCE_WORDS <= count_words(sentence) <= MAX_SENTENCE_WORDS
        and not looks_like_noise(sentence)
    ]

    minimum_needed = min(MAX_SUMMARY_SENTENCES, len(sentences))
    return candidates if len(candidates) >= minimum_needed else list(enumerate(sentences))


def load_jsonl_dataset(dataset_path: Path) -> list[dict]:
    if not dataset_path.exists():
        raise FileNotFoundError(f"Không tìm thấy dataset: {dataset_path.resolve()}")

    samples: list[dict] = []
    with dataset_path.open("r", encoding="utf-8") as file:
        for line_number, line in enumerate(file, start=1):
            line = line.strip()
            if not line:
                continue

            try:
                sample = json.loads(line)
            except json.JSONDecodeError as error:
                raise ValueError(
                    f"JSONL không hợp lệ tại dòng {line_number}: {error}"
                ) from error

            if not isinstance(sample, dict):
                raise ValueError(f"Dòng {line_number} không phải JSON object.")

            samples.append(sample)

    if not samples:
        raise ValueError("Dataset không có dữ liệu.")

    return samples


def get_article(sample: dict) -> str:
    for field in ("article", "document", "text", "content"):
        value = sample.get(field)
        if isinstance(value, str) and value.strip():
            return normalize_text(value)

    raise ValueError("Mẫu không có trường article/document/text/content.")


def get_title(sample: dict) -> str:
    value = sample.get("title", "")
    return normalize_text(value) if isinstance(value, str) else ""


def get_reference_summary(sample: dict) -> str:
    for field in ("abstract", "summary", "reference"):
        value = sample.get(field)
        if isinstance(value, str):
            return normalize_text(value)
    return ""


def load_embedding_model(model_path: Path) -> SentenceTransformer:
    if not model_path.exists():
        raise FileNotFoundError(f"Không tìm thấy model: {model_path.resolve()}")
    if not (model_path / "modules.json").exists():
        raise FileNotFoundError(f"Model thiếu modules.json: {model_path.resolve()}")

    print("=" * 80)
    print("ĐANG LOAD SENTENCE TRANSFORMER")
    print(f"Model: {model_path.resolve()}")
    print(f"Device: {DEVICE}")
    started = time.perf_counter()

    model = SentenceTransformer(
        str(model_path),
        device=DEVICE,
        local_files_only=True,
    )

    print(f"Load model: {time.perf_counter() - started:.4f} giây")
    print(f"Max sequence length: {model.max_seq_length}")
    print("=" * 80)
    return model


def warm_up_model(model: SentenceTransformer) -> None:
    model.encode(
        ["Khởi động mô hình tóm tắt tiếng Việt."],
        batch_size=1,
        show_progress_bar=False,
        convert_to_numpy=True,
        normalize_embeddings=True,
    )
    if DEVICE == "cuda":
        torch.cuda.synchronize()


def min_max_normalize(values: np.ndarray) -> np.ndarray:
    values = np.asarray(values, dtype=np.float32)
    minimum = float(values.min())
    maximum = float(values.max())

    if maximum - minimum < 1e-12:
        return np.full_like(values, 0.5, dtype=np.float32)

    return (values - minimum) / (maximum - minimum)


def calculate_position_scores(
    original_indices: list[int],
    total_sentences: int,
) -> np.ndarray:
    decay = max(3.0, total_sentences / 3.0)
    values = np.array(
        [math.exp(-index / decay) for index in original_indices],
        dtype=np.float32,
    )
    return min_max_normalize(values)


def calculate_length_scores(sentences: list[str]) -> np.ndarray:
    # Ưu tiên câu khoảng 24 từ; câu quá ngắn/dài bị giảm điểm.
    values = np.array(
        [math.exp(-((count_words(sentence) - 24.0) / 18.0) ** 2) for sentence in sentences],
        dtype=np.float32,
    )
    return min_max_normalize(values)


def create_ngrams(tokens: list[str], n: int = 3) -> set[tuple[str, ...]]:
    return {
        tuple(tokens[index:index + n])
        for index in range(max(0, len(tokens) - n + 1))
    }


def trigram_overlap_ratio(first: str, second: str) -> float:
    first_ngrams = create_ngrams(tokenize_simple(first))
    second_ngrams = create_ngrams(tokenize_simple(second))

    if not first_ngrams or not second_ngrams:
        return 0.0

    shared = len(first_ngrams & second_ngrams)
    return shared / max(1, min(len(first_ngrams), len(second_ngrams)))


def select_with_mmr(
    sentences: list[str],
    relevance_scores: np.ndarray,
    similarity_matrix: np.ndarray,
    max_sentences: int,
    max_words: int,
    mmr_lambda: float,
) -> list[int]:
    if not 0.0 <= mmr_lambda <= 1.0:
        raise ValueError("mmr_lambda phải thuộc [0, 1].")

    selected: list[int] = []
    candidates = set(range(len(sentences)))
    current_words = 0

    while candidates and len(selected) < max_sentences:
        best_index: int | None = None
        best_score = float("-inf")

        for index in sorted(candidates):
            sentence_words = count_words(sentences[index])

            if selected and current_words + sentence_words > max_words:
                continue

            if any(
                trigram_overlap_ratio(sentences[index], sentences[old_index])
                >= TRIGRAM_OVERLAP_THRESHOLD
                for old_index in selected
            ):
                continue

            redundancy = (
                max(float(similarity_matrix[index, old_index]) for old_index in selected)
                if selected
                else 0.0
            )

            score = (
                mmr_lambda * float(relevance_scores[index])
                - (1.0 - mmr_lambda) * redundancy
                - 1e-6 * sentence_words
            )

            if score > best_score:
                best_score = score
                best_index = index

        if best_index is None:
            break

        selected.append(best_index)
        candidates.remove(best_index)
        current_words += count_words(sentences[best_index])

    if not selected and sentences:
        selected = [int(np.argmax(relevance_scores))]

    return selected


def summarize_extractive(
    text: str,
    title: str,
    model: SentenceTransformer,
    max_sentences: int = MAX_SUMMARY_SENTENCES,
    max_words: int = MAX_SUMMARY_WORDS,
    mmr_lambda: float = MMR_LAMBDA,
) -> str:
    """
    Zero-shot sentence-level extractive summarization.

    Điểm câu = ngữ nghĩa toàn bài + tiêu đề + vị trí + độ dài.
    Sau đó MMR giảm lặp, trigram blocking chặn câu quá giống nhau,
    và word budget khống chế độ dài đầu ra.
    """
    all_sentences = split_sentences(text)
    if not all_sentences:
        return ""
    if len(all_sentences) == 1:
        return all_sentences[0]

    candidates = build_candidates(all_sentences)
    original_indices = [item[0] for item in candidates]
    sentences = [item[1] for item in candidates]

    title = normalize_text(title)
    texts_to_encode = sentences + ([title] if title else [])

    embeddings = model.encode(
        texts_to_encode,
        batch_size=ENCODE_BATCH_SIZE,
        show_progress_bar=False,
        convert_to_numpy=True,
        normalize_embeddings=True,
    )
    embeddings = np.asarray(embeddings, dtype=np.float32)
    sentence_embeddings = embeddings[:len(sentences)]

    document_embedding = sentence_embeddings.mean(axis=0)
    document_norm = float(np.linalg.norm(document_embedding))
    if document_norm > 1e-12:
        document_embedding /= document_norm

    document_scores = min_max_normalize(sentence_embeddings @ document_embedding)

    if title:
        title_scores = min_max_normalize(sentence_embeddings @ embeddings[-1])
    else:
        title_scores = np.zeros(len(sentences), dtype=np.float32)

    position_scores = calculate_position_scores(original_indices, len(all_sentences))
    length_scores = calculate_length_scores(sentences)

    relevance_scores = (
        DOCUMENT_WEIGHT * document_scores
        + TITLE_WEIGHT * title_scores
        + POSITION_WEIGHT * position_scores
        + LENGTH_WEIGHT * length_scores
    )

    similarity_matrix = sentence_embeddings @ sentence_embeddings.T
    np.fill_diagonal(similarity_matrix, 0.0)

    selected_candidates = select_with_mmr(
        sentences=sentences,
        relevance_scores=relevance_scores,
        similarity_matrix=similarity_matrix,
        max_sentences=min(max_sentences, len(sentences)),
        max_words=max_words,
        mmr_lambda=mmr_lambda,
    )

    selected_original_indices = sorted(
        original_indices[index] for index in selected_candidates
    )

    return " ".join(all_sentences[index] for index in selected_original_indices)


def save_test_result(
    output_dir: Path,
    sample_index: int,
    sample: dict,
    prediction: str,
    elapsed_time: float,
) -> Path:
    guid = sample.get("guid", sample_index)
    safe_guid = re.sub(r'[<>:"/\\|?*]', "_", str(guid))
    output_path = output_dir / f"{sample_index:05d}_{safe_guid}.txt"

    content = (
        f"INDEX:\n{sample_index}\n"
        f"GUID:\n{guid}\n"
        f"TITLE:\n{get_title(sample)}\n"
        f"VĂN BẢN GỐC:\n{get_article(sample)}\n"
        f"TÓM TẮT THAM CHIẾU:\n{get_reference_summary(sample)}\n"
        f"TÓM TẮT DO SBERT + MMR SINH:\n{prediction}\n"
        f"THỜI GIAN TÓM TẮT:\n{elapsed_time:.4f} giây\n"
    )

    output_path.write_text(content, encoding="utf-8")
    return output_path


def run_extractive_on_vietnews(
    dataset_path: Path = DATASET_PATH,
    model_path: Path = MODEL_PATH,
    output_dir: Path = OUTPUT_DIR,
    start_index: int = START_INDEX,
    max_samples: int | None = MAX_SAMPLES,
) -> None:
    samples = load_jsonl_dataset(Path(dataset_path))

    if not 0 <= start_index < len(samples):
        raise ValueError(f"start_index phải nằm trong khoảng 0 đến {len(samples) - 1}.")
    if max_samples is not None and max_samples <= 0:
        raise ValueError("max_samples phải lớn hơn 0 hoặc bằng None.")

    end_index = (
        len(samples)
        if max_samples is None
        else min(start_index + max_samples, len(samples))
    )

    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    error_log_path = output_dir / "errors.txt"
    if error_log_path.exists():
        error_log_path.unlink()

    model = load_embedding_model(Path(model_path))
    warm_up_model(model)

    print(f"Tổng số mẫu: {len(samples)}")
    print(f"Phạm vi chạy: {start_index} đến {end_index - 1}")
    print(f"Tối đa số câu: {MAX_SUMMARY_SENTENCES}")
    print(f"Tối đa số từ: {MAX_SUMMARY_WORDS}")
    print(f"MMR lambda: {MMR_LAMBDA}")
    print("Phương pháp: Sentence Transformer + Weighted Scoring + MMR")
    print("=" * 80)

    success_count = 0
    error_count = 0
    total_time = 0.0

    for index in range(start_index, end_index):
        sample = samples[index]

        try:
            if DEVICE == "cuda":
                torch.cuda.synchronize()

            started = time.perf_counter()
            prediction = summarize_extractive(
                text=get_article(sample),
                title=get_title(sample),
                model=model,
            )

            if DEVICE == "cuda":
                torch.cuda.synchronize()

            elapsed_time = time.perf_counter() - started
            total_time += elapsed_time

            saved_path = save_test_result(
                output_dir=output_dir,
                sample_index=index,
                sample=sample,
                prediction=prediction,
                elapsed_time=elapsed_time,
            )

            success_count += 1
            print(
                f"[{index + 1}/{end_index}] "
                f"{elapsed_time:.4f} giây | "
                f"{count_words(prediction)} từ | "
                f"Đã lưu: {saved_path}"
            )

        except Exception as error:
            error_count += 1
            with error_log_path.open("a", encoding="utf-8") as file:
                file.write(f"Index {index}: {type(error).__name__}: {error}\n")
            print(f"[{index + 1}/{end_index}] Lỗi: {error}")

    average_time = total_time / success_count if success_count else 0.0

    print("\n" + "=" * 80)
    print("HOÀN THÀNH EXTRACTIVE SUMMARIZATION")
    print(f"Thành công: {success_count}")
    print(f"Lỗi: {error_count}")
    print(f"Tổng thời gian: {total_time:.4f} giây")
    print(f"Trung bình: {average_time:.4f} giây/mẫu")
    print(f"Kết quả: {output_dir.resolve()}")


if __name__ == "__main__":
    run_extractive_on_vietnews()