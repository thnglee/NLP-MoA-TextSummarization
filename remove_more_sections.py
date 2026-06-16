import re

c3_path = 'thesis_vn/chapters/c3/c3_chapter.tex'
app_path = 'thesis_vn/chapters/appendix.tex'

with open(c3_path, 'r', encoding='utf-8') as f:
    c3_content = f.read()

# 1. Remove 3.3.2 and 3.3.3 (from \subsection{Trừu tượng hóa đa nhà cung cấp LLM} up to \section{Pipeline dung hợp đa tác nhân (MoA)})
c3_content = re.sub(r'\\subsection\{Trừu tượng hóa đa nhà cung cấp LLM\}.*?(?=\\section\{Pipeline dung hợp đa tác nhân \(MoA\)\})', '', c3_content, flags=re.DOTALL)

# 2. Remove 3.6 Giao diện người dùng (from \section{Giao diện người dùng} up to \section{Tổng kết chương})
c3_content = re.sub(r'\\section\{Giao diện người dùng\}.*?(?=\\section\{Tổng kết chương\})', '', c3_content, flags=re.DOTALL)

# Cleanup multiple blank lines
c3_content = re.sub(r'\n{3,}', '\n\n', c3_content)

with open(c3_path, 'w', encoding='utf-8') as f:
    f.write(c3_content)

# 3. Remove Phụ lục D from appendix
with open(app_path, 'r', encoding='utf-8') as f:
    app_content = f.read()

app_content = re.sub(r'\\section\*\{Phụ lục D: Giao diện người dùng\}.*', '', app_content, flags=re.DOTALL).strip()
app_content += "\n"

with open(app_path, 'w', encoding='utf-8') as f:
    f.write(app_content)

print("Removed more sections successfully.")
