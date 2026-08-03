import os
from pathlib import Path

os.environ["HF_HOME"] = r"D:\huggingface_cache"
os.environ["HF_HUB_DISABLE_SYMLINKS_WARNING"] = "1"

from transformers import AutoModelForSeq2SeqLM, AutoTokenizer

MODEL_NAME = "NlpHUST/t5-small-vi-summarization"
SAVE_DIR = Path("./models/t5vi/t5-small-vi-summarization")
CACHE_DIR = Path(r"D:\huggingface_cache")

SAVE_DIR.mkdir(parents=True, exist_ok=True)
CACHE_DIR.mkdir(parents=True, exist_ok=True)

print("Đang tải tokenizer...")

tokenizer = AutoTokenizer.from_pretrained(
    MODEL_NAME,
    use_fast=False,
    cache_dir=str(CACHE_DIR),
)

print("Đang tải model...")

model = AutoModelForSeq2SeqLM.from_pretrained(
    MODEL_NAME,
    cache_dir=str(CACHE_DIR),
)

print("Đang lưu model...")

tokenizer.save_pretrained(SAVE_DIR)
model.save_pretrained(SAVE_DIR)

print("Hoàn thành:", SAVE_DIR)