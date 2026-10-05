const fs = require('fs');
const path = '/Users/hi/Desktop/Cliks/CLIKS-BE/controllers/productController.js';
let content = fs.readFileSync(path, 'utf8');

// Replace in INSERT block
const targetInsert1 = `damaged_stock, expired_stock, is_perishable, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, 'active', 'In Stock', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
const replaceInsert1 = `damaged_stock, expired_stock, is_perishable, rack_number, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, 'active', 'In Stock', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

const targetInsertParams1 = `resolvedHsn, finalHasWarranty, finalWarrantyPeriod, min_stock || 0, reorder_level || 0, damaged_stock || 0, expired_stock || 0, is_perishable ? 1 : 0, now, now`;
const replaceInsertParams1 = `resolvedHsn, finalHasWarranty, finalWarrantyPeriod, min_stock || 0, reorder_level || 0, damaged_stock || 0, expired_stock || 0, is_perishable ? 1 : 0, req.body.rack_number || null, now, now`;

// Replace in UPDATE block
const targetUpdate1 = `expired_stock = ?,
                    is_perishable = ?,
                    updated_at = ?
                WHERE id = ? AND user_id = ?`;
const replaceUpdate1 = `expired_stock = ?,
                    is_perishable = ?,
                    rack_number = ?,
                    updated_at = ?
                WHERE id = ? AND user_id = ?`;

const targetUpdateParams1 = `expired_stock || 0,
                    is_perishable ? 1 : 0,
                    now,
                    id,
                    req.user.id`;
const replaceUpdateParams1 = `expired_stock || 0,
                    is_perishable ? 1 : 0,
                    req.body.rack_number || null,
                    now,
                    id,
                    req.user.id`;

if (content.includes(targetInsert1) && content.includes(targetUpdate1)) {
    content = content.replace(targetInsert1, replaceInsert1);
    content = content.replace(targetInsertParams1, replaceInsertParams1);
    content = content.replace(targetUpdate1, replaceUpdate1);
    content = content.replace(targetUpdateParams1, replaceUpdateParams1);
    // There are duplicate fallback blocks in insert due to catch fallback
    content = content.replace(targetInsert1, replaceInsert1);
    content = content.replace(targetInsertParams1, replaceInsertParams1);
    
    // There is also a secondary fallback in insert
    const targetFallbackInsert = `damaged_stock, expired_stock, is_perishable, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, 'active', 'In Stock', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    const replaceFallbackInsert = `damaged_stock, expired_stock, is_perishable, rack_number, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, 'active', 'In Stock', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    const targetFallbackParams = `resolvedHsn, min_stock || 0, reorder_level || 0, damaged_stock || 0, expired_stock || 0, is_perishable ? 1 : 0, now, now`;
    const replaceFallbackParams = `resolvedHsn, min_stock || 0, reorder_level || 0, damaged_stock || 0, expired_stock || 0, is_perishable ? 1 : 0, req.body.rack_number || null, now, now`;
    
    if (content.includes(targetFallbackInsert)) {
        content = content.replace(targetFallbackInsert, replaceFallbackInsert);
        content = content.replace(targetFallbackParams, replaceFallbackParams);
    }
    
    fs.writeFileSync(path, content);
    console.log('Successfully updated productController.js for rack_number');
} else {
    console.log('Could not find target strings in productController.js');
}
