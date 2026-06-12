const delta = '{"summary":"Mô hình \\"kinh doanh xanh\\""}';
console.log("Delta:", delta);
const regex = /"summary"\s*:\s*"([^"]*(?:\\.[^"]*)*)"?/;
console.log("Regex matches?", regex.test(delta));
const match = delta.match(regex);
console.log("Captured:", match[1]);
