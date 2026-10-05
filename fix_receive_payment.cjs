const fs = require('fs');
const filePath = '/Users/hi/Desktop/Cliks/CLIKS-BE/controllers/paymentController.js';
let content = fs.readFileSync(filePath, 'utf8');

const targetStr = `            // Record income entry in accounting table
            try {
                await db.prepare(\`
                    INSERT INTO accounting (user_id, entry_type, date, amount, category, mode, notes, status, created_at, updated_at)
                    VALUES (?, 'income', ?, ?, 'Customer Payment', ?, ?, 'Completed', ?, ?)
                \`).run(req.user.id, now.split('T')[0], finalPaidAmount, payment_mode || 'Cash', \`Receipt from \${custName} (Invoice: \${invId || 'Direct'})\`, now, now);
            } catch (e) {}`;

const replaceStr = `            // Record income entry in accounting table
            try {
                await db.prepare(\`
                    INSERT INTO accounting (user_id, entry_type, date, amount, category, mode, notes, status, created_at, updated_at)
                    VALUES (?, 'income', ?, ?, 'Customer Payment', ?, ?, 'Completed', ?, ?)
                \`).run(req.user.id, now.split('T')[0], finalPaidAmount, payment_mode || 'Cash', \`Receipt from \${custName} (Invoice: \${invId || 'Direct'})\`, now, now);
            } catch (e) {}

            // Update business_invoices if invId is present
            if (invId) {
                try {
                    const invoice = await db.prepare('SELECT * FROM business_invoices WHERE user_id = ? AND (invoice_number = ? OR id = ?)').get(req.user.id, invId, invId);
                    if (invoice) {
                        const parsedAmount = finalPaidAmount;
                        await db.prepare(\`
                            UPDATE business_invoices 
                            SET paid_amount = COALESCE(paid_amount, 0) + ?, 
                                due_amount = CASE 
                                    WHEN due_amount IS NULL THEN MAX(total_amount - ?, 0) 
                                    ELSE MAX(due_amount - ?, 0) 
                                END,
                                status = CASE 
                                    WHEN (CASE WHEN due_amount IS NULL THEN MAX(total_amount - ?, 0) ELSE MAX(due_amount - ?, 0) END) <= 0 THEN 'Paid' 
                                    ELSE 'Partially Paid' 
                                END 
                            WHERE id = ?
                        \`).run(parsedAmount, parsedAmount, parsedAmount, parsedAmount, parsedAmount, invoice.id);

                        // Also log in business_invoice_payments
                        try {
                            await db.prepare('INSERT INTO business_invoice_payments (invoice_id, amount, payment_method, payment_date, reference_number, notes) VALUES (?, ?, ?, ?, ?, ?)')
                                .run(invoice.id, parsedAmount, payment_mode || 'Cash', now, reference_number || null, typeof notes === 'string' ? notes : null);
                        } catch (e) {}
                    }
                } catch (e) {
                    console.error('[Payment Controller] Error updating invoice:', e);
                }
            }`;

if (content.includes(targetStr)) {
    content = content.replace(targetStr, replaceStr);
    fs.writeFileSync(filePath, content);
    console.log('Successfully updated receivePayment in paymentController.js');
} else {
    console.log('Target string not found in paymentController.js');
}
