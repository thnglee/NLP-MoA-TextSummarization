import json
import math
import re
import time
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import torch
from sentence_transformers import SentenceTransformer
from underthesea import dependency_parse, pos_tag, sent_tokenize


# =============================================================================
# CẤU HÌNH
# =============================================================================

DATASET_PATH = Path("dataset/vietnews/test.jsonl")
MODEL_PATH = Path("models/mmr/paraphrase-multilingual-MiniLM-L12-v2")
OUTPUT_DIR = Path("output/summary/compressive_mmr/vietnews_test")

START_INDEX = 0
MAX_SAMPLES: int | None = 10

# Số mảnh thông tin tối đa trong bản tóm tắt.
MAX_SUMMARY_UNITS = 3

# Tổng số từ tối đa của đầu ra.
MAX_SUMMARY_WORDS = 45

# Độ dài ứng viên trước khi nén.
MIN_CLAUSE_WORDS = 5
MAX_CLAUSE_WORDS = 70

# Độ dài một mảnh sau khi nén.
MIN_COMPRESSED_WORDS = 4
MAX_COMPRESSED_WORDS = 24

# Trọng số chấm điểm ứng viên. Tổng bằng 1.0.
DOCUMENT_WEIGHT = 0.45
TITLE_WEIGHT = 0.25
POSITION_WEIGHT = 0.20
INFORMATION_WEIGHT = 0.10

# MMR cao: ưu tiên độ quan trọng.
# MMR thấp: giảm lặp mạnh hơn.
MMR_LAMBDA = 0.70

# Ngưỡng chặn hai mảnh quá giống nhau.
SEMANTIC_DUPLICATE_THRESHOLD = 0.82
TOKEN_OVERLAP_THRESHOLD = 0.55

ENCODE_BATCH_SIZE = 32
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"


# =============================================================================
# KIỂU DỮ LIỆU
# =============================================================================

@dataclass
class ClauseCandidate:
    text: str
    sentence_index: int
    clause_index: int
    global_position: int


# =============================================================================
# TIỀN XỬ LÝ
# =============================================================================

def normalize_text(text: str) -> str:
    text = str(text).replace("_", " ")
    text = re.sub(r"\s+", " ", text)
    text = re.sub(r"\s+([.,!?;:%])", r"\1", text)
    text = re.sub(r"([(\[{])\s+", r"\1", text)
    text = re.sub(r"\s+([)\]}])", r"\1", text)
    text = re.sub(r'"\s+', '"', text)
    text = re.sub(r'\s+"', '"', text)
    return text.strip()


def tokenize_simple(text: str) -> list[str]:
    return re.findall(r"(?u)\b[\wÀ-ỹ]+\b", text.lower())


def count_words(text: str) -> int:
    return len(tokenize_simple(text))


def split_sentences(text: str) -> list[str]:
    text = normalize_text(text)

    if not text:
        return []

    return [
        normalize_text(sentence)
        for sentence in sent_tokenize(text)
        if isinstance(sentence, str) and sentence.strip()
    ]


CLAUSE_BOUNDARY_PATTERN = re.compile(
    r"""
    \s*(?:;|:|—|–|\.\.\.|…)\s*
    |
    \s*,\s*
    (?=
        nhưng|tuy\s+nhiên|song|còn|đồng\s+thời|trong\s+khi|
        sau\s+khi|trước\s+khi|do\s+đó|vì\s+vậy|nhờ\s+đó|
        khiến|làm|qua\s+đó|từ\s+đó|ngoài\s+ra
    )\s*
    """,
    flags=re.IGNORECASE | re.VERBOSE,
)


def split_into_clauses(sentence: str) -> list[str]:
    """
    Chia câu thành các mệnh đề/mảnh thông tin.

    Không tách mọi dấu phẩy vì dấu phẩy có thể nằm trong:
    - ngày tháng;
    - liệt kê;
    - trạng ngữ ngắn;
    - tên riêng.
    """
    sentence = normalize_text(sentence)

    if not sentence:
        return []

    parts = CLAUSE_BOUNDARY_PATTERN.split(sentence)
    clauses: list[str] = []

    for part in parts:
        part = normalize_text(part).strip(" ,;:—–")

        if count_words(part) >= MIN_CLAUSE_WORDS:
            clauses.append(part)

    # Nếu quy tắc không tách được, dùng cả câu làm ứng viên đầu vào,
    # nhưng bước dependency compression phía sau vẫn không trả nguyên câu dài.
    return clauses if clauses else [sentence]


def has_predicate(text: str) -> bool:
    """
    Giữ mệnh đề có động từ hoặc tính từ vị ngữ.
    """
    try:
        tags = pos_tag(text)
    except Exception:
        return count_words(text) >= MIN_CLAUSE_WORDS

    return any(tag in {"V", "A"} for _, tag in tags)


def looks_like_noise(text: str) -> bool:
    lowered = text.lower().strip()

    if any(
        re.search(pattern, lowered)
        for pattern in (
            r"^(ảnh|hình|video)\s*:",
            r"^(nguồn|tác giả|phóng viên)\s*:",
        )
    ):
        return True

    return count_words(text) < MIN_CLAUSE_WORDS


def build_clause_candidates(text: str) -> list[ClauseCandidate]:
    sentences = split_sentences(text)
    candidates: list[ClauseCandidate] = []
    global_position = 0

    for sentence_index, sentence in enumerate(sentences):
        clauses = split_into_clauses(sentence)

        for clause_index, clause in enumerate(clauses):
            word_count = count_words(clause)

            if (
                MIN_CLAUSE_WORDS <= word_count <= MAX_CLAUSE_WORDS
                and not looks_like_noise(clause)
                and has_predicate(clause)
            ):
                candidates.append(
                    ClauseCandidate(
                        text=clause,
                        sentence_index=sentence_index,
                        clause_index=clause_index,
                        global_position=global_position,
                    )
                )
                global_position += 1

    # Dự phòng nếu POS/chia mệnh đề loại hết dữ liệu.
    if not candidates:
        for sentence_index, sentence in enumerate(sentences):
            candidates.append(
                ClauseCandidate(
                    text=sentence,
                    sentence_index=sentence_index,
                    clause_index=0,
                    global_position=sentence_index,
                )
            )

    return candidates


# =============================================================================
# ĐỌC DỮ LIỆU
# =============================================================================

def load_jsonl_dataset(dataset_path: Path) -> list[dict]:
    if not dataset_path.exists():
        raise FileNotFoundError(
            f"Không tìm thấy dataset: {dataset_path.resolve()}"
        )

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
                raise ValueError(
                    f"Dòng {line_number} không phải JSON object."
                )

            samples.append(sample)

    if not samples:
        raise ValueError("Dataset không có dữ liệu.")

    return samples


def get_article(sample: dict) -> str:
    for field in ("article", "document", "text", "content"):
        value = sample.get(field)

        if isinstance(value, str) and value.strip():
            return normalize_text(value)

    raise ValueError(
        "Mẫu không có trường article/document/text/content."
    )


def get_title(sample: dict) -> str:
    value = sample.get("title", "")
    return normalize_text(value) if isinstance(value, str) else ""


def get_reference_summary(sample: dict) -> str:
    for field in ("abstract", "summary", "reference"):
        value = sample.get(field)

        if isinstance(value, str):
            return normalize_text(value)

    return ""


# =============================================================================
# MODEL EMBEDDING
# =============================================================================

def load_embedding_model(model_path: Path) -> SentenceTransformer:
    if not model_path.exists():
        raise FileNotFoundError(
            f"Không tìm thấy model: {model_path.resolve()}"
        )

    if not (model_path / "modules.json").exists():
        raise FileNotFoundError(
            f"Model thiếu modules.json: {model_path.resolve()}"
        )

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
    print("=" * 80)

    return model


def warm_up_model(model: SentenceTransformer) -> None:
    model.encode(
        ["Khởi động mô hình trích xuất tiếng Việt."],
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


# =============================================================================
# NÉN MỆNH ĐỀ BẰNG DEPENDENCY PARSING
# =============================================================================

# Các quan hệ cần giữ để còn lõi: ai – làm gì – với ai/cái gì.
CORE_RELATIONS = {
    "root",
    "nsubj",
    "csubj",
    "obj",
    "iobj",
    "xcomp",
    "ccomp",
    "cop",
    "aux",
}

# Thành phần mang thông tin thực thể, số lượng, ngày tháng, tên riêng.
DETAIL_RELATIONS = {
    "compound",
    "flat",
    "flat:name",
    "flat:date",
    "name",
    "nummod",
    "clf",
    "appos",
    "det",
}

# Trạng ngữ chỉ giữ có điều kiện.
OPTIONAL_RELATIONS = {
    "obl",
    "obl:tmod",
    "advmod",
    "nmod",
}

NEGATION_WORDS = {
    "không",
    "chưa",
    "chẳng",
    "không thể",
    "chưa từng",
}

FUNCTION_WORDS_TO_TRIM = {
    "và",
    "nhưng",
    "tuy nhiên",
    "ngoài ra",
    "đồng thời",
    "do đó",
    "vì vậy",
    "sau đó",
    "từ đó",
    "còn",
}


def relation_base(relation: str) -> str:
    return relation.split(":", maxsplit=1)[0]


def is_number_or_date(token: str) -> bool:
    return bool(
        re.search(
            r"\d|%|tỷ|triệu|nghìn|năm|tháng|ngày|giờ|tuổi",
            token.lower(),
        )
    )


def build_children(
    dependencies: list[tuple[str, int, str]],
) -> dict[int, list[int]]:
    children: dict[int, list[int]] = {
        index: []
        for index in range(1, len(dependencies) + 1)
    }

    for child_index, (_, head, _) in enumerate(dependencies, start=1):
        if head > 0:
            children.setdefault(head, []).append(child_index)

    return children


def add_descendants(
    index: int,
    children: dict[int, list[int]],
    dependencies: list[tuple[str, int, str]],
    kept: set[int],
    allowed_relations: set[str],
) -> None:
    for child in children.get(index, []):
        relation = dependencies[child - 1][2]
        base = relation_base(relation)

        if relation in allowed_relations or base in allowed_relations:
            kept.add(child)
            add_descendants(
                child,
                children,
                dependencies,
                kept,
                allowed_relations,
            )


def detokenize_dependency_tokens(tokens: list[str]) -> str:
    text = " ".join(tokens)
    text = re.sub(r"\s+([.,!?;:%])", r"\1", text)
    text = re.sub(r"([(\[{])\s+", r"\1", text)
    text = re.sub(r"\s+([)\]}])", r"\1", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def trim_fragment_edges(text: str) -> str:
    text = normalize_text(text).strip(" ,;:—–.")

    lowered = text.lower()

    for connector in sorted(
        FUNCTION_WORDS_TO_TRIM,
        key=len,
        reverse=True,
    ):
        prefix = connector + " "

        if lowered.startswith(prefix):
            text = text[len(prefix):].strip()
            lowered = text.lower()
            break

    if text:
        text = text[0].upper() + text[1:]

    return text


def fallback_pos_compression(text: str) -> str:
    """
    Dự phòng khi dependency parser lỗi.

    Giữ danh từ, tên riêng, số, động từ, tính từ, phủ định và giới từ
    nằm giữa các thành phần nội dung. Đây là dạng trích xuất token,
    không sinh từ mới.
    """
    try:
        tagged = pos_tag(text)
    except Exception:
        words = text.split()
        return " ".join(words[:MAX_COMPRESSED_WORDS])

    content_tags = {
        "N",
        "Np",
        "Ny",
        "Nu",
        "V",
        "A",
        "M",
        "P",
    }

    selected: list[str] = []

    for token, tag in tagged:
        lowered = token.lower()

        if (
            tag in content_tags
            or lowered in NEGATION_WORDS
            or is_number_or_date(token)
        ):
            selected.append(token)

    compressed = detokenize_dependency_tokens(
        selected[:MAX_COMPRESSED_WORDS]
    )

    return trim_fragment_edges(compressed)


def compress_clause_dependency(text: str) -> str:
    """
    Nén một mệnh đề bằng cách giữ các token lõi từ chính mệnh đề gốc.

    Không paraphrase và không sinh từ mới.
    Dấu chấm cuối chỉ được thêm để ghép các mảnh cho dễ đọc.
    """
    text = normalize_text(text)

    try:
        dependencies = dependency_parse(text)
    except Exception:
        return fallback_pos_compression(text)

    if not dependencies:
        return fallback_pos_compression(text)

    roots = [
        index
        for index, (_, head, relation) in enumerate(
            dependencies,
            start=1,
        )
        if head == 0 or relation == "root"
    ]

    if not roots:
        return fallback_pos_compression(text)

    root = roots[0]
    children = build_children(dependencies)
    kept: set[int] = {root}

    # Giữ các thành phần cú pháp cốt lõi.
    for index, (token, _, relation) in enumerate(
        dependencies,
        start=1,
    ):
        base = relation_base(relation)

        if relation in CORE_RELATIONS or base in CORE_RELATIONS:
            kept.add(index)

    # Mở rộng các cụm danh từ/tên riêng/số liệu quanh phần lõi.
    initial_kept = list(kept)

    for index in initial_kept:
        add_descendants(
            index=index,
            children=children,
            dependencies=dependencies,
            kept=kept,
            allowed_relations=DETAIL_RELATIONS,
        )

    # Giữ phủ định, số liệu và một số trạng ngữ ngắn giàu thông tin.
    for index, (token, head, relation) in enumerate(
        dependencies,
        start=1,
    ):
        base = relation_base(relation)
        lowered = token.lower()

        if lowered in NEGATION_WORDS or is_number_or_date(token):
            kept.add(index)

            if head > 0:
                kept.add(head)

        elif (
            relation in OPTIONAL_RELATIONS
            or base in OPTIONAL_RELATIONS
        ):
            subtree_indices = {index}
            add_descendants(
                index=index,
                children=children,
                dependencies=dependencies,
                kept=subtree_indices,
                allowed_relations=DETAIL_RELATIONS,
            )

            subtree_tokens = [
                dependencies[item - 1][0]
                for item in sorted(subtree_indices)
            ]

            # Chỉ giữ trạng ngữ ngắn hoặc có ngày/số/thực thể rõ ràng.
            if (
                len(subtree_tokens) <= 5
                or any(is_number_or_date(token) for token in subtree_tokens)
            ):
                kept.update(subtree_indices)

    # Giữ dấu phẩy nằm giữa hai token được giữ để câu dễ đọc.
    for index, (token, _, relation) in enumerate(
        dependencies,
        start=1,
    ):
        if relation == "punct" and token in {",", "-", "–"}:
            if index - 1 in kept and index + 1 in kept:
                kept.add(index)

    selected_indices = sorted(kept)

    # Nếu kết quả quá dài, bỏ dần thành phần tùy chọn trước.
    if len(selected_indices) > MAX_COMPRESSED_WORDS:
        mandatory = []

        for index in selected_indices:
            token, _, relation = dependencies[index - 1]
            base = relation_base(relation)

            if (
                relation in CORE_RELATIONS
                or base in CORE_RELATIONS
                or relation in DETAIL_RELATIONS
                or base in DETAIL_RELATIONS
                or token.lower() in NEGATION_WORDS
                or is_number_or_date(token)
            ):
                mandatory.append(index)

        selected_indices = mandatory[:MAX_COMPRESSED_WORDS]

    selected_tokens = [
        dependencies[index - 1][0]
        for index in selected_indices
    ]

    compressed = detokenize_dependency_tokens(selected_tokens)
    compressed = trim_fragment_edges(compressed)

    # Parser có thể giữ quá ít token; dùng POS fallback khi đó.
    if count_words(compressed) < MIN_COMPRESSED_WORDS:
        compressed = fallback_pos_compression(text)

    return compressed


# =============================================================================
# CHẤM ĐIỂM VÀ MMR
# =============================================================================

def calculate_position_scores(
    candidates: list[ClauseCandidate],
) -> np.ndarray:
    maximum_position = max(
        (candidate.global_position for candidate in candidates),
        default=0,
    )

    decay = max(3.0, (maximum_position + 1) / 3.0)

    values = np.array(
        [
            math.exp(-candidate.global_position / decay)
            for candidate in candidates
        ],
        dtype=np.float32,
    )

    return min_max_normalize(values)


def calculate_information_scores(texts: list[str]) -> np.ndarray:
    """
    Ưu tiên mệnh đề có tên riêng, động từ và số liệu.
    """
    values: list[float] = []

    for text in texts:
        score = 0.0

        try:
            tags = pos_tag(text)
        except Exception:
            tags = []

        score += sum(
            1.0
            for token, tag in tags
            if tag in {"Np", "V", "M"}
            or is_number_or_date(token)
        )

        values.append(score)

    return min_max_normalize(
        np.asarray(values, dtype=np.float32)
    )


def token_overlap_ratio(first: str, second: str) -> float:
    first_tokens = set(tokenize_simple(first))
    second_tokens = set(tokenize_simple(second))

    if not first_tokens or not second_tokens:
        return 0.0

    return len(first_tokens & second_tokens) / min(
        len(first_tokens),
        len(second_tokens),
    )


def select_units_with_mmr(
    candidate_texts: list[str],
    compressed_texts: list[str],
    relevance_scores: np.ndarray,
    similarity_matrix: np.ndarray,
    max_units: int,
    max_words: int,
    mmr_lambda: float,
) -> list[int]:
    selected: list[int] = []
    candidates = set(range(len(candidate_texts)))
    current_words = 0

    while candidates and len(selected) < max_units:
        best_index: int | None = None
        best_score = float("-inf")

        for index in sorted(candidates):
            compressed = compressed_texts[index]
            compressed_words = count_words(compressed)

            if compressed_words < MIN_COMPRESSED_WORDS:
                continue

            if (
                selected
                and current_words + compressed_words > max_words
            ):
                continue

            if any(
                float(similarity_matrix[index, old_index])
                >= SEMANTIC_DUPLICATE_THRESHOLD
                or token_overlap_ratio(
                    compressed,
                    compressed_texts[old_index],
                ) >= TOKEN_OVERLAP_THRESHOLD
                for old_index in selected
            ):
                continue

            redundancy = (
                max(
                    float(similarity_matrix[index, old_index])
                    for old_index in selected
                )
                if selected
                else 0.0
            )

            score = (
                mmr_lambda * float(relevance_scores[index])
                - (1.0 - mmr_lambda) * redundancy
            )

            if score > best_score:
                best_score = score
                best_index = index

        if best_index is None:
            break

        selected.append(best_index)
        candidates.remove(best_index)
        current_words += count_words(
            compressed_texts[best_index]
        )

    if not selected and compressed_texts:
        selected = [int(np.argmax(relevance_scores))]

    return selected


def summarize_compressive_extractive(
    text: str,
    title: str,
    model: SentenceTransformer,
    max_units: int = MAX_SUMMARY_UNITS,
    max_words: int = MAX_SUMMARY_WORDS,
    mmr_lambda: float = MMR_LAMBDA,
) -> str:
    """
    Compressive extractive summarization:

    1. Tách câu.
    2. Chia câu thành mệnh đề.
    3. SBERT chấm độ liên quan của từng mệnh đề.
    4. Dependency parser giữ lõi chủ thể–hành động–đối tượng.
    5. MMR chọn các mảnh ít trùng lặp.
    6. Ghép các mảnh theo thứ tự văn bản gốc.

    Không trả lại nguyên cả câu dài và không dùng model sinh văn bản.
    """
    candidates = build_clause_candidates(text)

    if not candidates:
        return ""

    candidate_texts = [
        candidate.text
        for candidate in candidates
    ]

    compressed_texts = [
        compress_clause_dependency(candidate.text)
        for candidate in candidates
    ]

    title = normalize_text(title)
    texts_to_encode = candidate_texts + ([title] if title else [])

    embeddings = model.encode(
        texts_to_encode,
        batch_size=ENCODE_BATCH_SIZE,
        show_progress_bar=False,
        convert_to_numpy=True,
        normalize_embeddings=True,
    )

    embeddings = np.asarray(
        embeddings,
        dtype=np.float32,
    )

    candidate_embeddings = embeddings[:len(candidate_texts)]

    document_embedding = candidate_embeddings.mean(axis=0)
    document_norm = float(np.linalg.norm(document_embedding))

    if document_norm > 1e-12:
        document_embedding /= document_norm

    document_scores = min_max_normalize(
        candidate_embeddings @ document_embedding
    )

    if title:
        title_scores = min_max_normalize(
            candidate_embeddings @ embeddings[-1]
        )
    else:
        title_scores = np.zeros(
            len(candidate_texts),
            dtype=np.float32,
        )

    position_scores = calculate_position_scores(candidates)
    information_scores = calculate_information_scores(
        candidate_texts
    )

    relevance_scores = (
        DOCUMENT_WEIGHT * document_scores
        + TITLE_WEIGHT * title_scores
        + POSITION_WEIGHT * position_scores
        + INFORMATION_WEIGHT * information_scores
    )

    similarity_matrix = (
        candidate_embeddings @ candidate_embeddings.T
    )

    np.fill_diagonal(similarity_matrix, 0.0)

    selected_indices = select_units_with_mmr(
        candidate_texts=candidate_texts,
        compressed_texts=compressed_texts,
        relevance_scores=relevance_scores,
        similarity_matrix=similarity_matrix,
        max_units=min(max_units, len(candidates)),
        max_words=max_words,
        mmr_lambda=mmr_lambda,
    )

    # Sắp theo vị trí ban đầu để bản tóm tắt có trình tự.
    selected_indices = sorted(
        selected_indices,
        key=lambda index: (
            candidates[index].sentence_index,
            candidates[index].clause_index,
        ),
    )

    fragments: list[str] = []

    for index in selected_indices:
        fragment = trim_fragment_edges(
            compressed_texts[index]
        )

        if not fragment:
            continue

        if fragment[-1] not in ".!?":
            fragment += "."

        fragments.append(fragment)

    return " ".join(fragments)


# =============================================================================
# LƯU KẾT QUẢ
# =============================================================================

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

    content = (
        f"INDEX:\n"
        f"{sample_index}\n"
        f"GUID:\n"
        f"{guid}\n"
        f"TITLE:\n"
        f"{get_title(sample)}\n"
        f"VĂN BẢN GỐC:\n"
        f"{get_article(sample)}\n"
        f"TÓM TẮT THAM CHIẾU:\n"
        f"{get_reference_summary(sample)}\n"
        f"TÓM TẮT COMPRESSIVE EXTRACTIVE:\n"
        f"{prediction}\n"
        f"THỜI GIAN TÓM TẮT:\n"
        f"{elapsed_time:.4f} giây\n"
    )

    output_path.write_text(
        content,
        encoding="utf-8",
    )

    return output_path


# =============================================================================
# CHẠY DATASET
# =============================================================================

def run_compressive_extractive_on_vietnews(
    dataset_path: Path = DATASET_PATH,
    model_path: Path = MODEL_PATH,
    output_dir: Path = OUTPUT_DIR,
    start_index: int = START_INDEX,
    max_samples: int | None = MAX_SAMPLES,
) -> None:
    dataset_path = Path(dataset_path)
    model_path = Path(model_path)
    output_dir = Path(output_dir)

    samples = load_jsonl_dataset(dataset_path)

    if not 0 <= start_index < len(samples):
        raise ValueError(
            f"start_index phải nằm trong khoảng "
            f"0 đến {len(samples) - 1}."
        )

    if max_samples is not None and max_samples <= 0:
        raise ValueError(
            "max_samples phải lớn hơn 0 hoặc bằng None."
        )

    end_index = (
        len(samples)
        if max_samples is None
        else min(start_index + max_samples, len(samples))
    )

    output_dir.mkdir(
        parents=True,
        exist_ok=True,
    )

    error_log_path = output_dir / "errors.txt"

    if error_log_path.exists():
        error_log_path.unlink()

    model = load_embedding_model(model_path)
    warm_up_model(model)

    print(f"Tổng số mẫu: {len(samples)}")
    print(
        f"Phạm vi chạy: "
        f"{start_index} đến {end_index - 1}"
    )
    print(f"Tối đa mảnh thông tin: {MAX_SUMMARY_UNITS}")
    print(f"Tối đa số từ: {MAX_SUMMARY_WORDS}")
    print(f"MMR lambda: {MMR_LAMBDA}")
    print(
        "Phương pháp: "
        "Clause-level Compressive Extractive "
        "+ Dependency Parsing + SBERT + MMR"
    )
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

            prediction = summarize_compressive_extractive(
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

            with error_log_path.open(
                "a",
                encoding="utf-8",
            ) as file:
                file.write(
                    f"Index {index}: "
                    f"{type(error).__name__}: "
                    f"{error}\n"
                )

            print(
                f"[{index + 1}/{end_index}] "
                f"Lỗi: {error}"
            )

    average_time = (
        total_time / success_count
        if success_count
        else 0.0
    )

    print("\n" + "=" * 80)
    print("HOÀN THÀNH COMPRESSIVE EXTRACTIVE")
    print(f"Thành công: {success_count}")
    print(f"Lỗi: {error_count}")
    print(f"Tổng thời gian: {total_time:.4f} giây")
    print(f"Trung bình: {average_time:.4f} giây/mẫu")
    print(f"Kết quả: {output_dir.resolve()}")


if __name__ == "__main__":
    run_compressive_extractive_on_vietnews()