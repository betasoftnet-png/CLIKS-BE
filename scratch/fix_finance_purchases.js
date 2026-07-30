const fs = require('fs');
const path = 'c:/Users/btc00/OneDrive/Documents/cliks-business/CLIKS-BUS-FE/src/pages/BusinessFinancePurchases.jsx';

const content = fs.readFileSync(path, 'utf8');
const lines = content.split('\n');

// We want to delete from line 658 (index 657) to line 852 (index 851)
// Let's verify what the lines are
console.log("Line 657 (1-indexed):", lines[656]); // Should be "};"
console.log("Line 658 (1-indexed):", lines[657]); // Should be "/*"
console.log("Line 852 (1-indexed):", lines[851]); // Should be "*/"
console.log("Line 853 (1-indexed):", lines[852]); // Should be "};"

// Remove lines from index 657 to 851 (inclusive)
lines.splice(657, 195); // 851 - 657 + 1 = 195 lines

fs.writeFileSync(path, lines.join('\n'), 'utf8');
console.log("Successfully removed duplicate block from BusinessFinancePurchases.jsx");
