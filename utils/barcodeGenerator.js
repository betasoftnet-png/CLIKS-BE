/**
 * GS1 Standard EAN-13 Barcode Generator & Auto-Assign Utility
 * Designed for Supermarkets, POS terminals, and Barcode Label Printing.
 */

/**
 * Calculates standard GS1 Modulo-10 checksum digit for a 12-digit numeric string
 */
function calculateEan13Checksum(first12Digits) {
    const str = String(first12Digits).replace(/\D/g, '').padStart(12, '0').slice(-12);
    let sum = 0;
    for (let i = 0; i < 12; i++) {
        const digit = parseInt(str[i], 10);
        sum += (i % 2 === 0) ? digit : digit * 3;
    }
    const rem = sum % 10;
    return rem === 0 ? 0 : 10 - rem;
}

/**
 * Generates a deterministic, unique 13-digit EAN-13 barcode from product ID and user ID
 * Format: 890 (prefix) + 2 digits (user % 100) + 7 digits (productId) + 1 digit (checksum)
 */
function generateEan13FromId(productId, userId = 1, prefix = '890') {
    const cleanPrefix = String(prefix || '890').slice(0, 3);
    const userPart = String(Math.abs(parseInt(userId, 10) || 1) % 100).padStart(2, '0');
    const prodPart = String(Math.abs(parseInt(productId, 10) || 1)).padStart(7, '0').slice(-7);
    const first12 = `${cleanPrefix}${userPart}${prodPart}`;
    const check = calculateEan13Checksum(first12);
    return `${first12}${check}`;
}

/**
 * Generates a unique 13-digit EAN-13 barcode using timestamp and random entropy
 * Format: 890 + 9 digits of timestamp/entropy + checksum
 */
function generateUniqueEan13Barcode(prefix = '890') {
    const cleanPrefix = String(prefix || '890').slice(0, 3);
    const nowStr = Date.now().toString().slice(-7);
    const randPart = Math.floor(10 + Math.random() * 90).toString();
    const first12 = `${cleanPrefix}${nowStr}${randPart}`;
    const check = calculateEan13Checksum(first12);
    return `${first12}${check}`;
}

/**
 * Backfills missing barcodes for all existing products in the database
 */
async function backfillMissingBarcodes(db, targetUserId = null) {
    if (!db) return { updatedCount: 0 };

    try {
        let selectQuery = "SELECT id, user_id, name, sku, barcode FROM business_products WHERE barcode IS NULL OR TRIM(barcode) = ''";
        const params = [];
        if (targetUserId) {
            selectQuery += " AND user_id = ?";
            params.push(targetUserId);
        }

        const missing = await db.prepare(selectQuery).all(...params);
        if (!missing || missing.length === 0) {
            return { updatedCount: 0, products: [] };
        }

        const updatedProducts = [];
        for (const prod of missing) {
            const newBarcode = generateEan13FromId(prod.id, prod.user_id || targetUserId || 1);
            
            // Update business_products
            await db.prepare("UPDATE business_products SET barcode = ? WHERE id = ?").run(newBarcode, prod.id);

            // Sync to inventory if matching name or sku
            try {
                await db.prepare("UPDATE inventory SET barcode = ? WHERE (barcode IS NULL OR TRIM(barcode) = '') AND (sku = ? OR LOWER(name) = LOWER(?))").run(newBarcode, prod.sku || '', prod.name || '');
            } catch (_) {}

            // Sync to stock if matching name or sku
            try {
                await db.prepare("UPDATE stock SET barcode = ? WHERE (barcode IS NULL OR TRIM(barcode) = '') AND (sku = ? OR LOWER(name) = LOWER(?))").run(newBarcode, prod.sku || '', prod.name || '');
            } catch (_) {}

            updatedProducts.push({
                id: prod.id,
                name: prod.name,
                sku: prod.sku,
                barcode: newBarcode
            });
        }

        console.log(`[Barcode Generator] Successfully backfilled barcodes for ${updatedProducts.length} existing products.`);
        return {
            updatedCount: updatedProducts.length,
            products: updatedProducts
        };
    } catch (err) {
        console.error('[Barcode Generator] Error backfilling barcodes:', err);
        return { updatedCount: 0, error: err.message };
    }
}

module.exports = {
    calculateEan13Checksum,
    generateEan13FromId,
    generateUniqueEan13Barcode,
    backfillMissingBarcodes
};
