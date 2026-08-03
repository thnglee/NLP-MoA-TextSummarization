import torch
from load_models import VIT5_TOKENIZER, VIT5_MODEL, MT5_TOKENIZER, MT5_MODEL, QWEN_TOKENIZER, QWEN_MODEL, get_summary

text = "Trí tuệ nhân tạo đang được ứng dụng rộng rãi..."

TOKENIZER = MT5_TOKENIZER
MODEL = MT5_MODEL

print(get_summary(TOKENIZER, MODEL, text))