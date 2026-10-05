const fs = require('fs');
const filePath = '/Users/hi/Desktop/Cliks/CLIKS-BE/controllers/accountingController.js';
let content = fs.readFileSync(filePath, 'utf8');

const targetStr = `            // Compute dynamic cash & bank assets
            const accounts = await db.prepare("SELECT * FROM bank_accounts WHERE user_id = ?").all(req.user.id);`;

const replaceStr = `            // Compute dynamic cash & bank assets
            const accounts = await db.prepare("SELECT * FROM accounting WHERE user_id = ? AND entry_type = 'AccountConfig'").all(req.user.id);`;

if (content.includes(targetStr)) {
    content = content.replace(targetStr, replaceStr);
    fs.writeFileSync(filePath, content);
    console.log('Successfully updated getBalanceSheet in accountingController.js');
} else {
    console.log('Target string not found in accountingController.js');
}
