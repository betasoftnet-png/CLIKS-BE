const fs = require('fs');
const content = fs.readFileSync('c:/Users/btc00/OneDrive/Documents/cliks-business/CLIKS-BE/controllers/caController.js', 'utf8');

const lines = content.split('\n');
lines.forEach((line, idx) => {
  if (line.includes('getFolders') || line.includes('getFiles') || line.includes('addFile') || line.includes('deleteFile')) {
    console.log(`Line ${idx + 1}: ${line.trim()}`);
  }
});
