from pathlib import Path

from sentence_transformers import SentenceTransformer


MODEL_ID = (
    "sentence-transformers/"
    "paraphrase-multilingual-MiniLM-L12-v2"
)

OUTPUT_DIR = Path(
    "models/mmr/paraphrase-multilingual-MiniLM-L12-v2"
)


def download_model() -> None:
    OUTPUT_DIR.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    print(f"Đang tải model: {MODEL_ID}")
    print(f"Thư mục lưu: {OUTPUT_DIR.resolve()}")

    model = SentenceTransformer(MODEL_ID)

    model.save_pretrained(
        str(OUTPUT_DIR)
    )

    print("\nTải model thành công.")
    print(f"Model đã được lưu tại: {OUTPUT_DIR.resolve()}")


if __name__ == "__main__":
    download_model()