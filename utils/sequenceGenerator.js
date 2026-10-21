const db = require('../db/connection');

/**
 * Initializes the document sequences table in SQLite/PostgreSQL
 */
async function initSequenceSchema() {
    try {
        await db.prepare(`
            CREATE TABLE IF NOT EXISTS app_document_sequences (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                branch_id INTEGER DEFAULT NULL,
                doc_type TEXT NOT NULL,
                prefix TEXT NOT NULL,
                current_number INTEGER NOT NULL DEFAULT 0,
                padding INTEGER NOT NULL DEFAULT 6,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_id, doc_type, prefix)
            )
        `).run();

        await db.prepare(`
            CREATE INDEX IF NOT EXISTS idx_doc_seq_lookup 
            ON app_document_sequences(user_id, doc_type, prefix)
        `).run();
    } catch (e) {
        console.warn('[SequenceGenerator] Schema init note:', e.message);
    }
}

// Auto-run schema initialization
initSequenceSchema();

/**
 * Normalize prefix to ensure consistent formatting (e.g. 'POS' -> 'POS-', 'INV' -> 'INV-')
 */
function normalizePrefix(prefix, defaultPrefix = 'INV-') {
    if (!prefix || typeof prefix !== 'string') return defaultPrefix;
    let clean = prefix.trim().toUpperCase();
    if (!clean.endsWith('-') && !clean.endsWith('/') && !clean.endsWith('.')) {
        clean = `${clean}-`;
    }
    return clean;
}

/**
 * Checks if a specific candidate number is already in use in the database
 */
async function isNumberTaken(userId, docType, candidate) {
    try {
        if (docType === 'INVOICE' || docType === 'POS' || docType === 'ESTIMATE' || docType === 'PROFORMA') {
            const row = await db.prepare('SELECT id FROM business_invoices WHERE user_id = ? AND invoice_number = ?').get(userId, candidate);
            return !!row;
        } else if (docType === 'PURCHASE') {
            const row = await db.prepare('SELECT id FROM business_purchases WHERE user_id = ? AND purchase_number = ?').get(userId, candidate);
            return !!row;
        } else if (docType === 'ORDER') {
            const row = await db.prepare('SELECT id FROM business_orders WHERE user_id = ? AND order_number = ?').get(userId, candidate);
            return !!row;
        } else if (docType === 'GST') {
            const row = await db.prepare('SELECT id FROM gst_invoices WHERE invoice_number = ?').get(candidate);
            return !!row;
        } else if (docType === 'RETURN') {
            const row = await db.prepare('SELECT id FROM business_returns WHERE user_id = ? AND return_number = ?').get(userId, candidate);
            return !!row;
        }
    } catch (e) {}
    return false;
}

/**
 * Atomically generates and returns the next zero-padded, monotonic sequence number.
 * e.g., POS-000001, POS-000002, TMB-000001, INV-000001
 * 
 * @param {Object} options
 * @param {number} options.userId - User ID
 * @param {number|null} options.branchId - Optional showroom branch ID
 * @param {string} options.docType - 'POS', 'INVOICE', 'PURCHASE', 'GST', 'ORDER', 'RETURN', etc.
 * @param {string} options.prefix - Prefix like 'POS-', 'INV-', 'PO-', 'GST-', etc.
 * @param {number} [options.padding=6] - Number of digits to pad (default 6)
 * @returns {Promise<string>} The formatted document sequence string
 */
async function getNextSequence({ userId, branchId = null, docType = 'INVOICE', prefix = 'INV-', padding = 6 }) {
    if (!userId) {
        throw new Error('[SequenceGenerator] userId is required to generate sequence');
    }

    const normPrefix = normalizePrefix(prefix, `${docType.toUpperCase()}-`);
    const cleanDocType = (docType || 'INVOICE').toUpperCase();
    const padLength = parseInt(padding, 10) || 6;

    await initSequenceSchema();

    try {
        const row = await db.prepare(`
            INSERT INTO app_document_sequences (
                user_id, branch_id, doc_type, prefix, current_number, padding, updated_at
            ) VALUES (?, ?, ?, ?, 1, ?, datetime('now'))
            ON CONFLICT(user_id, doc_type, prefix)
            DO UPDATE SET 
                current_number = current_number + 1,
                updated_at = datetime('now')
            RETURNING current_number, padding
        `).get(userId, branchId, cleanDocType, normPrefix, padLength);

        if (row && row.current_number !== undefined) {
            let curNum = row.current_number;
            let pad = row.padding || padLength;
            let candidate = `${normPrefix}${String(curNum).padStart(pad, '0')}`;

            // Collision check: if candidate already exists in database, skip to next available
            while (await isNumberTaken(userId, cleanDocType, candidate)) {
                curNum++;
                await db.prepare('UPDATE app_document_sequences SET current_number = ?, updated_at = datetime(\'now\') WHERE user_id = ? AND doc_type = ? AND prefix = ?').run(curNum, userId, cleanDocType, normPrefix);
                candidate = `${normPrefix}${String(curNum).padStart(pad, '0')}`;
            }

            return candidate;
        }
    } catch (err) {
        console.error('[SequenceGenerator] Error in atomic getNextSequence:', err.message);
    }

    // Fallback if RETURNING had an issue or older dialect
    try {
        const existing = await db.prepare(`
            SELECT id, current_number, padding FROM app_document_sequences 
            WHERE user_id = ? AND doc_type = ? AND prefix = ?
        `).get(userId, cleanDocType, normPrefix);

        if (existing) {
            const nextVal = (existing.current_number || 0) + 1;
            await db.prepare(`
                UPDATE app_document_sequences 
                SET current_number = ?, updated_at = datetime('now') 
                WHERE id = ?
            `).run(nextVal, existing.id);
            const numStr = String(nextVal).padStart(existing.padding || padLength, '0');
            return `${normPrefix}${numStr}`;
        } else {
            await db.prepare(`
                INSERT INTO app_document_sequences (user_id, branch_id, doc_type, prefix, current_number, padding, updated_at)
                VALUES (?, ?, ?, ?, 1, ?, datetime('now'))
            `).run(userId, branchId, cleanDocType, normPrefix, padLength);
            const numStr = String(1).padStart(padLength, '0');
            return `${normPrefix}${numStr}`;
        }
    } catch (fallbackErr) {
        console.error('[SequenceGenerator] Fallback error:', fallbackErr.message);
        // Absolute fallback to timestamp if database is locked or corrupted
        return `${normPrefix}${Date.now().toString().slice(-6)}`;
    }
}

/**
 * Peeks what the next sequence number will be without incrementing.
 * Used for UI form placeholders and preview labels.
 */
async function peekNextSequence({ userId, branchId = null, docType = 'INVOICE', prefix = 'INV-', padding = 6 }) {
    if (!userId) return `${normalizePrefix(prefix)}000001`;

    const normPrefix = normalizePrefix(prefix, `${docType.toUpperCase()}-`);
    const cleanDocType = (docType || 'INVOICE').toUpperCase();
    const padLength = parseInt(padding, 10) || 6;

    try {
        await initSequenceSchema();
        const row = await db.prepare(`
            SELECT current_number, padding FROM app_document_sequences 
            WHERE user_id = ? AND doc_type = ? AND prefix = ?
        `).get(userId, cleanDocType, normPrefix);

        const nextNum = row ? ((row.current_number || 0) + 1) : 1;
        const pad = row?.padding || padLength;
        return `${normPrefix}${String(nextNum).padStart(pad, '0')}`;
    } catch (e) {
        console.warn('[SequenceGenerator] Error peeking sequence:', e.message);
        return `${normPrefix}000001`;
    }
}

/**
 * Synchronizes/sets the sequence counter for a specific prefix if records already exist.
 */
async function setSequenceCounter({ userId, branchId = null, docType = 'INVOICE', prefix = 'INV-', currentNumber = 0, padding = 6 }) {
    if (!userId) return;
    const normPrefix = normalizePrefix(prefix, `${docType.toUpperCase()}-`);
    const cleanDocType = (docType || 'INVOICE').toUpperCase();
    const padLength = parseInt(padding, 10) || 6;

    await initSequenceSchema();

    await db.prepare(`
        INSERT INTO app_document_sequences (
            user_id, branch_id, doc_type, prefix, current_number, padding, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(user_id, doc_type, prefix)
        DO UPDATE SET 
            current_number = ?,
            padding = ?,
            updated_at = datetime('now')
    `).run(userId, branchId, cleanDocType, normPrefix, currentNumber, padLength, currentNumber, padLength);
}

module.exports = {
    initSequenceSchema,
    normalizePrefix,
    getNextSequence,
    peekNextSequence,
    setSequenceCounter
};
