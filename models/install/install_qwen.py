import os
from pathlib import Path

os.environ["HF_HOME"] = r"D:\huggingface_cache"
os.environ["HF_HUB_CACHE"] = r"D:\huggingface_cache\hub"
os.environ["HF_HUB_DISABLE_SYMLINKS_WARNING"] = "1"

from transformers import AutoModelForCausalLM, AutoTokenizer


MODEL_NAME = "Qwen/Qwen2.5-1.5B-Instruct"

PROJECT_DIR = Path(__file__).resolve().parents[2]

SAVE_DIR = (
    PROJECT_DIR
    / "models"
    / "Qwen"
    / "Qwen2.5-1.5B-Instruct"
)

CACHE_DIR = Path(r"D:\huggingface_cache")

SAVE_DIR.mkdir(parents=True, exist_ok=True)
CACHE_DIR.mkdir(parents=True, exist_ok=True)

print("Thư mục cache:", CACHE_DIR)
print("Thư mục lưu model:", SAVE_DIR)

print("Đang tải tokenizer...")

tokenizer = AutoTokenizer.from_pretrained(
    MODEL_NAME,
    cache_dir=str(CACHE_DIR),
)

print("Đang tải model...")

model = AutoModelForCausalLM.from_pretrained(
    MODEL_NAME,
    cache_dir=str(CACHE_DIR),
    torch_dtype="auto",
)

print("Đang lưu tokenizer và model...")

tokenizer.save_pretrained(SAVE_DIR)

model.save_pretrained(
    SAVE_DIR,
    safe_serialization=True,
)

print("Tải Qwen thành công.")
print("Model được lưu tại:", SAVE_DIR)