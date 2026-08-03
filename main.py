from models.use_models.load_models import get_summary

if __name__ == "__main__":
    for model_name in ["vit5", "mt5", "qwen", "t5vi"]:
        for i in range(1, 3):
            get_summary(model_name, f"input{i}.txt")