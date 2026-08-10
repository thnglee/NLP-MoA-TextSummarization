import json
import re
import time
from pathlib import Path

import torch
from tqdm.auto import tqdm
from transformers import AutoModelForSeq2SeqLM, AutoTokenizer


# ============================================================
# 1. ĐƯỜNG DẪN
# ============================================================

PROJECT_ROOT = Path.cwd().resolve()

MODEL_ID = "thnhan3/sft_model"

MODEL_DIR = (
    PROJECT_ROOT
    / "models"
    / "sft_model"
)

TEST_FILE = (
    PROJECT_ROOT
    / "datasets"
    / "vietnamese-summarization-dataset-0001"
    / "test.jsonl"
)

OUTPUT_DIR = (
    PROJECT_ROOT
    / "results"
    / "sft_model"
)

OUTPUT_DIR.mkdir(
    parents=True,
    exist_ok=True,
)

assert TEST_FILE.exists(), (
    f"Không tìm thấy test.jsonl tại: {TEST_FILE}"
)


# ============================================================
# 2. DEVICE
# ============================================================

device = torch.device(
    "cuda"
    if torch.cuda.is_available()
    else "cpu"
)

print("Device:", device)

if torch.cuda.is_available():
    print(
        "GPU:",
        torch.cuda.get_device_name(0),
    )


# ============================================================
# 3. LOAD TOKENIZER + MODEL
# ============================================================

HAS_LOCAL_MODEL = (
    MODEL_DIR.exists()
    and (MODEL_DIR / "config.json").exists()
)

if HAS_LOCAL_MODEL:

    print("Sử dụng model local:", MODEL_DIR)

    tokenizer = AutoTokenizer.from_pretrained(
        str(MODEL_DIR),
        use_fast=False,
        local_files_only=True,
    )

    model = AutoModelForSeq2SeqLM.from_pretrained(
        str(MODEL_DIR),
        local_files_only=True,
    )

else:

    print(
        "Không tìm thấy model local hoàn chỉnh."
        "\nĐang tải từ Hugging Face:",
        MODEL_ID,
    )

    tokenizer = AutoTokenizer.from_pretrained(
        MODEL_ID,
        use_fast=False,
    )

    model = AutoModelForSeq2SeqLM.from_pretrained(
        MODEL_ID,
    )

    MODEL_DIR.mkdir(
        parents=True,
        exist_ok=True,
    )

    tokenizer.save_pretrained(MODEL_DIR)
    model.save_pretrained(MODEL_DIR)

    print(
        "Đã lưu model tại:",
        MODEL_DIR,
    )


model.to(device)
model.eval()

print("Model:", MODEL_DIR)


# ============================================================
# 4. THAM SỐ GENERATE
# ============================================================

# Dùng 1024 nếu model cho phép.
# Nếu muốn benchmark đúng theo cách model card sft sử dụng,
# có thể chỉnh lại theo cấu hình gốc của model.
MAX_INPUT_LENGTH = 1024

MAX_NEW_TOKENS = 256
MIN_NEW_TOKENS = 30

NUM_BEAMS = 4

LENGTH_PENALTY = 1.0
REPETITION_PENALTY = 1.1
NO_REPEAT_NGRAM_SIZE = 3


# ============================================================
# 5. CẤU HÌNH TEST
# ============================================================

# True:
# nếu file kết quả đã tồn tại thì bỏ qua
# → có thể resume khi dừng giữa chừng.
SKIP_EXISTING = True

# None = chạy toàn bộ 1953 mẫu.
# Ví dụ 20 = chỉ test 20 mẫu đầu.
MAX_SAMPLES = 300


# ============================================================
# 6. HÀM CHUẨN HÓA TEXT
# ============================================================

def normalize_text(value) -> str:
    if value is None:
        return ""

    if isinstance(value, list):
        value = " ".join(
            str(item)
            for item in value
        )

    return " ".join(
        str(value)
        .replace("\r\n", "\n")
        .replace("\r", "\n")
        .split()
    ).strip()


# ============================================================
# 7. HÀM TẠO TÊN FILE AN TOÀN
# ============================================================

def safe_filename(
    value: str,
    max_length: int = 70,
) -> str:

    value = normalize_text(value)

    value = re.sub(
        r'[<>:"/\\|?*]',
        "_",
        value,
    )

    value = re.sub(
        r"\s+",
        "_",
        value,
    )

    value = value.strip("._ ")

    if not value:
        return "untitled"

    return value[:max_length]


# ============================================================
# 8. LOAD JSONL
# ============================================================

def load_jsonl(
    path: Path,
) -> list[dict]:

    records = []

    with path.open(
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
                records.append(
                    json.loads(line)
                )

            except json.JSONDecodeError as error:
                print(
                    f"Bỏ qua dòng {line_number}:",
                    error,
                )

    return records


# ============================================================
# 9. HÀM TÓM TẮT BẰNG sft_model
# ============================================================

@torch.inference_mode()
def summarize_sft_model(
    article: str,
) -> str:

    article = normalize_text(article)

    if not article:
        return ""

    inputs = tokenizer(
        article,
        return_tensors="pt",
        truncation=True,
        max_length=MAX_INPUT_LENGTH,
        padding=False,
    )

    inputs = {
        key: value.to(device)
        for key, value in inputs.items()
    }

    output_ids = model.generate(
        **inputs,

        max_new_tokens=MAX_NEW_TOKENS,
        min_new_tokens=MIN_NEW_TOKENS,

        num_beams=NUM_BEAMS,
        do_sample=False,

        early_stopping=True,

        length_penalty=LENGTH_PENALTY,
        repetition_penalty=REPETITION_PENALTY,
        no_repeat_ngram_size=NO_REPEAT_NGRAM_SIZE,
    )

    summary = tokenizer.decode(
        output_ids[0],
        skip_special_tokens=True,
        clean_up_tokenization_spaces=True,
    )

    return normalize_text(summary)


# ============================================================
# 10. LƯU KẾT QUẢ MỖI BÀI NGAY LẬP TỨC
# ============================================================

def save_result_txt(
    output_path: Path,
    index: int,
    guid: str,
    title: str,
    article: str,
    reference: str,
    generated: str,
    elapsed_seconds: float,
):

    content = (
        "INDEX:\n"
        f"{index}\n"

        "GUID:\n"
        f"{guid}\n"

        "TITLE:\n"
        f"{title}\n"

        "VĂN BẢN GỐC:\n"
        f"{article}\n"

        "TÓM TẮT THAM CHIẾU:\n"
        f"{reference}\n"

        "TÓM TẮT DO MODEL SINH:\n"
        f"{generated}\n"

        "THỜI GIAN TÓM TẮT:\n"
        f"{elapsed_seconds:.4f} giây\n"
    )

    # Ghi file tạm trước
    # để tránh file hỏng nếu chương trình bị dừng.
    temporary_path = (
        output_path.with_suffix(".tmp")
    )

    with temporary_path.open(
        "w",
        encoding="utf-8",
    ) as file:

        file.write(content)
        file.flush()

    temporary_path.replace(
        output_path
    )


# ============================================================
# 11. LOAD TEST SET
# ============================================================

records = load_jsonl(
    TEST_FILE
)

if MAX_SAMPLES is not None:
    records = records[:MAX_SAMPLES]

print(
    "Số mẫu cần test:",
    len(records),
)


# ============================================================
# 12. CHẠY TEST TOÀN BỘ
# ============================================================

success_count = 0
skip_count = 0
error_count = 0


for index, record in enumerate(
    tqdm(
        records,
        desc="sft_model test",
    )
):

    # --------------------------------------------------------
    # Đọc thông tin
    # --------------------------------------------------------

    guid = normalize_text(
        record.get(
            "guid",
            record.get(
                "id",
                index,
            ),
        )
    )

    title = normalize_text(
        record.get(
            "title",
            "",
        )
    )

    article = normalize_text(
        record.get(
            "document",
            record.get(
                "text",
                "",
            ),
        )
    )

    reference = normalize_text(
        record.get(
            "summary",
            "",
        )
    )

    # --------------------------------------------------------
    # Tạo tên file
    # --------------------------------------------------------

    output_path = (
        OUTPUT_DIR
        / (
            f"{index:05d}"
            f"_guid-{safe_filename(guid, 25)}"
            f"_{safe_filename(title)}"
            ".txt"
        )
    )

    # --------------------------------------------------------
    # Resume
    # --------------------------------------------------------

    if (
        SKIP_EXISTING
        and output_path.exists()
    ):
        skip_count += 1
        continue

    # --------------------------------------------------------
    # Tóm tắt
    # --------------------------------------------------------

    try:

        if torch.cuda.is_available():
            torch.cuda.synchronize()

        started_at = time.perf_counter()

        generated = summarize_sft_model(
            article
        )

        if torch.cuda.is_available():
            torch.cuda.synchronize()

        elapsed_seconds = (
            time.perf_counter()
            - started_at
        )

        # ----------------------------------------------------
        # Lưu ngay
        # ----------------------------------------------------

        save_result_txt(
            output_path=output_path,
            index=index,
            guid=guid,
            title=title,
            article=article,
            reference=reference,
            generated=generated,
            elapsed_seconds=elapsed_seconds,
        )

        success_count += 1

    except Exception as error:

        error_count += 1

        print(
            f"\nLỗi tại index {index}:",
            repr(error),
        )

        if torch.cuda.is_available():
            torch.cuda.empty_cache()


# ============================================================
# 13. THỐNG KÊ
# ============================================================

print("\n" + "=" * 80)

print("HOÀN TẤT TEST sft_model")

print("=" * 80)

print(
    "Thành công :",
    success_count,
)

print(
    "Bỏ qua     :",
    skip_count,
)

print(
    "Lỗi        :",
    error_count,
)

print(
    "Kết quả tại:",
    OUTPUT_DIR,
)