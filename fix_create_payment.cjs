const fs = require('fs');
const filePath = '/Users/hi/Desktop/Cliks/CLIKS-BE/controllers/billingController.js';
let content = fs.readFileSync(filePath, 'utf8');

const targetStr = `            // Sync to cash/bank ledger (accounting table)
            const normalizedMode = normalizePaymentMode(payment_method);`;

const replaceStr = `            // Sync to business_payments (for Customer Receivables view)
            try {
                const packedNotes = typeof notes === 'string' && notes.length > 0
                    ? notes
                    : JSON.stringify({
                        customerProfile: invoice.client_name || 'General Customer',
                        invoiceLinkedId: invoice.invoice_number,
                        totalOriginalAmount: invoice.total_amount,
                        paidAmount: parsedAmount
                    });
                
                try {
                    await db.prepare(
                        \`INSERT INTO business_payments (
                            user_id, type, amount, paid_amount, total_original, total_original_amount, 
                            party_name, invoice_id, payment_mode, reference_number, notes, status, reconciliation_status, created_at
                         ) VALUES (?, 'receive', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', 'matched', ?)\`
                    ).run(
                        req.user.id, parsedAmount, parsedAmount, invoice.total_amount, invoice.total_amount,
                        invoice.client_name || 'General Customer', invoice.invoice_number, payment_method || 'Cash', reference_number || null, packedNotes, now
                    );
                } catch (colErr) {
                    await db.prepare(
                        \`INSERT INTO business_payments (user_id, type, amount, party_name, invoice_id, payment_mode, reference_number, notes, status, reconciliation_status, created_at)
                         VALUES (?, 'receive', ?, ?, ?, ?, ?, ?, 'completed', 'matched', ?)\`
                    ).run(req.user.id, parsedAmount, invoice.client_name || 'General Customer', invoice.invoice_number, payment_method || 'Cash', reference_number || null, packedNotes, now);
                }
            } catch (e) {
                console.error('[Billing Controller] Error syncing to business_payments:', e);
            }

            // Sync to cash/bank ledger (accounting table)
            const normalizedMode = normalizePaymentMode(payment_method);`;

if (content.includes(targetStr)) {
    content = content.replace(targetStr, replaceStr);
    
    // While we're here, let's fix the due_amount calculation bug in billingController.js
    const oldUpdateStr = `            await db.prepare(\`
                UPDATE business_invoices 
                SET paid_amount = COALESCE(paid_amount, 0) + ?, 
                    due_amount = MAX(COALESCE(due_amount, 0) - ?, 0), 
                    status = CASE WHEN COALESCE(due_amount, 0) - ? <= 0 THEN 'Paid' ELSE 'Partially Paid' END 
                WHERE id = ?
            \`).run(parsedAmount, parsedAmount, parsedAmount, id);`;
            
    const newUpdateStr = `            await db.prepare(\`
                UPDATE business_invoices 
                SET paid_amount = COALESCE(paid_amount, 0) + ?, 
                    due_amount = CASE 
                        WHEN due_amount IS NULL OR due_amount = 0 THEN MAX(total_amount - (COALESCE(paid_amount, 0) + ?), 0)
                        ELSE MAX(due_amount - ?, 0) 
                    END,
                    status = CASE 
                        WHEN (CASE WHEN due_amount IS NULL OR due_amount = 0 THEN MAX(total_amount - (COALESCE(paid_amount, 0) + ?), 0) ELSE MAX(due_amount - ?, 0) END) <= 0 THEN 'Paid' 
                        ELSE 'Partially Paid' 
                    END 
                WHERE id = ?
            \`).run(parsedAmount, parsedAmount, parsedAmount, parsedAmount, parsedAmount, id);`;
            
    content = content.replace(oldUpdateStr, newUpdateStr);

    fs.writeFileSync(filePath, content);
    console.log('Successfully updated createInvoicePayment in billingController.js');
} else {
    console.log('Target string not found in billingController.js');
}
