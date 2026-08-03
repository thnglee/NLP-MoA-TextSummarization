from models.use_models.load_models import *
from datasets import load_dataset

if __name__ == "__main__":
    run_vit5_on_vietnews_test(
        dataset_path="datasets/vietnews/test.jsonl",
        output_dir="output/summary/vit5/vietnews_test",

        # Chạy từ mẫu đầu tiên.
        start_index=0,

        # None: chạy toàn bộ.
        # Đổi thành 10 để thử trước 10 mẫu.
        max_samples=200,
    )