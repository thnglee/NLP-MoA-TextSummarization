const delta = '{"summary":"Mô hình \\"kinh doanh xanh\\" \\n\\n Test"}';
console.log("Delta:", delta);
// Fixed regex: added \\ to the negated character classes
const regex = /"summary"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"?/;
const match = delta.match(regex);
console.log("Captured:", match ? match[1] : null);
if (match) {
  console.log("Unescaped:", match[1].replace(/\\n/g, '\n').replace(/\\"/g, '"'));
}
