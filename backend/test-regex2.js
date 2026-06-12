const text = 'Mô hình "kinh doanh xanh"';
const delta = JSON.stringify({ summary: text });
console.log("Delta:", delta);
const summaryMatch = delta.match(/"summary"\s*:\s*"([^"]*(?:\\.[^"]*)*)"?/);
console.log("Match:", summaryMatch ? summaryMatch[1] : null);
