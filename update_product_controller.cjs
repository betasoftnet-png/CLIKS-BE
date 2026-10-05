const fs = require('fs');
const path = '/Users/hi/Desktop/Cliks/CLIKS-BE/controllers/productController.js';
let content = fs.readFileSync(path, 'utf8');

// Update createProduct extraction
const createExtractTarget = `            const { name, sku, category, unit, quantity, low_stock_threshold, purchase_price, selling_price, barcode, serial_number, batch_number, expiry_date, tax_percentage, warehouse_id, hsn_code, has_warranty, warranty_period, min_stock, reorder_level, damaged_stock, expired_stock } = req.body;`;
const createExtractReplace = `            const { name, sku, category, unit, quantity, low_stock_threshold, purchase_price, selling_price, barcode, serial_number, batch_number, expiry_date, tax_percentage, warehouse_id, hsn_code, has_warranty, warranty_period, min_stock, reorder_level, damaged_stock, expired_stock, is_perishable } = req.body;`;
content = content.replace(createExtractTarget, createExtractReplace);

// Replace insert 1 (lines 30-40)
const insert1Target = `                        user_id, name, sku, category, unit, status, stock_status, quantity, low_stock_threshold,
                        purchase_price, selling_price, barcode, serial_number, batch_number, expiry_date,
                        tax_percentage, warehouse_id, hsn_code, has_warranty, warranty_period, min_stock, reorder_level, damaged_stock, expired_stock, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, 'active', 'In Stock', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                \`).run(
                    req.user.id, name, sku || null, category || null, unit || 'PCS', quantity || 0, low_stock_threshold || 5,
                    purchase_price || 0, selling_price || 0, barcode || null, serial_number || null,
                    batch_number || null, expiry_date || null, tax_percentage || 18, warehouse_id || null,
                    resolvedHsn, finalHasWarranty, finalWarrantyPeriod, min_stock || 0, reorder_level || 0, damaged_stock || 0, expired_stock || 0, now, now
                );`;
const insert1Replace = `                        user_id, name, sku, category, unit, status, stock_status, quantity, low_stock_threshold,
                        purchase_price, selling_price, barcode, serial_number, batch_number, expiry_date,
                        tax_percentage, warehouse_id, hsn_code, has_warranty, warranty_period, min_stock, reorder_level, damaged_stock, expired_stock, is_perishable, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, 'active', 'In Stock', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                \`).run(
                    req.user.id, name, sku || null, category || null, unit || 'PCS', quantity || 0, low_stock_threshold || 5,
                    purchase_price || 0, selling_price || 0, barcode || null, serial_number || null,
                    batch_number || null, expiry_date || null, tax_percentage || 18, warehouse_id || null,
                    resolvedHsn, finalHasWarranty, finalWarrantyPeriod, min_stock || 0, reorder_level || 0, damaged_stock || 0, expired_stock || 0, is_perishable ? 1 : 0, now, now
                );`;
content = content.replace(insert1Target, insert1Replace);

// Replace insert 2 (lines 48-58)
const insert2Target = `                            user_id, name, sku, category, unit, status, stock_status, quantity, low_stock_threshold,
                            purchase_price, selling_price, barcode, serial_number, batch_number, expiry_date,
                            tax_percentage, warehouse_id, hsn_code, has_warranty, warranty_period, min_stock, reorder_level, damaged_stock, expired_stock, created_at, updated_at
                        ) VALUES (?, ?, ?, ?, ?, 'active', 'In Stock', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    \`).run(
                        req.user.id, name, sku || null, category || null, unit || 'PCS', quantity || 0, low_stock_threshold || 5,
                        purchase_price || 0, selling_price || 0, barcode || null, serial_number || null,
                        batch_number || null, expiry_date || null, tax_percentage || 18, warehouse_id || null,
                        resolvedHsn, finalHasWarranty, finalWarrantyPeriod, min_stock || 0, reorder_level || 0, damaged_stock || 0, expired_stock || 0, now, now
                    );`;
const insert2Replace = `                            user_id, name, sku, category, unit, status, stock_status, quantity, low_stock_threshold,
                            purchase_price, selling_price, barcode, serial_number, batch_number, expiry_date,
                            tax_percentage, warehouse_id, hsn_code, has_warranty, warranty_period, min_stock, reorder_level, damaged_stock, expired_stock, is_perishable, created_at, updated_at
                        ) VALUES (?, ?, ?, ?, ?, 'active', 'In Stock', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    \`).run(
                        req.user.id, name, sku || null, category || null, unit || 'PCS', quantity || 0, low_stock_threshold || 5,
                        purchase_price || 0, selling_price || 0, barcode || null, serial_number || null,
                        batch_number || null, expiry_date || null, tax_percentage || 18, warehouse_id || null,
                        resolvedHsn, finalHasWarranty, finalWarrantyPeriod, min_stock || 0, reorder_level || 0, damaged_stock || 0, expired_stock || 0, is_perishable ? 1 : 0, now, now
                    );`;
content = content.replace(insert2Target, insert2Replace);

// Replace insert 3 (lines 72-82)
const insert3Target = `                        user_id, name, sku, category, unit, status, stock_status, quantity, low_stock_threshold,
                        purchase_price, selling_price, barcode, serial_number, batch_number, expiry_date,
                        tax_percentage, warehouse_id, hsn_code, min_stock, reorder_level, damaged_stock, expired_stock, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, 'active', 'In Stock', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                \`).run(
                    req.user.id, name, sku || null, category || null, unit || 'PCS', quantity || 0, low_stock_threshold || 5,
                    purchase_price || 0, selling_price || 0, barcode || null, serial_number || null,
                    batch_number || null, expiry_date || null, tax_percentage || 18, warehouse_id || null,
                    resolvedHsn, min_stock || 0, reorder_level || 0, damaged_stock || 0, expired_stock || 0, now, now
                );`;
const insert3Replace = `                        user_id, name, sku, category, unit, status, stock_status, quantity, low_stock_threshold,
                        purchase_price, selling_price, barcode, serial_number, batch_number, expiry_date,
                        tax_percentage, warehouse_id, hsn_code, min_stock, reorder_level, damaged_stock, expired_stock, is_perishable, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, 'active', 'In Stock', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                \`).run(
                    req.user.id, name, sku || null, category || null, unit || 'PCS', quantity || 0, low_stock_threshold || 5,
                    purchase_price || 0, selling_price || 0, barcode || null, serial_number || null,
                    batch_number || null, expiry_date || null, tax_percentage || 18, warehouse_id || null,
                    resolvedHsn, min_stock || 0, reorder_level || 0, damaged_stock || 0, expired_stock || 0, is_perishable ? 1 : 0, now, now
                );`;
content = content.replace(insert3Target, insert3Replace);

// Update product update extraction
const updateExtractTarget = `            const { name, sku, category, unit, status, quantity, low_stock_threshold, purchase_price, selling_price, barcode, serial_number, batch_number, expiry_date, tax_percentage, warehouse_id, hsn_code, has_warranty, warranty_period, min_stock, reorder_level, damaged_stock, expired_stock } = req.body;`;
const updateExtractReplace = `            const { name, sku, category, unit, status, quantity, low_stock_threshold, purchase_price, selling_price, barcode, serial_number, batch_number, expiry_date, tax_percentage, warehouse_id, hsn_code, has_warranty, warranty_period, min_stock, reorder_level, damaged_stock, expired_stock, is_perishable } = req.body;`;
content = content.replace(updateExtractTarget, updateExtractReplace);

const updateQueryTarget = `                    purchase_price = ?, selling_price = ?, barcode = ?, serial_number = ?, batch_number = ?, expiry_date = ?, tax_percentage = ?, warehouse_id = ?, hsn_code = ?, has_warranty = ?, warranty_period = ?, min_stock = ?, reorder_level = ?, damaged_stock = ?, expired_stock = ?, updated_at = ?
                WHERE id = ? AND user_id = ?
            \`).run(
                name || existing.name, sku || null, category || null, unit || 'PCS', status || existing.status, newQuantity, low_stock_threshold || 5,
                purchase_price || 0, selling_price || 0, barcode || null, serial_number || null, batch_number || null, expiry_date || null, tax_percentage || 18, warehouse_id || null, resolvedHsn, finalHasWarranty, finalWarrantyPeriod, min_stock || 0, reorder_level || 0, damaged_stock !== undefined ? damaged_stock : existing.damaged_stock, expired_stock !== undefined ? expired_stock : existing.expired_stock, new Date().toISOString(),
                id, req.user.id
            );`;
const updateQueryReplace = `                    purchase_price = ?, selling_price = ?, barcode = ?, serial_number = ?, batch_number = ?, expiry_date = ?, tax_percentage = ?, warehouse_id = ?, hsn_code = ?, has_warranty = ?, warranty_period = ?, min_stock = ?, reorder_level = ?, damaged_stock = ?, expired_stock = ?, is_perishable = ?, updated_at = ?
                WHERE id = ? AND user_id = ?
            \`).run(
                name || existing.name, sku || null, category || null, unit || 'PCS', status || existing.status, newQuantity, low_stock_threshold || 5,
                purchase_price || 0, selling_price || 0, barcode || null, serial_number || null, batch_number || null, expiry_date || null, tax_percentage || 18, warehouse_id || null, resolvedHsn, finalHasWarranty, finalWarrantyPeriod, min_stock || 0, reorder_level || 0, damaged_stock !== undefined ? damaged_stock : existing.damaged_stock, expired_stock !== undefined ? expired_stock : existing.expired_stock, is_perishable !== undefined ? (is_perishable ? 1 : 0) : existing.is_perishable, new Date().toISOString(),
                id, req.user.id
            );`;
content = content.replace(updateQueryTarget, updateQueryReplace);

const updateQueryFallbackTarget = `                    purchase_price = ?, selling_price = ?, barcode = ?, serial_number = ?, batch_number = ?, expiry_date = ?, tax_percentage = ?, warehouse_id = ?, hsn_code = ?, min_stock = ?, reorder_level = ?, damaged_stock = ?, expired_stock = ?, updated_at = ?
                WHERE id = ? AND user_id = ?
            \`).run(
                name || existing.name, sku || null, category || null, unit || 'PCS', status || existing.status, newQuantity, low_stock_threshold || 5,
                purchase_price || 0, selling_price || 0, barcode || null, serial_number || null, batch_number || null, expiry_date || null, tax_percentage || 18, warehouse_id || null, resolvedHsn, min_stock || 0, reorder_level || 0, damaged_stock !== undefined ? damaged_stock : existing.damaged_stock, expired_stock !== undefined ? expired_stock : existing.expired_stock, new Date().toISOString(),
                id, req.user.id
            );`;
const updateQueryFallbackReplace = `                    purchase_price = ?, selling_price = ?, barcode = ?, serial_number = ?, batch_number = ?, expiry_date = ?, tax_percentage = ?, warehouse_id = ?, hsn_code = ?, min_stock = ?, reorder_level = ?, damaged_stock = ?, expired_stock = ?, is_perishable = ?, updated_at = ?
                WHERE id = ? AND user_id = ?
            \`).run(
                name || existing.name, sku || null, category || null, unit || 'PCS', status || existing.status, newQuantity, low_stock_threshold || 5,
                purchase_price || 0, selling_price || 0, barcode || null, serial_number || null, batch_number || null, expiry_date || null, tax_percentage || 18, warehouse_id || null, resolvedHsn, min_stock || 0, reorder_level || 0, damaged_stock !== undefined ? damaged_stock : existing.damaged_stock, expired_stock !== undefined ? expired_stock : existing.expired_stock, is_perishable !== undefined ? (is_perishable ? 1 : 0) : existing.is_perishable, new Date().toISOString(),
                id, req.user.id
            );`;
content = content.replace(updateQueryFallbackTarget, updateQueryFallbackReplace);

fs.writeFileSync(path, content);
console.log('productController.js updated');
