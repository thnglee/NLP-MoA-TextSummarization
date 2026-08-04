import re
import torch
import json
import time
from pathlib import Path
from transformers import (
    AutoModelForCausalLM,
    AutoModelForSeq2SeqLM,
    AutoTokenizer,
)

DEVICE = "cuda" if torch.cuda.is_available() else "cpu"

PATHS = {
    "vit5": "./models/vit5/vit5-vn-summary",
    "mt5": "./models/mt5/mt5-vn-summary",
    "qwen": "./models/qwen/Qwen2.5-1.5B-Instruct",
    "t5vi": "./models/t5vi/t5-small-vi-summarization",
}

LOADED_MODELS = {}


def normalize_text(text: str) -> str:
    text = text.replace("_", " ")
    text = re.sub(r"\s+", " ", text)
    text = re.sub(r"\s+([.,!?;:])", r"\1", text)
    return text.strip()


def load_model(name: str):
    if name in LOADED_MODELS:
        return LOADED_MODELS[name]

    if name not in PATHS:
        raise ValueError(f"Không hỗ trợ model: {name}")

    path = PATHS[name]

    tokenizer = AutoTokenizer.from_pretrained(
        path,
        local_files_only=True,
        use_fast=False,
    )

    model_class = (
        AutoModelForCausalLM
        if name == "qwen"
        else AutoModelForSeq2SeqLM
    )

    model = model_class.from_pretrained(
        path,
        local_files_only=True,
        torch_dtype="auto" if name == "qwen" else None,
    ).to(DEVICE).eval()

    LOADED_MODELS[name] = (tokenizer, model)
    return tokenizer, model


def save_output(
    model_name: str,
    input_path: str,
    summary: str,
) -> None:
    input_name = Path(input_path).stem

    output_path = (
        Path("output")
        / "summary"
        / model_name
        / f"{input_name}_summary.txt"
    )

    output_path.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    output_path.write_text(
        summary.strip(),
        encoding="utf-8",
    )

    print(f"Đã lưu tại: {output_path}")


def summarize_qwen(
    text: str,
    tokenizer,
    model,
) -> str:
    messages = [
        {
            "role": "system",
            "content": (
                "Bạn là chuyên gia tóm tắt văn bản tiếng Việt. "
                "Chỉ trả về nội dung tóm tắt."
            ),
        },
        {
            "role": "user",
            "content": (
                "Tóm tắt văn bản sau thành một đoạn ngắn, "
                "giữ lại các sự kiện, tên riêng và số liệu quan trọng. "
                "Không thêm thông tin không có trong văn bản. "
                "Không lặp ý.\n\n"
                f"{text}"
            ),
        },
    ]

    prompt = tokenizer.apply_chat_template(
        messages,
        tokenize=False,
        add_generation_prompt=True,
    )

    inputs = tokenizer(
        prompt,
        return_tensors="pt",
        truncation=True,
        max_length=4096,
    ).to(DEVICE)

    input_length = inputs["input_ids"].shape[1]

    with torch.inference_mode():
        outputs = model.generate(
            **inputs,
            max_new_tokens=200,
            do_sample=False,
            repetition_penalty=1.15,
            no_repeat_ngram_size=4,
            pad_token_id=tokenizer.eos_token_id,
        )

    generated_ids = outputs[0][input_length:]

    return tokenizer.decode(
        generated_ids,
        skip_special_tokens=True,
    ).strip()


def summarize_seq2seq(
    name: str,
    text: str,
    tokenizer,
    model,
) -> str:
    # ViT5 được fine-tune với tiền tố vietnews.
    if name == "vit5":
        model_input = f"vietnews: {text} </s>"
    else:
        model_input = text

    inputs = tokenizer(
        model_input,
        return_tensors="pt",
        truncation=True,
        max_length=1024,
    )

    inputs = {
        key: value.to(DEVICE)
        for key, value in inputs.items()
    }

    with torch.inference_mode():
        outputs = model.generate(
            **inputs,
            min_new_tokens=20,
            max_new_tokens=150,
            num_beams=5,
            do_sample=False,
            no_repeat_ngram_size=4,
            repetition_penalty=1.3,
            length_penalty=1.2,
            early_stopping=True,
        )

    return tokenizer.decode(
        outputs[0],
        skip_special_tokens=True,
        clean_up_tokenization_spaces=True,
    ).strip()


def get_summary(
    name: str,
    path_text: str,
) -> str:
    text = Path(path_text).read_text(
        encoding="utf-8",
    )

    text = normalize_text(text)

    if not text:
        raise ValueError("File đầu vào không có nội dung.")

    tokenizer, model = load_model(name)

    if name == "qwen":
        summary = summarize_qwen(
            text,
            tokenizer,
            model,
        )
    else:
        summary = summarize_seq2seq(
            name,
            text,
            tokenizer,
            model,
        )

    save_output(
        model_name=name,
        input_path=path_text,
        summary=summary,
    )

    return summary

def load_json_dataset(dataset_path: str) -> list[dict]:
    """
    Đọc dataset dạng:
    1. JSON array: [{...}, {...}]
    2. JSON object chứa danh sách: {"data": [...]}
    3. JSONL: mỗi dòng là một object JSON
    """
    path = Path(dataset_path)

    if not path.exists():
        raise FileNotFoundError(
            f"Không tìm thấy dataset: {path.resolve()}"
        )

    raw_text = path.read_text(encoding="utf-8").strip()

    if not raw_text:
        raise ValueError("File dataset không có dữ liệu.")

    # Thử đọc như JSON thông thường trước.
    try:
        data = json.loads(raw_text)

        if isinstance(data, list):
            return data

        if isinstance(data, dict):
            # Một số file có dạng {"data": [...]}
            for key in ["data", "rows", "samples", "test"]:
                if key in data and isinstance(data[key], list):
                    return data[key]

            # Trường hợp file chỉ chứa một mẫu.
            if "article" in data or "document" in data:
                return [data]

        raise ValueError(
            "Không tìm thấy danh sách mẫu trong file JSON."
        )

    except json.JSONDecodeError:
        # Nếu không phải JSON array thì thử đọc JSONL.
        samples = []

        for line_number, line in enumerate(
            raw_text.splitlines(),
            start=1,
        ):
            line = line.strip()

            if not line:
                continue

            try:
                samples.append(json.loads(line))
            except json.JSONDecodeError as error:
                raise ValueError(
                    f"JSON không hợp lệ tại dòng {line_number}: {error}"
                ) from error

        return samples


def get_article(sample: dict) -> str:
    """
    Lấy nội dung văn bản từ các tên cột thường gặp.
    """
    for field in ["article", "document", "text", "content"]:
        value = sample.get(field)

        if isinstance(value, str) and value.strip():
            return normalize_text(value)

    raise ValueError(
        "Mẫu không có trường article/document/text/content."
    )


def get_reference_summary(sample: dict) -> str:
    """
    Lấy bản tóm tắt chuẩn nếu dataset có.
    VietNews thường dùng trường abstract.
    """
    for field in ["abstract", "summary", "reference"]:
        value = sample.get(field)

        if isinstance(value, str):
            return normalize_text(value)

    return ""



