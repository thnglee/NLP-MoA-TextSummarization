import json
import re
import time
from pathlib import Path

import numpy as np
import torch
from sentence_transformers import SentenceTransformer
from sklearn.metrics.pairwise import cosine_similarity
from underthesea import sent_tokenize


DATASET_PATH = Path("dataset/vietnews/test.jsonl")

MODEL_PATH = Path(
    "models/mmr/paraphrase-multilingual-MiniLM-L12-v2"
)

OUTPUT_DIR = Path(
    "output/summary/mmr/vietnews_test"
)

START_INDEX = 0
MAX_SAMPLES = 10
SUMMARY_SENTENCES = 3

# MMR_LAMBDA càng cao thì càng ưu tiên câu liên quan.
# MMR_LAMBDA càng thấp thì càng ưu tiên sự đa dạng.
MMR_LAMBDA = 0.70

# Trọng số ưu tiên vị trí câu trong bài báo.
# Tin tức thường đặt thông tin quan trọng ở đầu bài.
POSITION_WEIGHT = 0.15

DEVICE = "cuda" if torch.cuda.is_available() else "cpu"


def normalize_text(text: str) -> str:
    """
    Chuẩn hóa văn bản trước khi tách câu và lưu kết quả.
    """
    text = str(text)

    text = text.replace("_", " ")
    text = re.sub(r"\s+", " ", text)

    # Xóa khoảng trắng trước dấu câu.
    text = re.sub(
        r"\s+([.,!?;:%])",
        r"\1",
        text,
    )

    # Chuẩn hóa khoảng trắng quanh dấu ngoặc kép.
    text = re.sub(r'"\s+', '"', text)
    text = re.sub(r'\s+"', '"', text)

    return text.strip()


def split_sentences(text: str) -> list[str]:
    """
    Tách câu tiếng Việt bằng Underthesea.

    Underthesea xử lý tốt hơn regex đối với:
    - TP. Đà Nẵng
    - PGS. TS.
    - tên viết tắt như H., T., Th.
    """
    text = normalize_text(text)

    if not text:
        return []

    sentences = sent_tokenize(text)

    return [
        normalize_text(sentence)
        for sentence in sentences
        if isinstance(sentence, str)
        and sentence.strip()
    ]


def load_mmr_model(
    model_path: Path = MODEL_PATH,
) -> SentenceTransformer:
    """
    Load Sentence Transformer từ thư mục local.
    """
    if not model_path.exists():
        raise FileNotFoundError(
            f"Không tìm thấy model MMR tại: "
            f"{model_path.resolve()}"
        )

    modules_path = model_path / "modules.json"

    if not modules_path.exists():
        raise FileNotFoundError(
            f"Thư mục model không hợp lệ, thiếu file: "
            f"{modules_path.resolve()}"
        )

    print("=" * 80)
    print("ĐANG LOAD MODEL MMR")
    print(f"Model path: {model_path.resolve()}")
    print(f"Device: {DEVICE}")

    start_time = time.perf_counter()

    model = SentenceTransformer(
        str(model_path),
        device=DEVICE,
        local_files_only=True,
    )

    elapsed_time = time.perf_counter() - start_time

    print(f"Load model thành công: {elapsed_time:.4f} giây")
    print("=" * 80)

    return model


def load_jsonl_dataset(
    dataset_path: Path,
) -> list[dict]:
    """
    Đọc toàn bộ dataset JSONL.
    """
    if not dataset_path.exists():
        raise FileNotFoundError(
            f"Không tìm thấy dataset: "
            f"{dataset_path.resolve()}"
        )

    samples: list[dict] = []

    with dataset_path.open(
        "r",
        encoding="utf-8",
    ) as file:
        for line_number, line in enumerate(
            file,
            start=1,
        ):
            line = line.strip()

            if not line:
                continue

            try:
                sample = json.loads(line)

            except json.JSONDecodeError as error:
                raise ValueError(
                    f"JSONL không hợp lệ tại dòng "
                    f"{line_number}: {error}"
                ) from error

            if not isinstance(sample, dict):
                raise ValueError(
                    f"Dòng {line_number} "
                    f"không phải JSON object."
                )

            samples.append(sample)

    if not samples:
        raise ValueError(
            "Dataset không có dữ liệu."
        )

    return samples


def get_article(sample: dict) -> str:
    """
    Lấy văn bản gốc từ một trong các trường phổ biến.
    """
    for field in [
        "article",
        "document",
        "text",
        "content",
    ]:
        value = sample.get(field)

        if (
            isinstance(value, str)
            and value.strip()
        ):
            return normalize_text(value)

    raise ValueError(
        "Mẫu không có trường "
        "article/document/text/content."
    )


def get_reference_summary(
    sample: dict,
) -> str:
    """
    Lấy bản tóm tắt tham chiếu.

    Với VietNews, trường thường dùng là abstract.
    """
    for field in [
        "abstract",
        "summary",
        "reference",
    ]:
        value = sample.get(field)

        if isinstance(value, str):
            return normalize_text(value)

    return ""


def min_max_normalize(
    values: np.ndarray,
) -> np.ndarray:
    """
    Chuẩn hóa mảng về khoảng [0, 1].
    """
    values = np.asarray(
        values,
        dtype=np.float32,
    )

    minimum = float(values.min())
    maximum = float(values.max())

    if maximum - minimum < 1e-12:
        return np.zeros_like(
            values,
            dtype=np.float32,
        )

    return (
        values - minimum
    ) / (
        maximum - minimum
    )


def calculate_position_scores(
    number_of_sentences: int,
) -> np.ndarray:
    """
    Điểm vị trí:

    Câu đầu có điểm cao nhất, các câu phía sau
    giảm dần theo công thức 1 / (vị trí + 1).
    """
    scores = np.array(
        [
            1.0 / (index + 1)
            for index in range(
                number_of_sentences
            )
        ],
        dtype=np.float32,
    )

    return min_max_normalize(scores)


def select_sentences_with_mmr(
    relevance_scores: np.ndarray,
    similarity_matrix: np.ndarray,
    num_sentences: int,
    mmr_lambda: float = 0.70,
) -> list[int]:
    """
    Chọn câu bằng Maximum Marginal Relevance.

    MMR score =
        lambda * độ liên quan
        - (1 - lambda) * độ trùng lặp

    relevance_scores:
        Mức độ đại diện của từng câu đối với văn bản.

    similarity_matrix:
        Độ tương đồng giữa từng cặp câu.
    """
    if not 0.0 <= mmr_lambda <= 1.0:
        raise ValueError(
            "mmr_lambda phải nằm trong khoảng [0, 1]."
        )

    selected: list[int] = []

    candidates = set(
        range(len(relevance_scores))
    )

    while (
        candidates
        and len(selected) < num_sentences
    ):
        best_index: int | None = None
        best_mmr_score = float("-inf")

        for index in candidates:
            relevance = float(
                relevance_scores[index]
            )

            if selected:
                redundancy = max(
                    float(
                        similarity_matrix[
                            index,
                            selected_index,
                        ]
                    )
                    for selected_index in selected
                )
            else:
                redundancy = 0.0

            mmr_score = (
                mmr_lambda * relevance
                - (1.0 - mmr_lambda)
                * redundancy
            )

            if mmr_score > best_mmr_score:
                best_mmr_score = mmr_score
                best_index = index

        if best_index is None:
            break

        selected.append(best_index)
        candidates.remove(best_index)

    # Sắp xếp lại để các câu xuất hiện đúng
    # thứ tự trong văn bản gốc.
    return sorted(selected)


def summarize_mmr(
    text: str,
    model: SentenceTransformer,
    num_sentences: int = 3,
    mmr_lambda: float = 0.70,
    position_weight: float = 0.15,
) -> str:
    """
    Tóm tắt trích xuất bằng Sentence Transformer + MMR.

    Pipeline:

    1. Tách văn bản thành câu.
    2. Tạo embedding cho từng câu.
    3. Tính embedding đại diện toàn văn bản.
    4. Tính độ liên quan của từng câu.
    5. Kết hợp độ liên quan với điểm vị trí.
    6. Dùng MMR để giảm trùng lặp.
    7. Ghép các câu được chọn theo thứ tự gốc.
    """
    sentences = split_sentences(text)

    if not sentences:
        return ""

    if num_sentences <= 0:
        raise ValueError(
            "num_sentences phải lớn hơn 0."
        )

    num_sentences = min(
        num_sentences,
        len(sentences),
    )

    if len(sentences) <= num_sentences:
        return " ".join(sentences)

    # Embedding từng câu.
    sentence_embeddings = model.encode(
        sentences,
        batch_size=32,
        show_progress_bar=False,
        convert_to_numpy=True,
        normalize_embeddings=True,
    )

    sentence_embeddings = np.asarray(
        sentence_embeddings,
        dtype=np.float32,
    )

    # Vector đại diện văn bản là trung bình
    # embedding của tất cả câu.
    document_embedding = np.mean(
        sentence_embeddings,
        axis=0,
        keepdims=True,
    )

    # Chuẩn hóa vector văn bản.
    document_norm = np.linalg.norm(
        document_embedding,
        axis=1,
        keepdims=True,
    )

    document_embedding = (
        document_embedding
        / np.maximum(document_norm, 1e-12)
    )

    # Độ liên quan giữa từng câu
    # và toàn bộ văn bản.
    semantic_scores = cosine_similarity(
        sentence_embeddings,
        document_embedding,
    ).reshape(-1)

    semantic_scores = min_max_normalize(
        semantic_scores
    )

    # Điểm ưu tiên các câu đầu bài.
    position_scores = calculate_position_scores(
        len(sentences)
    )

    if not 0.0 <= position_weight <= 1.0:
        raise ValueError(
            "position_weight phải nằm trong khoảng [0, 1]."
        )

    # Điểm quan trọng cuối cùng.
    relevance_scores = (
        (1.0 - position_weight)
        * semantic_scores
        + position_weight
        * position_scores
    )

    # Độ tương đồng giữa từng cặp câu,
    # dùng để loại câu trùng ý.
    similarity_matrix = cosine_similarity(
        sentence_embeddings,
        sentence_embeddings,
    )

    # Không tự coi câu giống chính nó.
    np.fill_diagonal(
        similarity_matrix,
        0.0,
    )

    selected_indices = select_sentences_with_mmr(
        relevance_scores=relevance_scores,
        similarity_matrix=similarity_matrix,
        num_sentences=num_sentences,
        mmr_lambda=mmr_lambda,
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
    """
    Lưu kết quả từng mẫu ra file TXT.
    """
    guid = sample.get(
        "guid",
        sample_index,
    )

    safe_guid = re.sub(
        r'[<>:"/\\|?*]',
        "_",
        str(guid),
    )

    output_path = output_dir / (
        f"{sample_index:05d}_{safe_guid}.txt"
    )

    title = normalize_text(
        str(sample.get("title", ""))
    )

    article = get_article(sample)

    reference = get_reference_summary(
        sample
    )

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
        f"TÓM TẮT DO MMR SINH:\n"
        f"{prediction}\n"
        f"THỜI GIAN TÓM TẮT:\n"
        f"{elapsed_time:.4f} giây\n"
    )

    output_path.write_text(
        content,
        encoding="utf-8",
    )

    return output_path


def run_mmr_on_vietnews(
    dataset_path: Path = DATASET_PATH,
    model_path: Path = MODEL_PATH,
    output_dir: Path = OUTPUT_DIR,
    start_index: int = START_INDEX,
    max_samples: int | None = MAX_SAMPLES,
    num_sentences: int = SUMMARY_SENTENCES,
    mmr_lambda: float = MMR_LAMBDA,
    position_weight: float = POSITION_WEIGHT,
) -> None:
    """
    Chạy MMR trên dataset VietNews.
    """
    dataset_path = Path(dataset_path)
    model_path = Path(model_path)
    output_dir = Path(output_dir)

    samples = load_jsonl_dataset(
        dataset_path
    )

    if (
        start_index < 0
        or start_index >= len(samples)
    ):
        raise ValueError(
            f"start_index phải nằm trong khoảng "
            f"0 đến {len(samples) - 1}."
        )

    if max_samples is not None and max_samples <= 0:
        raise ValueError(
            "max_samples phải lớn hơn 0 "
            "hoặc bằng None."
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

    # Load model một lần trước vòng lặp.
    model = load_mmr_model(
        model_path=model_path
    )

    success_count = 0
    error_count = 0
    total_time = 0.0

    error_log_path = (
        output_dir / "errors.txt"
    )

    # Xóa log lỗi cũ để tránh trộn nhiều lần chạy.
    if error_log_path.exists():
        error_log_path.unlink()

    print(f"Tổng số mẫu: {len(samples)}")
    print(
        f"Phạm vi chạy: "
        f"{start_index} đến {end_index - 1}"
    )
    print(
        f"Số câu tóm tắt: "
        f"{num_sentences}"
    )
    print(
        f"MMR lambda: "
        f"{mmr_lambda}"
    )
    print(
        f"Position weight: "
        f"{position_weight}"
    )
    print(
        f"Model: "
        f"{model_path.resolve()}"
    )
    print(
        "Phương pháp: "
        "Sentence Transformer + MMR"
    )

    for index in range(
        start_index,
        end_index,
    ):
        sample = samples[index]

        try:
            article = get_article(sample)

            start_time = time.perf_counter()

            prediction = summarize_mmr(
                text=article,
                model=model,
                num_sentences=num_sentences,
                mmr_lambda=mmr_lambda,
                position_weight=position_weight,
            )

            elapsed_time = (
                time.perf_counter()
                - start_time
            )

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
                f"{type(error).__name__}: "
                f"{error}\n"
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
    print("HOÀN THÀNH MMR")
    print(f"Thành công: {success_count}")
    print(f"Lỗi: {error_count}")
    print(
        f"Tổng thời gian: "
        f"{total_time:.4f} giây"
    )
    print(
        f"Trung bình: "
        f"{average_time:.4f} giây/mẫu"
    )
    print(
        f"Kết quả: "
        f"{output_dir.resolve()}"
    )


if __name__ == "__main__":
    run_mmr_on_vietnews()