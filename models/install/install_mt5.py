import os

from transformers import AutoTokenizer
from transformers import AutoModelForSeq2SeqLM

MODEL_NAME = "mrzaizai2k/vietnamese_mt5_summary_model"
SAVE_DIR = "./models/mT5/mt5-vn-summary"

os.makedirs(SAVE_DIR, exist_ok=True)

print("Đang tải tokenizer...")

tokenizer = AutoTokenizer.from_pretrained(
    MODEL_NAME,
)

print("Đang tải model...")

model = AutoModelForSeq2SeqLM.from_pretrained(
    MODEL_NAME,
)

print("Đang lưu...")

tokenizer.save_pretrained(SAVE_DIR)
model.save_pretrained(SAVE_DIR)

print("Hoàn thành!")