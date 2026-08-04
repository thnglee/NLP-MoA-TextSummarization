# from models.use_models.summary_vietnews import run_vit5_on_vietnews_test
from pathlib import Path

from utils.lexrank import run_lexrank_on_vietnews
from utils.textrank import run_textrank_on_vietnews

if __name__ == "__main__":
    # run_vit5_on_vietnews_test(
    #     dataset_path="dataset/vietnews/test.jsonl",
    #     output_dir="output/summary/vit5/vietnews_test", start_index=200, max_samples=300,)

    run_textrank_on_vietnews(
            dataset_path=Path("dataset/vietnews/test.jsonl"),
            output_dir=Path("output/summary/textrank/vietnews_test"), start_index=200, max_samples=1000,)

    run_lexrank_on_vietnews(
                dataset_path=Path("dataset/vietnews/test.jsonl"),
                output_dir=Path("output/summary/lexrank/vietnews_test"), start_index=200, max_samples=1000,)