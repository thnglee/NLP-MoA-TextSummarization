import json
import re
import time
from pathlib import Path

import networkx as nx
import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity


DATASET_PATH = Path("dataset/vietnews/test.jsonl")
OUTPUT_DIR = Path("output/summary/lexrank/vietnews_test")

START_INDEX = 0
MAX_SAMPLES = 10
SUMMARY_SENTENCES = 3

# Hai câu chỉ được nối nếu cosine similarity
# lớn hơn hoặc bằng ngưỡng này.
SIMILARITY_THRESHOLD = 0.10


def normalize_text(text: str) -> str:
    text = text.replace("_", " ")
    text = re.sub(r"\s+", " ", text)
    text = re.sub(r"\s+([.,!?;:])", r"\1", text)
    return text.strip()


def split_sentences(text: str) -> list[str]:
    text = normalize_text(text)

    if not text:
        return []

    sentences = re.split(
        r"(?<=[.!?])\s+(?=[A-ZÀ-Ỹ0-9\"“‘(])",
        text,
    )

    return [
        sentence.strip()
        for sentence in sentences
        if sentence.strip()
    ]


def load_jsonl_dataset(dataset_path: Path) -> list[dict]:
    if not dataset_path.exists():
        raise FileNotFoundError(
            f"Không tìm thấy dataset: {dataset_path.resolve()}"
        )

    samples = []

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
                raise ValueError(
                    f"Dòng {line_number} không phải JSON object."
                )

            samples.append(sample)

    if not samples:
        raise ValueError("Dataset không có dữ liệu.")

    return samples


def get_article(sample: dict) -> str:
    for field in ["article", "document", "text", "content"]:
        value = sample.get(field)

        if isinstance(value, str) and value.strip():
            return normalize_text(value)

    raise ValueError(
        "Mẫu không có trường article/document/text/content."
    )


def get_reference_summary(sample: dict) -> str:
    for field in ["abstract", "summary", "reference"]:
        value = sample.get(field)

        if isinstance(value, str):
            return normalize_text(value)

    return ""


def summarize_lexrank(
    text: str,
    num_sentences: int = 3,
    similarity_threshold: float = 0.10,
) -> str:
    """
    LexRank extractive summarization:

    1. Tách văn bản thành câu.
    2. Biểu diễn câu bằng TF-IDF.
    3. Tính cosine similarity.
    4. Chỉ giữ cạnh vượt ngưỡng.
    5. Chạy PageRank/eigenvector centrality.
    6. Chọn câu quan trọng nhất.
    """
    sentences = split_sentences(text)

    if not sentences:
        return ""

    if len(sentences) <= num_sentences:
        return " ".join(sentences)

    try:
        vectorizer = TfidfVectorizer(
            lowercase=True,
            token_pattern=r"(?u)\b\w+\b",
        )

        sentence_vectors = vectorizer.fit_transform(sentences)

    except ValueError:
        return " ".join(sentences[:num_sentences])

    similarity_matrix = cosine_similarity(
        sentence_vectors,
        sentence_vectors,
    )

    np.fill_diagonal(similarity_matrix, 0.0)

    # LexRank dùng ngưỡng để loại các liên kết yếu.
    adjacency_matrix = np.where(
        similarity_matrix >= similarity_threshold,
        similarity_matrix,
        0.0,
    )

    graph = nx.from_numpy_array(adjacency_matrix)

    # Nếu đồ thị hoàn toàn không có cạnh,
    # chọn các câu đầu tiên làm phương án dự phòng.
    if graph.number_of_edges() == 0:
        return " ".join(sentences[:num_sentences])

    try:
        scores = nx.pagerank(
            graph,
            weight="weight",
            max_iter=1000,
        )
    except nx.PowerIterationFailedConvergence:
        scores = {
            index: float(adjacency_matrix[index].sum())
            for index in range(len(sentences))
        }

    ranked_indices = sorted(
        range(len(sentences)),
        key=lambda index: scores.get(index, 0.0),
        reverse=True,
    )

    selected_indices = sorted(
        ranked_indices[:num_sentences]
    )

    selected_sentences = [
        sentences[index]
        for index in selected_indices
    ]

    return " ".join(selected_sentences)


def save_test_result(
    output_dir: Path,
    sample_index: int,
    sample: dict,
    prediction: str,
    elapsed_time: float,
) -> Path:
    guid = sample.get("guid", sample_index)

    safe_guid = re.sub(
        r'[<>:"/\\|?*]',
        "_",
        str(guid),
    )

    output_path = output_dir / (
        f"{sample_index:05d}_{safe_guid}.txt"
    )

    title = normalize_text(str(sample.get("title", "")))
    article = get_article(sample)
    reference = get_reference_summary(sample)

    content = (
        f"INDEX:\n"
        f"{sample_index}\n"
        f"GUID:\n"
        f"{guid}\n"
        f"TITLE:\n"
        f"{title}\n"
        f"VĂN BẢN GỐC:\n"
        f"{article}\n"
        f"TÓM TẮT THAM CHIẾU:\n"
        f"{reference}\n"
        f"TÓM TẮT DO LEXRANK SINH:\n"
        f"{prediction}\n"
        f"THỜI GIAN TÓM TẮT:\n"
        f"{elapsed_time:.4f} giây\n"
    )

    output_path.write_text(
        content,
        encoding="utf-8",
    )

    return output_path


def run_lexrank_on_vietnews(
    dataset_path: Path = DATASET_PATH,
    output_dir: Path = OUTPUT_DIR,
    start_index: int = START_INDEX,
    max_samples: int | None = MAX_SAMPLES,
    num_sentences: int = SUMMARY_SENTENCES,
    similarity_threshold: float = SIMILARITY_THRESHOLD,
) -> None:
    samples = load_jsonl_dataset(dataset_path)

    if start_index < 0 or start_index >= len(samples):
        raise ValueError(
            f"start_index phải nằm trong khoảng "
            f"0 đến {len(samples) - 1}."
        )

    end_index = len(samples)

    if max_samples is not None:
        end_index = min(
            start_index + max_samples,
            len(samples),
        )

    output_dir.mkdir(
        parents=True,
        exist_ok=True,
    )

    success_count = 0
    error_count = 0
    total_time = 0.0

    error_log_path = output_dir / "errors.txt"

    print(f"Tổng số mẫu: {len(samples)}")
    print(f"Phạm vi chạy: {start_index} đến {end_index - 1}")
    print(f"Số câu tóm tắt: {num_sentences}")
    print(f"Ngưỡng similarity: {similarity_threshold}")
    print("Thuật toán: LexRank")

    for index in range(start_index, end_index):
        sample = samples[index]

        try:
            article = get_article(sample)

            start_time = time.perf_counter()

            prediction = summarize_lexrank(
                text=article,
                num_sentences=num_sentences,
                similarity_threshold=similarity_threshold,
            )

            elapsed_time = time.perf_counter() - start_time
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
                f"Đã lưu: {saved_path}"
            )

        except Exception as error:
            error_count += 1

            error_message = (
                f"Index {index}: "
                f"{type(error).__name__}: {error}\n"
            )

            with error_log_path.open(
                "a",
                encoding="utf-8",
            ) as file:
                file.write(error_message)

            print(
                f"[{index + 1}/{end_index}] "
                f"Lỗi: {error}"
            )

    average_time = (
        total_time / success_count
        if success_count > 0
        else 0.0
    )

    print("\n" + "=" * 80)
    print("HOÀN THÀNH LEXRANK")
    print(f"Thành công: {success_count}")
    print(f"Lỗi: {error_count}")
    print(f"Tổng thời gian: {total_time:.4f} giây")
    print(f"Trung bình: {average_time:.4f} giây/mẫu")
    print(f"Kết quả: {output_dir.resolve()}")


if __name__ == "__main__":
    run_lexrank_on_vietnews()