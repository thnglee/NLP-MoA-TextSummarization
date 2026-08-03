from models.use_models.load_models import get_summary

if __name__ == "__main__":
    get_summary("vit5", "input.txt")
    get_summary("mt5", "input.txt")
    get_summary("qwen", "input.txt")
    get_summary("t5vi", "input.txt")