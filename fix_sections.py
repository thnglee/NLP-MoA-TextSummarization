import re

c3_path = 'thesis_vn/chapters/c3/c3_chapter.tex'
app_path = 'thesis_vn/chapters/appendix.tex'

with open(c3_path, 'r', encoding='utf-8') as f:
    c3_lines = f.readlines()

# The UI section starts at \section{Giao diện người dùng} at line 420 (0-indexed 419)
# Wait, it's safer to find it.
start_ui = -1
for i, line in enumerate(c3_lines):
    if line.startswith('\\section{Giao diện người dùng}') and i > 360:
        start_ui = i
        break

end_ui = -1
for i in range(start_ui + 1, len(c3_lines)):
    if line.startswith('\\section{Tổng kết chương}'): # Wait, the loop var is `line`, but it should be `c3_lines[i]`
        pass

# Let's just use string replacement on the full text instead of lines
with open(c3_path, 'r', encoding='utf-8') as f:
    c3_content = f.read()

# Extract UI section (from \section{Giao diện người dùng} up to \section{Tổng kết chương})
ui_match = re.search(r'(\\section\{Giao diện người dùng\}.*?)(?=\\section\{Tổng kết chương\})', c3_content[c3_content.rfind('\\section{Giao diện người dùng}'):], re.DOTALL)
ui_content = ui_match.group(1).strip() if ui_match else ""

# Modify UI content for appendix
ui_appendix = ui_content.replace('\\section{Giao diện người dùng}', '\\section*{Phụ lục D: Giao diện người dùng}')
ui_appendix = ui_appendix.replace('\\subsection{', '\\subsection*{')

# Read appendix
with open(app_path, 'r', encoding='utf-8') as f:
    app_content = f.read()

# Remove old Phụ lục D
app_content = re.sub(r'\\section\*\{Phụ lục D: Thiết kế cơ sở dữ liệu\}.*', '', app_content, flags=re.DOTALL).strip()

# Append new Phụ lục D
app_content += "\n\n" + ui_appendix + "\n"

with open(app_path, 'w', encoding='utf-8') as f:
    f.write(app_content)

# Now remove the unwanted lines from c3_chapter.tex
# Remove everything from \subsection{Các chỉ số đo lường...} to just before \section{Tổng kết chương}
to_remove_match = re.search(r'(\\subsection\{Các chỉ số đo lường trên từng bản tóm tắt.*?)(?=\\section\{Tổng kết chương\})', c3_content, re.DOTALL)
if to_remove_match:
    c3_content = c3_content.replace(to_remove_match.group(1), '')

with open(c3_path, 'w', encoding='utf-8') as f:
    f.write(c3_content)

print("Fixed sections successfully.")
