import os

from transformers import AutoTokenizer
from transformers import AutoModelForSeq2SeqLM

MODEL_NAME = "VietAI/vit5-large-vietnews-summarization"
SAVE_DIR = "./models/ViT5/vit5-vn-summary"

os.makedirs(SAVE_DIR, exist_ok=True)

print("Đang tải tokenizer...")

tokenizer = AutoTokenizer.from_pretrained(
    MODEL_NAME,
    use_fast=False,
)

print("Đang tải model...")

model = AutoModelForSeq2SeqLM.from_pretrained(
    MODEL_NAME,
)

print("Đang lưu...")

tokenizer.save_pretrained(SAVE_DIR)
model.save_pretrained(SAVE_DIR)

print("Hoàn thành!")