# MoA Residual Connection Ablation Study

## Experiment Design

| Parameter              | Value                                           |
| ---------------------- | ----------------------------------------------- |
| **Proposer models**    | gpt-4o-mini, gemini-2.5-flash, claude-haiku-4-5 |
| **Aggregator model**   | gpt-4o                                          |
| **Articles processed** | 50                                              |
| **Started**            | 2026-06-04T09:26:25.384Z                        |
| **Finished**           | 2026-06-04T09:43:07.517Z                        |
| **BERTScore**          | Enabled                                         |

> **Hypothesis**: Injecting the original article (`articleSnippet`) as a residual connection into the MoA aggregator prompt improves content retention (Axis-A) and/or summary quality (Axis-B).

## Aggregate Statistics

### Axis-A: Content Retention (similarity to source article)

Higher is better for all Axis-A metrics.

| Metric        | With `articleSnippet` | Without `articleSnippet` | Δ (With − Without) |
| ------------- | --------------------- | ------------------------ | ------------------ |
| **ROUGE-1**   | 0.4252                | 0.3859                   | +0.0393 ▲          |
| **ROUGE-2**   | 0.3644                | 0.3156                   | +0.0488 ▲          |
| **ROUGE-L**   | 0.3343                | 0.2747                   | +0.0596 ▲          |
| **BERTScore** | 0.6585                | 0.6346                   | +0.0239 ▲          |

| Metric               | With `articleSnippet` | Without `articleSnippet` | Δ (With − Without) |
| -------------------- | --------------------- | ------------------------ | ------------------ |
| **BLEU-4**           | 0.1376                | 0.0898                   | +0.0478 ▲          |
| **Compression Rate** | 43.0510               | 39.1448                  | +3.9062            |
| **Avg Word Count**   | 248                   | 225                      | +23                |

### Win Rate Summary (With vs. Without `articleSnippet`)

| Metric               | With wins | Without wins | Ties |
| -------------------- | --------- | ------------ | ---- |
| **ROUGE-1**          | 33        | 17           | 0    |
| **ROUGE-2**          | 35        | 15           | 0    |
| **ROUGE-L**          | 42        | 8            | 0    |
| **BERTScore**        | 34        | 6            | 0    |
| **BLEU-4**           | 36        | 14           | 0    |
| **Compression Rate** | 16        | 33           | 1    |

## Per-Article Side-by-Side Comparison

| #   | Axis-A: ROUGE-1 (With / No) | Axis-A: BERTScore (With / No) | Axis-B: BLEU (With / No) | Δ ROUGE-1 | Δ BERTScore |
| --- | --------------------------- | ----------------------------- | ------------------------ | --------- | ----------- |
| 1   | 0.1486 / 0.1860             | 0.5823 / 0.5606               | 0.0015 / 0.0046          | -0.0374   | +0.0217     |
| 2   | 0.4456 / 0.4151             | 0.6190 / 0.6544               | 0.1900 / 0.1611          | +0.0305   | -0.0354     |
| 3   | 0.4288 / 0.3509             | 0.6378 / 0.6013               | 0.1321 / 0.0557          | +0.0779   | +0.0364     |
| 4   | 0.3742 / 0.3920             | 0.7435 / —                    | 0.1021 / 0.1160          | -0.0178   | —           |
| 5   | 0.3442 / 0.3656             | 0.7059 / 0.6847               | 0.0874 / 0.0926          | -0.0214   | +0.0212     |
| 6   | 0.3464 / 0.3857             | 0.6557 / —                    | 0.0779 / 0.1023          | -0.0393   | —           |
| 7   | 0.2676 / 0.1652             | 0.6011 / 0.5514               | 0.0221 / 0.0028          | +0.1024   | +0.0497     |
| 8   | 0.3741 / 0.4117             | 0.5972 / 0.6111               | 0.0780 / 0.0823          | -0.0376   | -0.0139     |
| 9   | 0.4306 / 0.4557             | 0.6752 / 0.6522               | 0.1402 / 0.1365          | -0.0251   | +0.0230     |
| 10  | 0.5256 / 0.4547             | 0.6942 / 0.6503               | 0.2323 / 0.1598          | +0.0709   | +0.0439     |
| 11  | 0.5283 / 0.4139             | 0.6889 / 0.6168               | 0.2172 / 0.1116          | +0.1144   | +0.0721     |
| 12  | 0.3267 / 0.2660             | 0.5593 / —                    | 0.0597 / 0.0220          | +0.0607   | —           |
| 13  | 0.3212 / 0.3400             | 0.6375 / 0.6291               | 0.0497 / 0.0544          | -0.0188   | +0.0083     |
| 14  | 0.5724 / 0.3951             | 0.6463 / 0.5767               | 0.2862 / 0.1240          | +0.1773   | +0.0696     |
| 15  | 0.6231 / 0.5054             | 0.7268 / 0.6875               | 0.3180 / 0.1665          | +0.1177   | +0.0392     |
| 16  | 0.5160 / 0.4256             | 0.6493 / 0.6292               | 0.1490 / 0.0608          | +0.0904   | +0.0201     |
| 17  | 0.2946 / 0.2658             | — / —                         | 0.0494 / 0.0278          | +0.0288   | —           |
| 18  | 0.4054 / 0.3972             | 0.6662 / —                    | 0.1488 / 0.1225          | +0.0082   | —           |
| 19  | 0.4025 / 0.3931             | 0.6468 / 0.6406               | 0.1221 / 0.0964          | +0.0094   | +0.0062     |
| 20  | 0.2492 / 0.2796             | 0.6225 / 0.5996               | 0.0216 / 0.0324          | -0.0304   | +0.0229     |
| 21  | 0.2146 / 0.1778             | — / 0.6500                    | 0.0109 / 0.0036          | +0.0368   | —           |
| 22  | 0.4764 / 0.4413             | 0.6598 / 0.6530               | 0.1342 / 0.0891          | +0.0351   | +0.0069     |
| 23  | 0.4123 / 0.3854             | 0.7059 / 0.6376               | 0.1093 / 0.0718          | +0.0269   | +0.0683     |
| 24  | 0.6274 / 0.4214             | 0.7346 / 0.6471               | 0.3647 / 0.1192          | +0.2060   | +0.0875     |
| 25  | 0.2546 / 0.1983             | 0.6864 / 0.6355               | 0.0244 / 0.0051          | +0.0563   | +0.0508     |
| 26  | 0.3950 / 0.4402             | 0.6370 / 0.6550               | 0.1025 / 0.1237          | -0.0452   | -0.0180     |
| 27  | 0.4300 / 0.3606             | — / 0.6525                    | 0.1582 / 0.0914          | +0.0694   | —           |
| 28  | 0.3541 / 0.2823             | 0.6966 / 0.6389               | 0.0945 / 0.0370          | +0.0718   | +0.0578     |
| 29  | 0.2634 / 0.1835             | 0.5964 / 0.5699               | 0.0294 / 0.0048          | +0.0799   | +0.0265     |
| 30  | 0.2954 / 0.2317             | 0.6816 / 0.5976               | 0.0414 / 0.0137          | +0.0637   | +0.0840     |
| 31  | 0.4433 / 0.3839             | 0.6343 / 0.6102               | 0.1296 / 0.0738          | +0.0594   | +0.0241     |
| 32  | 0.8055 / 0.6542             | 0.8580 / 0.7825               | 0.6097 / 0.2865          | +0.1513   | +0.0755     |
| 33  | 0.2533 / 0.2165             | 0.5815 / —                    | 0.0207 / 0.0084          | +0.0368   | —           |
| 34  | 0.5489 / 0.5695             | 0.7087 / 0.7003               | 0.1559 / 0.1616          | -0.0206   | +0.0084     |
| 35  | 0.3146 / 0.3733             | 0.6118 / 0.6282               | 0.0369 / 0.0608          | -0.0587   | -0.0163     |
| 36  | 0.7023 / 0.5523             | — / 0.7465                    | 0.4486 / 0.2834          | +0.1500   | —           |
| 37  | 0.3859 / 0.3089             | 0.6535 / 0.6495               | 0.1185 / 0.0708          | +0.0770   | +0.0040     |
| 38  | 0.3502 / 0.3281             | 0.6879 / 0.6353               | 0.1176 / 0.0689          | +0.0221   | +0.0526     |
| 39  | 0.3721 / 0.3407             | 0.6238 / 0.5993               | 0.0971 / 0.0656          | +0.0314   | +0.0245     |
| 40  | 0.4878 / 0.3144             | — / 0.6411                    | 0.1890 / 0.0488          | +0.1734   | —           |
| 41  | 0.4326 / 0.4517             | 0.6500 / 0.6351               | 0.0957 / 0.0933          | -0.0191   | +0.0149     |
| 42  | 0.5286 / 0.5336             | 0.6146 / 0.6122               | 0.1321 / 0.1368          | -0.0050   | +0.0025     |
| 43  | 0.9223 / 0.8350             | 0.7816 / 0.6515               | 0.4466 / 0.2228          | +0.0873   | +0.1301     |
| 44  | 0.2332 / 0.2082             | 0.6522 / 0.5725               | 0.0131 / 0.0064          | +0.0250   | +0.0796     |
| 45  | 0.5578 / 0.4344             | 0.6469 / 0.6542               | 0.2263 / 0.1391          | +0.1234   | -0.0073     |
| 46  | 0.2981 / 0.3542             | 0.6123 / 0.6260               | 0.0680 / 0.0871          | -0.0561   | -0.0138     |
| 47  | 0.8720 / 0.8960             | 0.6641 / 0.6504               | 0.2318 / 0.1986          | -0.0240   | +0.0137     |
| 48  | 0.3981 / 0.3647             | 0.6498 / 0.6269               | 0.0781 / 0.0604          | +0.0334   | +0.0229     |
| 49  | 0.4303 / 0.4731             | 0.5979 / 0.5911               | 0.0808 / 0.0871          | -0.0428   | +0.0068     |
| 50  | 0.2756 / 0.3153             | 0.6496 / 0.6254               | 0.0281 / 0.0379          | -0.0397   | +0.0242     |

## Sample Summaries (first 3 successful articles)

### Article 1

**URL:** `https://tienphong.vn/chu-nhat-do-2026-gap-nu-sinh-gan-10-lan-hien-mau-post1823998.tpo`

**With `articleSnippet` (Condition A):**

> Bài viết "Chủ Nhật Đỏ" nhấn mạnh tinh thần trách nhiệm và sẻ chia của các sinh viên khi tham gia ngày hội hiến máu tình nguyện. Nguyễn Khánh Huyền, sinh viên ngành Quản lý kinh tế tại Trường ĐH Tài chính - Marketing, đã ghi dấu ấn với 6 lần hiến máu. Huyền không chỉ hiến máu mà còn tham gia hỗ trợ tổ chức các chương trình từ thiện như bếp "0 đồng" và các chiến dịch Xuân tình nguyện. Nguyễn Khánh D…

**Without `articleSnippet` (Condition B):**

> Ngày hội hiến máu tình nguyện "Chủ Nhật Đỏ" đã trở thành một sự kiện ý nghĩa, thu hút đông đảo sinh viên và người trẻ tham gia, thể hiện tinh thần sẻ chia và trách nhiệm của tuổi trẻ. Nhiều sinh viên như Nguyễn Khánh Huyền từ Trường ĐH Tài chính - Marketing, Nguyễn Khánh Duyên từ Trường ĐH Nông Lâm TPHCM, và Đoàn Ngọc Toàn đã tham gia hiến máu nhiều lần, với mong muốn góp phần cứu sống người khác.…

| Metric           | With    | Without | Δ       |
| ---------------- | ------- | ------- | ------- |
| ROUGE-1          | 0.1486  | 0.1860  | -0.0374 |
| ROUGE-L          | 0.1283  | 0.1392  | -0.0109 |
| BERTScore        | 0.5823  | 0.5606  | +0.0217 |
| BLEU-4           | 0.0015  | 0.0046  | -0.0031 |
| Compression Rate | 15.9000 | 19.9900 | -4.0900 |
| Word Count       | 185     | 232     | —       |

### Article 2

**URL:** `https://tienphong.vn/ong-tran-sy-thanh-cam-ket-gi-voi-cu-tri-lang-son-post1823987.tpo`

**With `articleSnippet` (Condition A):**

> Ngày 1/3, tại xã Lộc Bình, tỉnh Lạng Sơn, đã diễn ra Hội nghị tiếp xúc cử tri với các ứng cử viên Đại biểu Quốc hội khóa XVI thuộc Đơn vị bầu cử số 1. Tham dự hội nghị có ông Trần Sỹ Thanh, Chủ nhiệm Ủy ban Kiểm tra Trung ương, bà Đoàn Thu Hà, Chủ tịch Ủy ban Mặt trận Tổ quốc Việt Nam tỉnh Lạng Sơn và các lãnh đạo tòa án của tỉnh. Ông Trần Sỹ Thanh cam kết, nếu được cử tri tín nhiệm bầu làm đại bi…

**Without `articleSnippet` (Condition B):**

> Ngày 1/3, tại xã Lộc Bình, tỉnh Lạng Sơn đã diễn ra hội nghị tiếp xúc cử tri với các ứng cử viên Đại biểu Quốc hội khóa XVI thuộc Đơn vị bầu cử số 1. Trong số các ứng cử viên có ông Trần Sỹ Thanh, Chủ nhiệm Ủy ban Kiểm tra Trung ương, và bà Đoàn Thu Hà, Chủ tịch Ủy ban MTTQ Việt Nam tỉnh Lạng Sơn. Tại buổi tiếp xúc, ông Trần Sỹ Thanh cam kết, nếu được bầu làm đại biểu Quốc hội, sẽ giữ mối liên hệ …

| Metric           | With    | Without | Δ       |
| ---------------- | ------- | ------- | ------- |
| ROUGE-1          | 0.4456  | 0.4151  | +0.0305 |
| ROUGE-L          | 0.4052  | 0.3441  | +0.0611 |
| BERTScore        | 0.6190  | 0.6544  | -0.0354 |
| BLEU-4           | 0.1900  | 0.1611  | +0.0289 |
| Compression Rate | 42.4000 | 39.2700 | +3.1300 |
| Word Count       | 321     | 299     | —       |

### Article 3

**URL:** `https://tienphong.vn/thong-tin-moi-vu-2-nu-sinh-lop-8-bi-bat-ve-lam-vo-o-nghe-an-post1823985.tpo`

**With `articleSnippet` (Condition A):**

> TPO - Hai nữ sinh lớp 8 của Trường Phổ thông Dân tộc Bán trú Trung học Cơ sở Na Loi, Nghệ An, đã bị "bắt" về làm vợ theo tập tục địa phương. Sau một thời gian vận động và tuyên truyền, một trong hai em, L.H.D., đã đồng ý quay trở lại trường học vào ngày 3/3. Nhà trường và giáo viên đang tiếp tục nỗ lực thuyết phục nữ sinh còn lại quay lại học. Sự việc xảy ra khi hai nữ sinh L.H.A. và L.H.D. bị hai…

**Without `articleSnippet` (Condition B):**

> Tại Trường Phổ thông Dân tộc Bán trú Trung học Cơ sở Na Loi, Nghệ An, hai nữ sinh lớp 8 là L.H.A. và L.H.D. đã bị tổ chức "bắt" về làm vợ theo tập tục địa phương sau kỳ nghỉ Tết. Sự việc diễn ra vào ban đêm, khiến nhà trường và chính quyền không thể ngăn chặn kịp thời. Sau thời gian tuyên truyền và vận động từ phía nhà trường và giáo viên, L.H.D. đã đồng ý quay trở lại trường học vào ngày 3/3. Ngà…

| Metric           | With    | Without | Δ       |
| ---------------- | ------- | ------- | ------- |
| ROUGE-1          | 0.4288  | 0.3509  | +0.0779 |
| ROUGE-L          | 0.3259  | 0.2296  | +0.0963 |
| BERTScore        | 0.6378  | 0.6013  | +0.0364 |
| BLEU-4           | 0.1321  | 0.0557  | +0.0764 |
| Compression Rate | 41.2800 | 33.1900 | +8.0900 |
| Word Count       | 223     | 176     | —       |

## Preliminary Conclusion

**Axis-A (Content Retention):** 4/4 metrics favour WITH articleSnippet — the residual connection appears to improve source grounding. ✅

_Statistical significance should be computed via paired t-test / sign-test on the full 50-article dataset._
