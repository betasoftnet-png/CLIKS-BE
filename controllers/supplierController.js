const db = require('../db/connection');
const { sendSuccess, sendError } = require('../utils/response');
const supplierConnectionService = require('../utils/supplierConnectionService');
const b2bConnectionService = require('../utils/b2bConnectionService');
const { validatePhone, validateEmail, validateGstin, validatePan } = require('../utils/globalValidator');

function normalizePaymentMode(mode) {
    if (!mode) return 'Cash in Hand';
    const m = String(mode).toLowerCase();
    if (m === 'cash' || m.includes('cash in hand') || m.includes('hand')) {
        return 'Cash in Hand';
    }
    if (m.includes('hdfc')) {
        return 'HDFC Bank Account';
    }
    if (m.includes('icici')) {
        return 'ICICI Bank Account';
    }
    if (m.includes('sbi') || m.includes('state bank')) {
        return 'SBI Current Account';
    }
    if (m === 'upi' || m.includes('razorpay') || m.includes('gpay') || m.includes('phonepe') || m.includes('paytm')) {
        return 'UPI / Razorpay';
    }
    if (m === 'bank' || m.includes('bank')) {
        return 'HDFC Bank Account';
    }
    return mode;
}

const supplierController = {
    // 1. Create Supplier
    createSupplier: async (req, res) => {
        const { name, email, phone, company, gstin, city, outstanding_balance, total_purchased, status, bank_account_number, ifsc_code, upi_id, documents, reminder_schedule } = req.body;
        if (!name) return sendError(res, 'Supplier name is required', 400);

        const phoneErr = validatePhone(phone, false);
        if (phoneErr) return sendError(res, phoneErr, 400);

        const cleanEmail = email ? String(email).trim().toLowerCase() : '';
        if (!cleanEmail || !cleanEmail.endsWith('@bnxmail.com') || !/^[^\s@]+@bnxmail\.com$/.test(cleanEmail)) {
            return sendError(res, 'Email must use the @bnxmail.com domain.', 400);
        }

        const gstinErr = validateGstin(gstin, false);
        if (gstinErr) return sendError(res, gstinErr, 400);

        try {
            await supplierConnectionService.ensureTable();
            const now = new Date().toISOString();
            const initialStatus = status || 'PENDING';
            const docsStr = typeof documents === 'object' ? JSON.stringify(documents) : (documents || '[]');
            const remStr = typeof reminder_schedule === 'object' ? JSON.stringify(reminder_schedule) : (reminder_schedule || null);

            const result = await db.prepare(`
                INSERT INTO business_suppliers (
                    user_id, name, email, phone, company, gstin, status, city, outstanding_balance, total_purchased,
                    bank_account_number, ifsc_code, upi_id, documents, reminder_schedule, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                req.user.id, name, email || null, phone || null, company || null, gstin || null, initialStatus, city || null,
                outstanding_balance || 0, total_purchased || 0,
                bank_account_number || null, ifsc_code || null, upi_id || null, docsStr, remStr, now, now
            );

            const b2bConnectionService = require('../utils/b2bConnectionService');
            const created = await db.prepare('SELECT * FROM business_suppliers WHERE id = ?').get(result.lastInsertRowid);
            
            // Trigger B2B Connection request if supplier email matches a registered Cliks Business user
            let b2bStatus = 'PENDING';
            if (created && created.email) {
                try {
                    const b2bConn = await b2bConnectionService.createOrUpdateConnection({
                        requester_user_id: req.user.id,
                        supplier_email: created.email,
                        supplier_name: created.name
                    });
                    if (b2bConn && b2bConn.status) {
                        b2bStatus = b2bConn.status === 'ACCEPTED' ? 'CONNECTED' : b2bConn.status;
                    }
                } catch (b2bErr) {
                    console.warn('[Supplier Controller] B2B connection sync warning:', b2bErr.message);
                }
            }

            // Sync connection request for website supplier portal
            try {
                await supplierConnectionService.syncSupplierConnectionOnCreateOrUpdate({
                    business_id: req.user.id,
                    supplier_id: created.id,
                    supplier_email: created.email,
                    phone: created.phone
                });
            } catch (portalErr) {
                console.warn('[Supplier Controller] Portal sync warning:', portalErr.message);
            }

            let connStatus = null;
            try {
                connStatus = await supplierConnectionService.getSupplierConnectionStatus(req.user.id, created.id, created.email);
            } catch (csErr) {}

            const finalStatus = (b2bStatus === 'CONNECTED' || b2bStatus === 'REJECTED') ? b2bStatus : (connStatus || b2bStatus || 'PENDING');

            return sendSuccess(res, { ...created, status: finalStatus, connection_status: finalStatus }, 'Supplier registered successfully', 201);
        } catch (error) {
            console.error('[Supplier Controller] Error creating supplier:', error);
            return sendError(res, 'Failed to create supplier', 500);
        }
    },

    // 2. Get Suppliers with optional Filtering & Connection Status
    getSuppliers: async (req, res) => {
        const { search, status, city } = req.query;
        try {
            try { await supplierConnectionService.ensureTable(); } catch (e) {}
            try { await b2bConnectionService.ensureTable(); } catch (e) {}

            let query = `SELECT * FROM business_suppliers WHERE user_id = ?`;
            const params = [req.user.id];

            if (city) {
                query += ` AND city LIKE ?`;
                params.push(`%${city}%`);
            }
            if (search) {
                query += ` AND (name LIKE ? OR company LIKE ? OR phone LIKE ?)`;
                params.push(`%${search}%`, `%${search}%`, `%${search}%`);
            }

            query += ` ORDER BY created_at DESC, id DESC`;
            const suppliers = await db.prepare(query).all(...params);

            const enriched = await Promise.all((suppliers || []).map(async s => {
                let liveStatus = s.status || 'PENDING';
                if (s.email) {
                    try {
                        const b2bConn = await db.prepare(`
                            SELECT status FROM b2b_connections
                            WHERE (requester_user_id = ? AND LOWER(target_email) = ?)
                               OR (target_user_id = ? AND LOWER(requester_email) = ?)
                            ORDER BY id DESC LIMIT 1
                        `).get(req.user.id, String(s.email).toLowerCase(), req.user.id, String(s.email).toLowerCase());
                        if (b2bConn && b2bConn.status) {
                            liveStatus = b2bConn.status === 'ACCEPTED' ? 'CONNECTED' : b2bConn.status;
                        }
                    } catch (e) {}
                }
                let connStatus = null;
                try {
                    connStatus = await supplierConnectionService.getSupplierConnectionStatus(req.user.id, s.id, s.email);
                } catch (e) {}

                const displaySt = (liveStatus === 'CONNECTED' || liveStatus === 'ACCEPTED' || String(s.status).toUpperCase() === 'CONNECTED') 
                    ? 'CONNECTED' 
                    : (liveStatus === 'REJECTED' ? 'REJECTED' : (connStatus || liveStatus || 'PENDING'));

                return {
                    ...s,
                    status: displaySt,
                    connection_status: displaySt
                };
            }));

            let finalResult = enriched;
            if (status && status !== 'All') {
                const targetSt = String(status).toLowerCase();
                finalResult = enriched.filter(item => {
                    const st1 = String(item.status || '').toLowerCase();
                    const st2 = String(item.connection_status || '').toLowerCase();
                    return st1 === targetSt || st2 === targetSt || (targetSt === 'connected' && (st1 === 'accepted' || st2 === 'accepted'));
                });
            }

            return sendSuccess(res, finalResult, 'Suppliers retrieved successfully');
        } catch (error) {
            console.error('[Supplier Controller] Error fetching suppliers:', error);
            return sendError(res, 'Failed to retrieve suppliers', 500);
        }
    },

    // 3. Get Supplier by ID
    getSupplierById: async (req, res) => {
        const { id } = req.params;
        try {
            const supplier = await db.prepare('SELECT * FROM business_suppliers WHERE id = ? AND user_id = ?').get(id, req.user.id);
            if (!supplier) return sendError(res, 'Supplier not found', 404);
            return sendSuccess(res, supplier, 'Supplier details retrieved successfully');
        } catch (error) {
            return sendError(res, 'Failed to retrieve supplier details', 500);
        }
    },

    // 4. Update Supplier
    updateSupplier: async (req, res) => {
        const { id } = req.params;
        const { name, email, phone, company, gstin, status, city, outstanding_balance, total_purchased, bank_account_number, ifsc_code, upi_id, documents, reminder_schedule } = req.body;
        try {
            const supplier = await db.prepare('SELECT id FROM business_suppliers WHERE id = ? AND user_id = ?').get(id, req.user.id);
            if (!supplier) return sendError(res, 'Supplier not found', 404);

            const docsStr = typeof documents === 'object' ? JSON.stringify(documents) : (documents !== undefined ? documents : null);
            const remStr = typeof reminder_schedule === 'object' ? JSON.stringify(reminder_schedule) : (reminder_schedule !== undefined ? reminder_schedule : null);

            await db.prepare(`
                UPDATE business_suppliers SET
                    name = ?, email = ?, phone = ?, company = ?, gstin = ?, status = ?, city = ?,
                    outstanding_balance = ?, total_purchased = ?,
                    bank_account_number = ?, ifsc_code = ?, upi_id = ?,
                    documents = COALESCE(?, documents), reminder_schedule = COALESCE(?, reminder_schedule),
                    updated_at = ?
                WHERE id = ?
            `).run(
                name, email || null, phone || null, company || null, gstin || null, status || 'active', city || null,
                outstanding_balance || 0, total_purchased || 0,
                bank_account_number || null, ifsc_code || null, upi_id || null,
                docsStr, remStr, new Date().toISOString(), id
            );

            const updated = await db.prepare('SELECT * FROM business_suppliers WHERE id = ?').get(id);
            return sendSuccess(res, updated, 'Supplier updated successfully');
        } catch (error) {
            console.error('[Supplier Controller] Update error:', error);
            return sendError(res, 'Failed to update supplier', 500);
        }
    },

    // 5. Delete Supplier
    deleteSupplier: async (req, res) => {
        const { id } = req.params;
        try {
            const supplier = await db.prepare('SELECT id FROM business_suppliers WHERE id = ? AND user_id = ?').get(id, req.user.id);
            if (!supplier) return sendError(res, 'Supplier not found', 404);

            await db.prepare('DELETE FROM business_suppliers WHERE id = ?').run(id);
            return sendSuccess(res, null, 'Supplier deleted successfully');
        } catch (error) {
            return sendError(res, 'Failed to delete supplier', 500);
        }
    },

    // 6. Search Suppliers
    searchSuppliers: async (req, res) => {
        const { q } = req.query;
        try {
            const wildcard = `%${q || ''}%`;
            const suppliers = await db.prepare(`
                SELECT * FROM business_suppliers
                WHERE user_id = ? AND (name LIKE ? OR company LIKE ? OR email LIKE ? OR phone LIKE ?)
            `).all(req.user.id, wildcard, wildcard, wildcard, wildcard);
            return sendSuccess(res, suppliers, 'Suppliers matched successfully');
        } catch (error) {
            return sendError(res, 'Search failed', 500);
        }
    },

    // 7. Ledger & Outstanding
    getLedger: async (req, res) => {
        const { id } = req.params;
        try {
            const supplier = await db.prepare('SELECT * FROM business_suppliers WHERE id = ? AND user_id = ?').get(id, req.user.id);
            if (!supplier) return sendError(res, 'Supplier not found', 404);

            let ledgerRows = [];
            try {
                ledgerRows = await db.prepare('SELECT * FROM supplier_ledger WHERE supplier_id = ? AND user_id = ? ORDER BY created_at ASC, id ASC').all(id, req.user.id);
            } catch(e) {}

            if (!ledgerRows || ledgerRows.length === 0) {
                const combinedEvents = [];
                const ob = parseFloat(supplier.outstanding_balance || supplier.current_balance || 0);

                if (ob > 0) {
                    combinedEvents.push({
                        date: supplier.created_at ? supplier.created_at.split('T')[0] : new Date().toISOString().split('T')[0],
                        description: 'Opening Balance',
                        reference_id: 'OB-INITIAL',
                        debit: ob,
                        credit: 0,
                        raw_date: supplier.created_at || '1970-01-01'
                    });
                }

                // Fetch purchases for this supplier
                try {
                    const purchases = await db.prepare("SELECT * FROM business_purchases WHERE user_id = ? AND (supplier_id = ? OR LOWER(supplier_name) = LOWER(?)) AND (status IS NULL OR LOWER(status) NOT IN ('cancelled', 'deleted')) ORDER BY created_at ASC").all(req.user.id, id, supplier.name || '');
                    (purchases || []).forEach(p => {
                        const amt = parseFloat(p.total_amount || p.amount || 0);
                        if (amt > 0) {
                            combinedEvents.push({
                                date: p.bill_date || p.purchase_date || (p.created_at ? p.created_at.split('T')[0] : new Date().toISOString().split('T')[0]),
                                description: `Purchase Bill #${p.purchase_number || p.bill_number || p.id}`,
                                reference_id: p.purchase_number || p.bill_number || `BILL-${p.id}`,
                                debit: amt,
                                credit: 0,
                                raw_date: p.created_at || p.purchase_date || '1970-01-01'
                            });
                        }
                    });
                } catch(e) {}

                // Fetch payments for this supplier
                try {
                    const payments = await db.prepare("SELECT * FROM supplier_payments WHERE supplier_id = ? AND user_id = ? ORDER BY payment_date ASC, created_at ASC").all(id, req.user.id);
                    (payments || []).forEach(pm => {
                        const amt = parseFloat(pm.amount || 0);
                        if (amt > 0) {
                            combinedEvents.push({
                                date: pm.payment_date || (pm.created_at ? pm.created_at.split('T')[0] : new Date().toISOString().split('T')[0]),
                                description: `Payment Made (${pm.mode || pm.payment_mode || 'Cash'})`,
                                reference_id: pm.reference || pm.reference_number || `TXN-${pm.id}`,
                                debit: 0,
                                credit: amt,
                                raw_date: pm.created_at || pm.payment_date || '1970-01-01'
                            });
                        }
                    });
                } catch(e) {}

                // Fetch returns for this supplier
                try {
                    const returns = await db.prepare("SELECT * FROM business_returns WHERE user_id = ? AND (supplier_name = ? OR LOWER(supplier_name) = LOWER(?)) AND return_type = 'purchase' ORDER BY return_date ASC").all(req.user.id, supplier.name || '', supplier.name || '');
                    (returns || []).forEach(ret => {
                        const amt = parseFloat(ret.refund_amount || ret.total_amount || ret.amount || 0);
                        if (amt > 0) {
                            combinedEvents.push({
                                date: ret.return_date ? ret.return_date.split('T')[0] : new Date().toISOString().split('T')[0],
                                description: `Purchase Return #${ret.return_number || ret.id}`,
                                reference_id: ret.return_number || `RET-${ret.id}`,
                                debit: 0,
                                credit: amt,
                                raw_date: ret.created_at || ret.return_date || '1970-01-01'
                            });
                        }
                    });
                } catch(e) {}

                combinedEvents.sort((a, b) => new Date(a.raw_date || a.date) - new Date(b.raw_date || b.date));

                let runningBal = 0;
                ledgerRows = combinedEvents.map(evt => {
                    runningBal += (evt.debit - evt.credit);
                    return {
                        ...evt,
                        running_balance: runningBal,
                        balance: runningBal
                    };
                });
            } else {
                let runningBal = 0;
                ledgerRows = ledgerRows.map(row => {
                    const type = String(row.type || '').toLowerCase();
                    const amt = parseFloat(row.amount || 0);
                    const isDebit = type === 'debit' || type === 'bill' || type === 'purchase';
                    const debit = isDebit ? amt : (parseFloat(row.debit) || 0);
                    const credit = isDebit ? 0 : (parseFloat(row.credit) || amt);
                    runningBal += (debit - credit);
                    return {
                        id: row.id,
                        date: row.date || (row.created_at ? row.created_at.split('T')[0] : new Date().toISOString().split('T')[0]),
                        description: row.description || row.reference_id || 'Transaction',
                        reference_id: row.reference_id || `REF-${row.id}`,
                        debit,
                        credit,
                        running_balance: runningBal,
                        balance: runningBal
                    };
                });
            }

            return sendSuccess(res, ledgerRows, 'Ledger loaded successfully');
        } catch (error) {
            console.error('[Supplier Controller] Error loading ledger:', error);
            return sendError(res, 'Failed to load ledger', 500);
        }
    },

    getOutstanding: async (req, res) => {
        const { id } = req.params;
        try {
            const balance = await db.prepare('SELECT outstanding_balance FROM business_suppliers WHERE id = ? AND user_id = ?').get(id, req.user.id);
            return sendSuccess(res, balance, 'Outstanding balance loaded successfully');
        } catch (error) {
            return sendError(res, 'Failed to load outstanding balance', 500);
        }
    },

    getOutstandingList: async (req, res) => {
        try {
            const list = await db.prepare('SELECT id, name, company, outstanding_balance FROM business_suppliers WHERE user_id = ? AND outstanding_balance > 0').all(req.user.id);
            return sendSuccess(res, list, 'Outstanding list loaded successfully');
        } catch (error) {
            return sendError(res, 'Failed to load outstanding list', 500);
        }
    },

    // 8. Purchases, Payments, Returns per supplier
    getPurchases: async (req, res) => {
        const { id } = req.params;
        try {
            const supplier = await db.prepare('SELECT name FROM business_suppliers WHERE id = ? AND user_id = ?').get(id, req.user.id);
            if (!supplier) return sendError(res, 'Supplier not found', 404);

            const purchases = await db.prepare('SELECT * FROM business_purchases WHERE user_id = ? AND supplier_name = ? AND doc_type = \'BILL\'').all(req.user.id, supplier.name);
            return sendSuccess(res, purchases, 'Supplier purchases loaded successfully');
        } catch (error) {
            return sendError(res, 'Failed to load supplier purchases', 500);
        }
    },

    getPayments: async (req, res) => {
        const { id } = req.params;
        try {
            const payments = await db.prepare('SELECT * FROM supplier_payments WHERE supplier_id = ? AND user_id = ?').all(id, req.user.id);
            return sendSuccess(res, payments, 'Supplier payments loaded successfully');
        } catch (error) {
            return sendError(res, 'Failed to load supplier payments', 500);
        }
    },

    getReturns: async (req, res) => {
        const { id } = req.params;
        try {
            const supplier = await db.prepare('SELECT name FROM business_suppliers WHERE id = ? AND user_id = ?').get(id, req.user.id);
            if (!supplier) return sendError(res, 'Supplier not found', 404);

            const returns = await db.prepare('SELECT * FROM business_purchases WHERE user_id = ? AND supplier_name = ? AND doc_type = \'RETURN\'').all(req.user.id, supplier.name);
            return sendSuccess(res, returns, 'Supplier returns loaded successfully');
        } catch (error) {
            return sendError(res, 'Failed to load supplier returns', 500);
        }
    },

    // 9. Post Payments
    createPayment: async (req, res) => {
        const { id } = req.params;
        const { amount, payment_method, reference_number } = req.body;
        try {
            const result = await db.prepare(`
                INSERT INTO supplier_payments (supplier_id, user_id, amount, payment_method, reference_number, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
            `).run(id, req.user.id, amount, payment_method, reference_number || null, new Date().toISOString());

            // Update Supplier Balance
            await db.prepare('UPDATE business_suppliers SET outstanding_balance = outstanding_balance - ? WHERE id = ?').run(amount, id);

            // Log to Ledger
            await db.prepare(`
                INSERT INTO supplier_ledger (supplier_id, user_id, description, amount, type, created_at)
                VALUES (?, ?, ?, ?, 'credit', ?)
            `).run(id, req.user.id, `Payment made via ${payment_method}`, amount, new Date().toISOString());

            // Sync to accounting
            const normalizedMode = normalizePaymentMode(payment_method);
            const now = new Date().toISOString();
            const paymentId = result.lastInsertRowid;
            await db.prepare(`
                INSERT INTO accounting (user_id, entry_type, date, amount, category, mode, notes, status, created_at, updated_at)
                VALUES (?, 'expense', ?, ?, ?, ?, ?, 'posted', ?, ?)
            `).run(req.user.id, now.split('T')[0], amount, 'Supplier Payments', normalizedMode, `Supplier Payment #${paymentId}`, now, now);

            const created = await db.prepare('SELECT * FROM supplier_payments WHERE id = ?').get(result.lastInsertRowid);
            return sendSuccess(res, created, 'Payment registered successfully', 201);
        } catch (error) {
            return sendError(res, 'Failed to log payment', 500);
        }
    },

    getPaymentHistory: async (req, res) => {
        const { id } = req.params;
        try {
            const history = await db.prepare('SELECT * FROM supplier_payments WHERE supplier_id = ? AND user_id = ? ORDER BY created_at DESC').all(id, req.user.id);
            return sendSuccess(res, history, 'Payment history retrieved successfully');
        } catch (error) {
            return sendError(res, 'Failed to load payment history', 500);
        }
    },

    // 10. Address Management
    createAddress: async (req, res) => {
        const { id } = req.params;
        const { address_line1, address_line2, city, state, postal_code, country } = req.body;
        try {
            const result = await db.prepare(`
                INSERT INTO supplier_addresses (supplier_id, user_id, address_line1, address_line2, city, state, postal_code, country, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(id, req.user.id, address_line1, address_line2 || null, city, state, postal_code, country || 'India', new Date().toISOString());

            const created = await db.prepare('SELECT * FROM supplier_addresses WHERE id = ?').get(result.lastInsertRowid);
            return sendSuccess(res, created, 'Address added successfully', 201);
        } catch (error) {
            return sendError(res, 'Failed to add address', 500);
        }
    },

    updateAddress: async (req, res) => {
        const { id, addressId } = req.params;
        const { address_line1, address_line2, city, state, postal_code, country } = req.body;
        try {
            await db.prepare(`
                UPDATE supplier_addresses SET
                    address_line1 = ?, address_line2 = ?, city = ?, state = ?, postal_code = ?, country = ?
                WHERE id = ? AND supplier_id = ?
            `).run(address_line1, address_line2 || null, city, state, postal_code, country || 'India', addressId, id);

            const updated = await db.prepare('SELECT * FROM supplier_addresses WHERE id = ?').get(addressId);
            return sendSuccess(res, updated, 'Address updated successfully');
        } catch (error) {
            return sendError(res, 'Failed to update address', 500);
        }
    },

    // 11. Contacts Management
    createContact: async (req, res) => {
        const { id } = req.params;
        const { contact_name, email, phone, designation } = req.body;
        try {
            const result = await db.prepare(`
                INSERT INTO supplier_contacts (supplier_id, user_id, contact_name, email, phone, designation, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(id, req.user.id, contact_name, email || null, phone || null, designation || null, new Date().toISOString());

            const created = await db.prepare('SELECT * FROM supplier_contacts WHERE id = ?').get(result.lastInsertRowid);
            return sendSuccess(res, created, 'Contact added successfully', 201);
        } catch (error) {
            return sendError(res, 'Failed to add contact', 500);
        }
    },

    getContacts: async (req, res) => {
        const { id } = req.params;
        try {
            const contacts = await db.prepare('SELECT * FROM supplier_contacts WHERE supplier_id = ? AND user_id = ?').all(id, req.user.id);
            return sendSuccess(res, contacts, 'Contacts retrieved successfully');
        } catch (error) {
            return sendError(res, 'Failed to load contacts', 500);
        }
    },

    updateContact: async (req, res) => {
        const { id, contactId } = req.params;
        const { contact_name, email, phone, designation } = req.body;
        try {
            await db.prepare(`
                UPDATE supplier_contacts SET
                    contact_name = ?, email = ?, phone = ?, designation = ?
                WHERE id = ? AND supplier_id = ?
            `).run(contact_name, email || null, phone || null, designation || null, contactId, id);

            const updated = await db.prepare('SELECT * FROM supplier_contacts WHERE id = ?').get(contactId);
            return sendSuccess(res, updated, 'Contact updated successfully');
        } catch (error) {
            return sendError(res, 'Failed to update contact', 500);
        }
    },

    deleteContact: async (req, res) => {
        const { id, contactId } = req.params;
        try {
            await db.prepare('DELETE FROM supplier_contacts WHERE id = ? AND supplier_id = ?').run(contactId, id);
            return sendSuccess(res, null, 'Contact deleted successfully');
        } catch (error) {
            return sendError(res, 'Failed to delete contact', 500);
        }
    },

    // 12. Notes Management
    createNote: async (req, res) => {
        const { id } = req.params;
        const { note } = req.body;
        try {
            const result = await db.prepare(`
                INSERT INTO supplier_notes (supplier_id, user_id, note, created_at)
                VALUES (?, ?, ?, ?)
            `).run(id, req.user.id, note, new Date().toISOString());

            const created = await db.prepare('SELECT * FROM supplier_notes WHERE id = ?').get(result.lastInsertRowid);
            return sendSuccess(res, created, 'Note added successfully', 201);
        } catch (error) {
            return sendError(res, 'Failed to add note', 500);
        }
    },

    getNotes: async (req, res) => {
        const { id } = req.params;
        try {
            const notes = await db.prepare('SELECT * FROM supplier_notes WHERE supplier_id = ? AND user_id = ?').all(id, req.user.id);
            return sendSuccess(res, notes, 'Notes loaded successfully');
        } catch (error) {
            return sendError(res, 'Failed to load notes', 500);
        }
    },

    // 13. Documents Management
    createDocument: async (req, res) => {
        const { id } = req.params;
        const { file_name, file_url, file_size } = req.body;
        try {
            const result = await db.prepare(`
                INSERT INTO supplier_documents (supplier_id, user_id, file_name, file_url, file_size, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
            `).run(id, req.user.id, file_name, file_url || null, file_size || null, new Date().toISOString());

            const created = await db.prepare('SELECT * FROM supplier_documents WHERE id = ?').get(result.lastInsertRowid);
            return sendSuccess(res, created, 'Document attached successfully', 201);
        } catch (error) {
            return sendError(res, 'Failed to attach document', 500);
        }
    },

    getDocuments: async (req, res) => {
        const { id } = req.params;
        try {
            const docs = await db.prepare('SELECT * FROM supplier_documents WHERE supplier_id = ? AND user_id = ?').all(id, req.user.id);
            return sendSuccess(res, docs, 'Documents retrieved successfully');
        } catch (error) {
            return sendError(res, 'Failed to load documents', 500);
        }
    },

    // 14. Analytics & Reports
    getAnalytics: async (req, res) => {
        const { id } = req.params;
        try {
            const analytics = await db.prepare(`
                SELECT outstanding_balance, total_purchased
                FROM business_suppliers WHERE id = ? AND user_id = ?
            `).get(id, req.user.id);
            return sendSuccess(res, analytics, 'Analytics loaded successfully');
        } catch (error) {
            return sendError(res, 'Failed to load analytics', 500);
        }
    },

    getPurchasesReport: async (req, res) => {
        try {
            const report = await db.prepare(`
                SELECT supplier_name, COUNT(*) as count, COALESCE(SUM(grand_total), 0) as total
                FROM business_purchases WHERE user_id = ? AND doc_type = 'BILL'
                GROUP BY supplier_name
            `).all(req.user.id);
            return sendSuccess(res, report, 'Purchases report loaded successfully');
        } catch (error) {
            return sendError(res, 'Failed to load purchases report', 500);
        }
    },

    getBalanceReport: async (req, res) => {
        try {
            const report = await db.prepare(`
                SELECT name, company, outstanding_balance
                FROM business_suppliers WHERE user_id = ? AND outstanding_balance > 0
            `).all(req.user.id);
            return sendSuccess(res, report, 'Balance report loaded successfully');
        } catch (error) {
            return sendError(res, 'Failed to load balance report', 500);
        }
    },

    getTopSuppliersReport: async (req, res) => {
        try {
            const report = await db.prepare(`
                SELECT name, company, total_purchased
                FROM business_suppliers WHERE user_id = ?
                ORDER BY total_purchased DESC LIMIT 5
            `).all(req.user.id);
            return sendSuccess(res, report, 'Top suppliers report loaded successfully');
        } catch (error) {
            return sendError(res, 'Failed to load top suppliers report', 500);
        }
    },

    getPaymentsReport: async (req, res) => {
        try {
            const report = await db.prepare(`
                SELECT payment_method, COALESCE(SUM(amount), 0) as total
                FROM supplier_payments WHERE user_id = ?
                GROUP BY payment_method
            `).all(req.user.id);
            return sendSuccess(res, report, 'Payments report loaded successfully');
        } catch (error) {
            return sendError(res, 'Failed to load payments report', 500);
        }
    },

    // 15. Import / Export
    importSuppliers: async (req, res) => {
        const { suppliers } = req.body;
        if (!suppliers || !Array.isArray(suppliers)) {
            return sendError(res, 'Suppliers array is required', 400);
        }

        try {
            const now = new Date().toISOString();
            const importTx = db.transaction(async () => {
                const insertStmt = db.prepare(`
                    INSERT INTO business_suppliers (
                        user_id, name, email, phone, company, gstin, status, city, outstanding_balance, total_purchased, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)
                `);

                for (const item of suppliers) {
                    if (!item.name) {
                        throw new Error('Supplier name is required for all imported suppliers');
                    }
                    const cleanEmail = item.email ? String(item.email).trim().toLowerCase() : '';
                    if (!cleanEmail || !cleanEmail.endsWith('@bnxmail.com') || !/^[^\s@]+@bnxmail\.com$/.test(cleanEmail)) {
                        throw new Error(`Row "${item.name}": Email must use the @bnxmail.com domain.`);
                    }
                    await insertStmt.run(
                        req.user.id,
                        item.name,
                        item.email || null,
                        item.phone || null,
                        item.company || null,
                        item.gstin || null,
                        item.city || null,
                        item.outstanding_balance || 0,
                        item.total_purchased || 0,
                        now,
                        now
                    );
                }
                return suppliers.length;
            });

            const count = await importTx();
            return sendSuccess(res, { count }, `${count} suppliers imported successfully`);
        } catch (error) {
            console.error('[Supplier Controller] Error importing suppliers:', error);
            return sendError(res, error.message || 'Failed to import suppliers', 500);
        }
    },

    exportSuppliers: async (req, res) => {
        try {
            const data = await db.prepare('SELECT * FROM business_suppliers WHERE user_id = ?').all(req.user.id);
            return sendSuccess(res, data, 'Suppliers exported successfully');
        } catch (error) {
            return sendError(res, 'Failed to export suppliers', 500);
        }
    },

    // 16. History & Timelines
    getHistory: async (req, res) => {
        return sendSuccess(res, [], 'History loaded successfully');
    },

    getTimeline: async (req, res) => {
        return sendSuccess(res, [], 'Timeline loaded successfully');
    },

    // 17. Block / Unblock Actions
    blockSupplier: async (req, res) => {
        const { id } = req.params;
        try {
            await db.prepare('UPDATE business_suppliers SET status = \'blocked\' WHERE id = ?').run(id);
            return sendSuccess(res, { id, status: 'blocked' }, 'Supplier blocked successfully');
        } catch (error) {
            return sendError(res, 'Failed to block supplier', 500);
        }
    },

    unblockSupplier: async (req, res) => {
        const { id } = req.params;
        try {
            await db.prepare('UPDATE business_suppliers SET status = \'active\' WHERE id = ?').run(id);
            return sendSuccess(res, { id, status: 'active' }, 'Supplier unblocked successfully');
        } catch (error) {
            return sendError(res, 'Failed to unblock supplier', 500);
        }
    },

    // 18. Dashboard Summary
    getDashboardSummary: async (req, res) => {
        try {
            const summary = await db.prepare(`
                SELECT COUNT(*) as supplier_count, COALESCE(SUM(outstanding_balance), 0) as total_outflow
                FROM business_suppliers WHERE user_id = ?
            `).get(req.user.id);
            return sendSuccess(res, summary, 'Dashboard summary loaded successfully');
        } catch (error) {
            return sendError(res, 'Failed to load dashboard summary', 500);
        }
    },

    // 19. Dealer <-> Supplier Chat
    getChats: async (req, res) => {
        const { id } = req.params;
        const { purchase_id } = req.query;
        try {
            const chats = await supplierConnectionService.getSupplierChats({
                business_id: req.user.id,
                supplier_id: id,
                purchase_id: purchase_id ? parseInt(purchase_id) : null
            });
            return sendSuccess(res, chats, 'Supplier chat messages loaded');
        } catch (error) {
            return sendError(res, error.message || 'Failed to load chat messages', 500);
        }
    },

    sendChatMessage: async (req, res) => {
        const { id } = req.params;
        const { message, purchase_id, sender_type } = req.body;
        try {
            // Resolve business_id and supplier_id from connection if called from supplier portal
            let businessId = req.user.id;
            let resolvedSupplierId = id;
            const senderRole = sender_type || 'dealer';
            try {
                const conn = await require('../db/connection').prepare(
                    'SELECT business_id, supplier_id FROM supplier_connections WHERE id = ? OR (supplier_id = ? AND supplier_user_id = ?)'
                ).get(id, id, req.user.id);
                if (conn) {
                    businessId = conn.business_id;
                    resolvedSupplierId = conn.supplier_id;
                }
            } catch(e) {}

            const senderName = senderRole === 'supplier'
                ? (req.user.business_name || req.user.username || 'Supplier')
                : (req.user.business_name || req.user.username || 'Dealer');

            const created = await supplierConnectionService.sendSupplierChatMessage({
                business_id: businessId,
                supplier_id: resolvedSupplierId,
                purchase_id: purchase_id ? parseInt(purchase_id) : null,
                sender_type: senderRole,
                sender_id: req.user.id,
                sender_name: senderName,
                message
            });
            return sendSuccess(res, created, 'Message sent successfully', 201);
        } catch (error) {
            return sendError(res, error.message || 'Failed to send chat message', 400);
        }
    },

    // 20. Website Supplier Portal Integration
    getPortalIntegrations: async (req, res) => {
        try {
            const integrations = await supplierConnectionService.getWebsiteSupplierIntegrations(req.user.id, req.user.email);
            return sendSuccess(res, integrations, 'Supplier connection integrations retrieved');
        } catch (error) {
            return sendError(res, error.message || 'Failed to retrieve supplier integrations', 500);
        }
    },

    getConnectionRequests: async (req, res) => {
        return supplierController.getPortalIntegrations(req, res);
    },

    respondPortalIntegration: async (req, res) => {
        const { id } = req.params;
        const { action } = req.body;
        try {
            const updated = await supplierConnectionService.respondToSupplierIntegrationRequest({
                website_user_id: req.user.id,
                website_user_email: req.user.email,
                connection_id: id,
                action
            });
            return sendSuccess(res, updated, `Supplier connection ${action}ed successfully`);
        } catch (error) {
            return sendError(res, error.message || 'Failed to respond to supplier connection', 400);
        }
    },

    respondConnectionRequest: async (req, res) => {
        return supplierController.respondPortalIntegration(req, res);
    },

    getPurchaseRequests: async (req, res) => {
        const purchaseController = require('./purchaseController');
        return purchaseController.getSupplierPortalOrders(req, res);
    },

    getPurchaseRequestById: async (req, res) => {
        const purchaseController = require('./purchaseController');
        return purchaseController.getPurchaseById(req, res);
    },

    confirmPurchaseOrder: async (req, res) => {
        const purchaseController = require('./purchaseController');
        return purchaseController.confirmSupplierPurchase(req, res);
    },

    getChatMessages: async (req, res) => {
        const supplierId = req.params.supplierId || req.params.id;
        const { purchase_id } = req.query;
        try {
            // Resolve business_id and supplier_id from connection if called from supplier portal
            let businessId = null;
            let resolvedSupplierId = supplierId;
            try {
                const conn = await require('../db/connection').prepare(
                    'SELECT business_id, supplier_id FROM supplier_connections WHERE id = ? OR (supplier_id = ? AND supplier_user_id = ?)'
                ).get(supplierId, supplierId, req.user.id);
                if (conn) {
                    businessId = conn.business_id;
                    resolvedSupplierId = conn.supplier_id;
                }
            } catch(e) {}

            const chats = await supplierConnectionService.getSupplierChats({
                business_id: businessId || req.user.id,
                supplier_id: resolvedSupplierId,
                purchase_id: purchase_id ? parseInt(purchase_id) : null
            });
            return sendSuccess(res, chats, 'Supplier chat messages loaded');
        } catch (error) {
            return sendError(res, error.message || 'Failed to load chat messages', 500);
        }
    },

    createB2BSupplierRequest: async (req, res) => {
        try {
            const b2bConnectionService = require('../utils/b2bConnectionService');
            const { supplier_email, supplier_name } = req.body;
            if (!supplier_email) {
                return sendError(res, 'Supplier email is required', 400);
            }

            const emailLower = String(supplier_email).trim().toLowerCase();
            if (!emailLower.endsWith('@bnxmail.com')) {
                return sendError(res, 'Only @bnxmail.com business emails are allowed.', 400);
            }

            const connection = await b2bConnectionService.createOrUpdateConnection({
                requester_user_id: req.user.id,
                supplier_email: emailLower,
                supplier_name: supplier_name || 'Supplier Partner',
                isStrict: true
            });

            return sendSuccess(res, connection, 'Supplier connection request created successfully', 201);
        } catch (error) {
            console.error('[B2B Create Request Error]', error);
            return sendError(res, error.message || 'Failed to create B2B connection request', error.statusCode || 500);
        }
    },

    // Delegate supplier portal order methods to purchaseController
    confirmPurchaseOrder: async (req, res) => {
        const purchaseController = require('./purchaseController');
        return purchaseController.confirmSupplierPurchase(req, res);
    },

    getPurchaseRequests: async (req, res) => {
        const purchaseController = require('./purchaseController');
        return purchaseController.getSupplierPortalOrders(req, res);
    },

    getPurchaseRequestById: async (req, res) => {
        const purchaseController = require('./purchaseController');
        return purchaseController.getSupplierPortalOrders(req, res);
    }
};

module.exports = supplierController;
