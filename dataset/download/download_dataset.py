from datasets import load_dataset
from pathlib import Path

dataset = load_dataset(
    "LakoreAI/vietnamese-summarization-dataset-0001"
)

output_dir = Path(
    "datasets/vietnamese-summarization-dataset-0001"
)
output_dir.mkdir(
    parents=True,
    exist_ok=True,
)

for split in dataset.keys():
    output_path = output_dir / f"{split}.jsonl"

    dataset[split].to_json(
        output_path,
        force_ascii=False,
    )

    print(f"Đã lưu {split}: {output_path}")
