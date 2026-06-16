import re

c3_path = 'thesis_vn/chapters/c3/c3_chapter.tex'

with open(c3_path, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Update opening paragraph
old_opening = r"Chương này hiện thực hóa các nền tảng lý thuyết đã được trình bày trong Chương~2 thành một hệ thống phần mềm hoàn chỉnh mang tên Fiber --- một tiện ích trình duyệt hỗ trợ tóm tắt tự động và kiểm chứng tin tức tiếng Việt. Nội dung chương được tổ chức theo trình tự từ phân tích yêu cầu đến triển khai: Mục~3.1 phân tích các yêu cầu chức năng và phi chức năng; Mục~3.2 giới thiệu kiến trúc tổng quan gồm ba dịch vụ; Mục~3.3 trình bày module tóm tắt văn bản với lớp trừu tượng hóa đa nhà cung cấp LLM và cơ chế định tuyến dựa trên độ phức tạp; Mục~3.4 mô tả pipeline dung hợp đa tác nhân MoA --- đóng góp kỹ thuật cốt lõi của khóa luận; Mục~3.5 trình bày module kiểm chứng tin tức; Mục~3.6 chi tiết khung đánh giá ba trục --- đóng góp chính về mặt phương pháp luận; Mục~3.7 mô tả thiết kế lược đồ cơ sở dữ liệu; và Mục~3.8 giới thiệu giao diện người dùng của hệ thống."

new_opening = r"Chương này hiện thực hóa các nền tảng lý thuyết đã được trình bày trong Chương~2 thành một hệ thống phần mềm hoàn chỉnh mang tên Fiber --- một tiện ích trình duyệt hỗ trợ tóm tắt tự động tin tức tiếng Việt. Nội dung chương được tổ chức theo trình tự từ phân tích yêu cầu đến đánh giá: Mục~3.1 phân tích các yêu cầu chức năng và phi chức năng; Mục~3.2 giới thiệu kiến trúc tổng quan hệ thống; Mục~3.3 trình bày module tóm tắt văn bản; Mục~3.4 mô tả pipeline dung hợp đa tác nhân MoA --- đóng góp kỹ thuật cốt lõi của khóa luận; và Mục~3.5 chi tiết khung đánh giá ba trục --- đóng góp chính về mặt phương pháp luận."

content = content.replace(old_opening, new_opening)

# 2. Delete subsection 3.5.5
content = re.sub(r'\\subsection\{Dung hợp MoA so với GPT-4o đơn lẻ\}.*?(?=\\section\{Tổng kết chương\})', '', content, flags=re.DOTALL)

# 3. Update conclusion paragraph
old_conclusion = r"Chương này đã trình bày toàn bộ quá trình thiết kế và xây dựng hệ thống Fiber, bao phủ từ phân tích yêu cầu đến giao diện người dùng cuối cùng. Về mặt kiến trúc, hệ thống được tổ chức thành ba dịch vụ phối hợp chặt chẽ: tiện ích trình duyệt Plasmo chịu trách nhiệm trích xuất nội dung và hiển thị, backend Next.js~14 đóng vai trò điều phối trung tâm với xác thực dữ liệu bằng Zod, và microservice BERTScore dựa trên PhoBERT để tính toán tương đồng ngữ nghĩa. Về mặt kỹ thuật, pipeline MoA hai lớp với ba tác nhân đề xuất đa nhà cung cấp và một tác nhân tổng hợp GPT-4o đã được triển khai trên cơ sở nghiên cứu gốc của Wang et al.\ \cite{Wang2024}, kết hợp với cải tiến quan trọng là nhúng trực tiếp bài viết gốc vào ngữ cảnh tổng hợp thông qua kết nối phần dư --- biến tác nhân tổng hợp từ chế độ chắp vá bản thảo sang chế độ tổng hợp biên tập thực sự. Về mặt phương pháp luận, khung đánh giá ba trục tích hợp đồng thời các hệ số overlap tự động (Trục~A), đánh giá chất lượng bằng LLM-Judge (Trục~B) và xếp hạng mù bởi con người (Trục~C), đảm bảo rằng mọi kết luận khoa học đều được kiểm chứng từ ba góc nhìn độc lập. Toàn bộ thiết kế này sẽ được kiểm chứng thực nghiệm trên tập dữ liệu 154 bài báo tiếng Việt trong Chương~4."

new_conclusion = r"Chương này đã trình bày quá trình thiết kế và xây dựng hệ thống Fiber. Về mặt kiến trúc, hệ thống bao gồm tiện ích trình duyệt Plasmo chịu trách nhiệm trích xuất nội dung và hiển thị, cùng backend Next.js~14 đóng vai trò điều phối trung tâm. Về mặt kỹ thuật, pipeline MoA hai lớp với ba tác nhân đề xuất đa nhà cung cấp và một tác nhân tổng hợp GPT-4o đã được triển khai trên cơ sở nghiên cứu gốc của Wang et al.\ \cite{Wang2024}, kết hợp với cải tiến quan trọng là nhúng trực tiếp bài viết gốc vào ngữ cảnh tổng hợp thông qua kết nối phần dư --- biến tác nhân tổng hợp từ chế độ chắp vá bản thảo sang chế độ tổng hợp biên tập thực sự. Về mặt phương pháp luận, khung đánh giá ba trục tích hợp đồng thời các hệ số overlap tự động (Trục~A), đánh giá chất lượng bằng LLM-Judge (Trục~B) và xếp hạng mù bởi con người (Trục~C), đảm bảo rằng mọi kết luận khoa học đều được kiểm chứng từ ba góc nhìn độc lập. Toàn bộ thiết kế này sẽ được kiểm chứng thực nghiệm trên tập dữ liệu 154 bài báo tiếng Việt trong Chương~4."

content = content.replace(old_conclusion, new_conclusion)

# Clean up any leftover blank lines
content = re.sub(r'\n{3,}', '\n\n', content)

with open(c3_path, 'w', encoding='utf-8') as f:
    f.write(content)

print("Updated c3 successfully.")
