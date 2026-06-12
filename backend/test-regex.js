const text = 'Softie cam kết sản xuất theo mô hình kinh doanh xanh toàn diện \\"xanh\\"';
const delta = JSON.stringify({ summary: text });
console.log("Delta:", delta);
let accumulatedJson = delta;
const summaryMatch = accumulatedJson.match(/"summary"\s*:\s*"([^"]*(?:\\.[^"]*)*)"?/);
console.log("Match:", summaryMatch ? summaryMatch[1] : null);
if (summaryMatch) {
  const summaryText = summaryMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"');
  console.log("Extracted:", summaryText);
}
