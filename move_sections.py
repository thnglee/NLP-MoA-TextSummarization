import re

c3_path = 'thesis_vn/chapters/c3/c3_chapter.tex'
app_path = 'thesis_vn/chapters/appendix.tex'

with open(c3_path, 'r', encoding='utf-8') as f:
    c3_content = f.read()

# Find the sections to move
match = re.search(r'(\\section\{Thiết kế cơ sở dữ liệu\}.*?\\end\{figure\}\n)', c3_content, re.DOTALL)
if not match:
    print("Could not find sections in c3_chapter.tex")
    exit(1)

extracted = match.group(1)

# Replace in c3_chapter.tex
replacement = """\\section{Thiết kế cơ sở dữ liệu và Giao diện người dùng}

Các nội dung chi tiết về Thiết kế cơ sở dữ liệu và Giao diện người dùng đã được chuyển sang Phụ lục nhằm tinh gọn chương. Độc giả có thể tham khảo chi tiết về thiết kế cấu trúc các bảng cơ sở dữ liệu tại Phụ lục~D, và các ảnh chụp màn hình minh họa giao diện người dùng thực tế của hệ thống tại Phụ lục~E.
"""
new_c3 = c3_content.replace(extracted, replacement)

with open(c3_path, 'w', encoding='utf-8') as f:
    f.write(new_c3)

# Process extracted content for appendix
extracted = extracted.replace('\\section{Thiết kế cơ sở dữ liệu}', '\\section*{Phụ lục D: Thiết kế cơ sở dữ liệu}')
extracted = extracted.replace('\\section{Giao diện người dùng}', '\\section*{Phụ lục E: Giao diện người dùng}')
extracted = extracted.replace('\\subsection{', '\\subsection*{')

with open(app_path, 'a', encoding='utf-8') as f:
    f.write("\n" + extracted)

print("Moved sections successfully.")
