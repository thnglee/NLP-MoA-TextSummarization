import torch
from transformers import AutoModelForCausalLM, AutoModelForSeq2SeqLM, AutoTokenizer

DEVICE = "cuda" if torch.cuda.is_available() else "cpu"

PATHS = {
    "vit5": "./models/vit5/vit5-vn-summary",
    "mt5": "./models/mt5/mt5-vn-summary",
    "qwen": "./models/qwen/Qwen2.5-1.5B-Instruct",
}


def load_model(name):
    path = PATHS[name]
    tokenizer = AutoTokenizer.from_pretrained(path, local_files_only=True)

    model_class = (
        AutoModelForCausalLM
        if name == "qwen"
        else AutoModelForSeq2SeqLM
    )

    model = model_class.from_pretrained(
        path,
        local_files_only=True,
    ).to(DEVICE).eval()

    return tokenizer, model

VIT5_TOKENIZER, VIT5_MODEL = load_model("vit5")
MT5_TOKENIZER, MT5_MODEL = load_model("mt5")
QWEN_TOKENIZER, QWEN_MODEL = load_model("qwen")

def get_summary(TOKENIZER, MODEL, text):
    inputs = TOKENIZER(text, return_tensors="pt", truncation=True, max_length=1024,)
    inputs = {k: v.to(DEVICE) for k, v in inputs.items()}
    with torch.inference_mode():
        outputs = MODEL.generate(**inputs, max_new_tokens=150, num_beams=4,)
    return TOKENIZER.decode(outputs[0], skip_special_tokens=True,)