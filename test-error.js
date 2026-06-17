const fs = require('fs');
const content = fs.readFileSync('/Users/hi/Desktop/CLIKS-BE/controllers/attendanceController.js', 'utf8');
const newContent = content.replace(
  "return sendError(res, 'Failed to fetch shifts', 500);",
  "console.error('Fetch shifts error:', error); return sendError(res, 'Failed to fetch shifts', 500);"
);
fs.writeFileSync('/Users/hi/Desktop/CLIKS-BE/controllers/attendanceController.js', newContent);
