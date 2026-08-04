# Mô hình tóm tắt văn bản

## Một số thư mục làm việc của mô hình

    dataset/        Nơi lưu các tập dữ liệu
    models/         Nơi chứa các mô hình, cách tải chúng, cách dùng chúng
    output/         Đầu ra của các mô hình sau hi tóm tắt
    utils/          Tiện ích, lưu hoạt động của textrank và lexrank

## Các mô hình (models/) và thuật toán được sử dụng (utils/)

    Các mô hình: Trong folder models:
        ViT5
        mT5
        Qwen
        t5vi

    Thuật toán: Trong folder utils:
        Sinh extract gồm:
            TextRank
            Lexrank

## Tập dữ liệu (dataset/)

    - ViMs
    - Vietnamese MDS
    - Vietnews
    - vietnamese-summarization-dataset-0001

## Đầu ra (output/)

    - Đầu ra tóm tắt: (summary/)
    - Đầu ra đánh giá:
