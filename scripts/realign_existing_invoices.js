const db = require('../db/connection');
const { setSequenceCounter, normalizePrefix } = require('../utils/sequenceGenerator');

/**
 * Realigns existing document numbers (POS, INV, PO, GST, SO, RET)
 * so that uneven, disordered timestamp numbers (e.g., POS-325135, POS-076448)
 * are placed in a clean, monotonic, properly aligned order (POS-000001, POS-000002...).
 */
async function realignAllDocuments() {
    console.log('🔄 Starting document sequence realignment...');

    // 1. Get all unique users who have invoices
    const invoiceUsers = await db.prepare('SELECT DISTINCT user_id FROM business_invoices WHERE user_id IS NOT NULL').all();

    for (const { user_id } of invoiceUsers) {
        // A. Realign POS Invoices
        const posBills = await db.prepare(`
            SELECT id, invoice_number, branch_id, created_at 
            FROM business_invoices 
            WHERE user_id = ? AND (invoice_number LIKE 'POS-%' OR invoice_type = 'POS')
            ORDER BY created_at ASC, id ASC
        `).all(user_id);

        if (posBills.length > 0) {
            console.log(`User ${user_id}: Found ${posBills.length} POS bills to align.`);
            let counter = 0;
            for (const bill of posBills) {
                counter++;
                const newNum = `POS-${String(counter).padStart(6, '0')}`;
                const oldNum = bill.invoice_number;

                if (oldNum !== newNum) {
                    await db.prepare('UPDATE business_invoices SET invoice_number = ? WHERE id = ?').run(newNum, bill.id);

                    // Update customer_purchase_history
                    try {
                        await db.prepare(`
                            UPDATE customer_purchase_history 
                            SET invoice_number = ? 
                            WHERE invoice_id = ? OR invoice_number = ?
                        `).run(newNum, bill.id, oldNum);
                    } catch (e) {}

                    // Update purchase_history
                    try {
                        await db.prepare(`
                            UPDATE purchase_history 
                            SET invoice_number = ? 
                            WHERE invoice_id = ? OR invoice_number = ?
                        `).run(newNum, bill.id, oldNum);
                    } catch (e) {}

                    // Update customer_loyalty_transactions
                    try {
                        await db.prepare(`
                            UPDATE customer_loyalty_transactions 
                            SET invoice_number = ?,
                                description = REPLACE(description, ?, ?)
                            WHERE invoice_number = ?
                        `).run(newNum, oldNum, newNum, oldNum);
                    } catch (e) {}

                    // Update accounting reference
                    try {
                        await db.prepare(`
                            UPDATE accounting 
                            SET reference_id = ? 
                            WHERE reference_id = ?
                        `).run(newNum, oldNum);
                    } catch (e) {}
                }
            }

            // Sync sequence generator counter
            await setSequenceCounter({
                userId: user_id,
                docType: 'POS',
                prefix: 'POS-',
                currentNumber: counter,
                padding: 6
            });
            console.log(`✅ User ${user_id}: Successfully realigned ${counter} POS bills to POS-000001 -> POS-${String(counter).padStart(6, '0')}`);
        }

        // B. Realign Standard Sales Invoices (INV-*)
        const salesInvoices = await db.prepare(`
            SELECT id, invoice_number, branch_id, created_at 
            FROM business_invoices 
            WHERE user_id = ? 
              AND (invoice_number LIKE 'INV-%' OR invoice_number LIKE 'INV_%' OR invoice_type IN ('GST', 'Non-GST', 'Sale'))
              AND invoice_number NOT LIKE 'POS-%'
            ORDER BY created_at ASC, id ASC
        `).all(user_id);

        if (salesInvoices.length > 0) {
            console.log(`User ${user_id}: Found ${salesInvoices.length} Sales invoices to align.`);
            let counter = 0;
            for (const inv of salesInvoices) {
                counter++;
                const newNum = `INV-${String(counter).padStart(6, '0')}`;
                const oldNum = inv.invoice_number;

                if (oldNum !== newNum) {
                    await db.prepare('UPDATE business_invoices SET invoice_number = ? WHERE id = ?').run(newNum, inv.id);

                    try {
                        await db.prepare(`
                            UPDATE customer_purchase_history 
                            SET invoice_number = ? 
                            WHERE invoice_id = ? OR invoice_number = ?
                        `).run(newNum, inv.id, oldNum);
                    } catch (e) {}

                    try {
                        await db.prepare(`
                            UPDATE purchase_history 
                            SET invoice_number = ? 
                            WHERE invoice_id = ? OR invoice_number = ?
                        `).run(newNum, inv.id, oldNum);
                    } catch (e) {}

                    try {
                        await db.prepare(`
                            UPDATE customer_loyalty_transactions 
                            SET invoice_number = ?,
                                description = REPLACE(description, ?, ?)
                            WHERE invoice_number = ?
                        `).run(newNum, oldNum, newNum, oldNum);
                    } catch (e) {}

                    try {
                        await db.prepare(`
                            UPDATE accounting 
                            SET reference_id = ? 
                            WHERE reference_id = ?
                        `).run(newNum, oldNum);
                    } catch (e) {}
                }
            }

            // Sync sequence generator counter
            await setSequenceCounter({
                userId: user_id,
                docType: 'INVOICE',
                prefix: 'INV-',
                currentNumber: counter,
                padding: 6
            });
            console.log(`✅ User ${user_id}: Successfully realigned ${counter} Sales invoices to INV-000001 -> INV-${String(counter).padStart(6, '0')}`);
        }
    }

    // 2. Purchases (business_purchases)
    try {
        const purUsers = await db.prepare('SELECT DISTINCT user_id FROM business_purchases WHERE user_id IS NOT NULL').all();
        for (const { user_id } of purUsers) {
            const purchases = await db.prepare(`
                SELECT id, purchase_number, created_at 
                FROM business_purchases 
                WHERE user_id = ? 
                ORDER BY created_at ASC, id ASC
            `).all(user_id);

            if (purchases.length > 0) {
                let pCounter = 0;
                for (const p of purchases) {
                    pCounter++;
                    const newPNum = `PO-${String(pCounter).padStart(6, '0')}`;
                    if (p.purchase_number !== newPNum) {
                        await db.prepare('UPDATE business_purchases SET purchase_number = ? WHERE id = ?').run(newPNum, p.id);
                    }
                }
                await setSequenceCounter({
                    userId: user_id,
                    docType: 'PURCHASE',
                    prefix: 'PO-',
                    currentNumber: pCounter,
                    padding: 6
                });
                console.log(`✅ User ${user_id}: Aligned ${pCounter} purchases to PO-000001 -> PO-${String(pCounter).padStart(6, '0')}`);
            }
        }
    } catch (e) {
        console.warn('Purchases realignment note:', e.message);
    }

    // 3. Sales Orders (business_orders)
    try {
        const orderUsers = await db.prepare('SELECT DISTINCT user_id FROM business_orders WHERE user_id IS NOT NULL').all();
        for (const { user_id } of orderUsers) {
            const orders = await db.prepare(`
                SELECT id, order_number, created_at 
                FROM business_orders 
                WHERE user_id = ? 
                ORDER BY created_at ASC, id ASC
            `).all(user_id);

            if (orders.length > 0) {
                let oCounter = 0;
                for (const o of orders) {
                    oCounter++;
                    const newONum = `SO-${String(oCounter).padStart(6, '0')}`;
                    if (o.order_number !== newONum) {
                        await db.prepare('UPDATE business_orders SET order_number = ? WHERE id = ?').run(newONum, o.id);
                    }
                }
                await setSequenceCounter({
                    userId: user_id,
                    docType: 'ORDER',
                    prefix: 'SO-',
                    currentNumber: oCounter,
                    padding: 6
                });
                console.log(`✅ User ${user_id}: Aligned ${oCounter} orders to SO-000001 -> SO-${String(oCounter).padStart(6, '0')}`);
            }
        }
    } catch (e) {
        console.warn('Orders realignment note:', e.message);
    }

    // 4. GST Invoices (gst_invoices)
    try {
        const gstUsers = await db.prepare('SELECT DISTINCT user_id FROM gst_invoices WHERE user_id IS NOT NULL').all();
        for (const { user_id } of gstUsers) {
            const gstInvs = await db.prepare(`
                SELECT id, invoice_number, created_at 
                FROM gst_invoices 
                WHERE user_id = ? 
                ORDER BY created_at ASC, id ASC
            `).all(user_id);

            if (gstInvs.length > 0) {
                let gCounter = 0;
                for (const g of gstInvs) {
                    gCounter++;
                    const newGNum = `GST-${String(gCounter).padStart(6, '0')}`;
                    if (g.invoice_number !== newGNum) {
                        await db.prepare('UPDATE gst_invoices SET invoice_number = ? WHERE id = ?').run(newGNum, g.id);
                    }
                }
                await setSequenceCounter({
                    userId: user_id,
                    docType: 'GST',
                    prefix: 'GST-',
                    currentNumber: gCounter,
                    padding: 6
                });
                console.log(`✅ User ${user_id}: Aligned ${gCounter} GST invoices to GST-000001 -> GST-${String(gCounter).padStart(6, '0')}`);
            }
        }
    } catch (e) {
        console.warn('GST invoices realignment note:', e.message);
    }

    console.log('✨ All document sequences have been successfully realigned and ordered!');
}

if (require.main === module) {
    realignAllDocuments().then(() => process.exit(0)).catch(e => {
        console.error('Fatal error during realignment:', e);
        process.exit(1);
    });
}

module.exports = { realignAllDocuments };
