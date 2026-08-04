from models.use_models.load_models import *

def save_test_result(
    output_dir: Path,
    sample_index: int,
    sample: dict,
    prediction: str,
    elapsed_time: float,
) -> Path:
    """
    Lưu một kết quả test thành một file TXT riêng.
    """
    guid = sample.get("guid", sample_index)

    # Loại bỏ ký tự không hợp lệ trong tên file.
    safe_guid = re.sub(
        r'[<>:"/\\|?*]',
        "_",
        str(guid),
    )

    output_path = output_dir / (
        f"{sample_index:05d}_{safe_guid}.txt"
    )

    title = normalize_text(str(sample.get("title", "")))
    article = get_article(sample)
    reference = get_reference_summary(sample)

    content = (
        f"INDEX:\n"
        f"{sample_index}\n"
        f"GUID:\n"
        f"{guid}\n"
        f"TITLE:\n"
        f"{title}\n"
        f"VĂN BẢN GỐC:\n"
        f"{article}\n"
        f"TÓM TẮT THAM CHIẾU:\n"
        f"{reference}\n"
        f"TÓM TẮT DO VIT5 SINH:\n"
        f"{prediction}\n"
        f"THỜI GIAN TÓM TẮT:\n"
        f"{elapsed_time:.4f} giây\n"
    )

    output_path.write_text(
        content,
        encoding="utf-8",
    )

    return output_path

def run_vit5_on_vietnews_test(
    dataset_path: str = "dataset/vietnews/test.jsonl",
    output_dir: str = "output/summary/vit5/vietnews_test",
    start_index: int = 0,
    max_samples: int | None = None,
) -> None:
    """
    Chạy ViT5 trên tập test VietNews.

    start_index:
        Vị trí bắt đầu. Có thể dùng để chạy tiếp khi chương trình bị dừng.

    max_samples:
        Số mẫu tối đa cần chạy.
        None nghĩa là chạy đến hết dataset.
    """
    samples = load_json_dataset(dataset_path)

    if start_index < 0 or start_index >= len(samples):
        raise ValueError(
            f"start_index phải nằm trong khoảng "
            f"0 đến {len(samples) - 1}."
        )

    end_index = len(samples)

    if max_samples is not None:
        end_index = min(
            start_index + max_samples,
            len(samples),
        )

    output_path = Path(output_dir)
    output_path.mkdir(
        parents=True,
        exist_ok=True,
    )

    print(f"Thiết bị: {DEVICE}")
    print(f"Tổng số mẫu trong dataset: {len(samples)}")
    print(
        f"Phạm vi chạy: {start_index} đến {end_index - 1}"
    )

    # Chỉ load ViT5 một lần.
    print("Đang load ViT5...")
    tokenizer, model = load_model("vit5")
    print("Đã load ViT5 thành công.")

    success_count = 0
    error_count = 0

    error_log_path = output_path / "errors.txt"

    for index in range(start_index, end_index):
        sample = samples[index]

        try:
            article = get_article(sample)

            # Đợi các tác vụ CUDA trước đó hoàn thành.
            if DEVICE == "cuda":
                torch.cuda.synchronize()

            start_time = time.perf_counter()

            prediction = summarize_seq2seq(
                name="vit5",
                text=article,
                tokenizer=tokenizer,
                model=model,
            )

            # Chờ GPU hoàn thành việc sinh văn bản trước khi đo.
            if DEVICE == "cuda":
                torch.cuda.synchronize()

            elapsed_time = time.perf_counter() - start_time

            saved_path = save_test_result(
                output_dir=output_path,
                sample_index=index,
                sample=sample,
                prediction=prediction,
                elapsed_time=elapsed_time,
            )

            success_count += 1

            print(
                f"[{index + 1}/{end_index}] "
                f"Đã lưu: {saved_path}"
            )

        except Exception as error:
            error_count += 1

            error_message = (
                f"Index {index}: "
                f"{type(error).__name__}: {error}\n"
            )

            with error_log_path.open(
                "a",
                encoding="utf-8",
            ) as file:
                file.write(error_message)

            print(
                f"[{index + 1}/{end_index}] "
                f"Lỗi: {error}"
            )

        # Giải phóng bớt cache GPU sau mỗi mẫu.
        if DEVICE == "cuda":
            torch.cuda.empty_cache()

    print("\n" + "=" * 80)
    print("HOÀN THÀNH")
    print(f"Thành công: {success_count}")
    print(f"Lỗi: {error_count}")
    print(f"Thư mục kết quả: {output_path.resolve()}")