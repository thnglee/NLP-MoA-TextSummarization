import re

c3_path = 'thesis_vn/chapters/c3/c3_chapter.tex'

with open(c3_path, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Remove 3.2.1, 3.2.2, 3.2.3 (from \subsection{Tiện ích mở rộng trình duyệt} up to just before \section{Module tóm tắt văn bản})
content = re.sub(r'\\subsection\{Tiện ích mở rộng trình duyệt\}.*?(?=\\section\{Module tóm tắt văn bản\})', '', content, flags=re.DOTALL)

# 2. Remove 3.5 Module kiểm chứng tin tức (from \section{Module kiểm chứng tin tức} up to just before \section{Khung đánh giá ba trục})
# Wait, Khung đánh giá ba trục could be matched. Let's make sure.
content = re.sub(r'\\section\{Module kiểm chứng tin tức\}.*?(?=\\section\{Khung đánh giá ba trục\})', '', content, flags=re.DOTALL)

# Since I removed these, I might have multiple blank lines. I will clean up multiple empty lines into a single blank line.
content = re.sub(r'\n{3,}', '\n\n', content)

with open(c3_path, 'w', encoding='utf-8') as f:
    f.write(content)

print("Removed sections successfully.")
