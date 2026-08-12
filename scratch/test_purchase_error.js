const db = require('../db/connection');
const purchaseController = require('../controllers/purchaseController');

async function testCreatePurchase() {
    try {
        console.log('Testing createPurchase...');
        const req = {
            user: { id: 1 },
            body: {
                purchase_number: `PO-${Date.now().toString().slice(-4)}`,
                purchase_type: 'GST',
                purchase_date: '2026-08-12',
                due_date: '2026-09-11',
                doc_type: 'PO',
                status: 'Approved',
                supplier_name: 'Egg rice',
                supplier_gstin: '',
                billing_address: '',
                contact_number: '',
                warehouse_id: 'Main Godown',
                purchase_by: 'Branch Manager',
                payment_status: 'pending',
                payment_mode: 'Cash',
                paid_amount: 0,
                advance_amount: 0,
                shipping_charge: 0,
                subtotal: 10,
                total_discount: 0,
                total_tax: 1.8,
                grand_total: 12,
                items: [
                    {
                        product_name: 'Egg rice [9]',
                        sku: '9',
                        quantity: 1,
                        purchase_price: 10,
                        discount: 0,
                        gst_percentage: 18,
                        tax_amount: 1.8,
                        total: 11.8
                    }
                ]
            }
        };

        const res = {
            status: function(code) {
                console.log('Response Status:', code);
                return this;
            },
            json: function(data) {
                console.log('Response Data:', JSON.stringify(data, null, 2));
                return this;
            }
        };

        await purchaseController.createPurchase(req, res);
    } catch (err) {
        console.error('CRATCHED ERROR:', err);
    }
}

testCreatePurchase();
