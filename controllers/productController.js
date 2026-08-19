const db = require('../db/connection');
const { sendSuccess, sendError } = require('../utils/response');

const productController = {
    // 1. Create Product
    createProduct: async (req, res) => {
        const { name, sku, category, unit, quantity, low_stock_threshold, purchase_price, selling_price, barcode, serial_number, batch_number, expiry_date, tax_percentage, warehouse_id, hsn_code, hsn_sac, hsn } = req.body;
        if (!name) return sendError(res, 'Product name is required', 400);
        const resolvedHsn = hsn_code || hsn_sac || hsn || null;

        try {
            const now = new Date().toISOString();
            const result = await db.prepare(`
                INSERT INTO business_products (
                    user_id, name, sku, category, unit, status, stock_status, quantity, low_stock_threshold,
                    purchase_price, selling_price, barcode, serial_number, batch_number, expiry_date,
                    tax_percentage, warehouse_id, hsn_code, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, 'active', 'In Stock', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                req.user.id, name, sku || null, category || null, unit || 'PCS', quantity || 0, low_stock_threshold || 5,
                purchase_price || 0, selling_price || 0, barcode || null, serial_number || null,
                batch_number || null, expiry_date || null, tax_percentage || 18, warehouse_id || 'Main Godown',
                resolvedHsn, now, now
            );

            const created = await db.prepare('SELECT * FROM business_products WHERE id = ?').get(result.lastInsertRowid);
            return sendSuccess(res, created, 'Product created successfully', 201);
        } catch (error) {
            console.error('[Product Controller] Error creating product:', error);
            return sendError(res, 'Failed to create product', 500);
        }
    },

    // 2. Get Products with dynamic Filters
    getProducts: async (req, res) => {
        const { search, category, status, stock_status, warehouse_id } = req.query;
        try {
            let query = `SELECT * FROM business_products WHERE user_id = ?`;
            const params = [req.user.id];

            if (warehouse_id) {
                query += ` AND (warehouse_id = ? OR warehouse_id = ? OR warehouse_id LIKE ?)`;
                params.push(String(warehouse_id), `WH-0${warehouse_id}`, `%${warehouse_id}%`);
            }
            if (category) {
                query += ` AND category = ?`;
                params.push(category);
            }
            if (status) {
                query += ` AND status = ?`;
                params.push(status);
            }
            if (stock_status) {
                if (stock_status === 'low') {
                    query += ` AND quantity <= low_stock_threshold`;
                } else {
                    query += ` AND stock_status = ?`;
                    params.push(stock_status);
                }
            }
            if (search) {
                query += ` AND (name LIKE ? OR sku LIKE ? OR barcode LIKE ? OR hsn_code LIKE ?)`;
                params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
            }

            query += ` ORDER BY name ASC`;
            const products = await db.prepare(query).all(...params);
            return sendSuccess(res, products, 'Products retrieved successfully');
        } catch (error) {
            console.error('[Product Controller] Error fetching products:', error);
            return sendError(res, 'Failed to retrieve products', 500);
        }
    },

    // 3. Get Product by ID
    getProductById: async (req, res) => {
        const { id } = req.params;
        try {
            const product = await db.prepare('SELECT * FROM business_products WHERE id = ? AND user_id = ?').get(id, req.user.id);
            if (!product) return sendError(res, 'Product not found', 404);
            return sendSuccess(res, product, 'Product details retrieved successfully');
        } catch (error) {
            return sendError(res, 'Failed to retrieve product', 500);
        }
    },

    // 4. Update Product
    updateProduct: async (req, res) => {
        const { id } = req.params;
        const body = req.body || {};
        try {
            const product = await db.prepare('SELECT * FROM business_products WHERE id = ? AND user_id = ?').get(id, req.user.id);

            if (!product) return sendError(res, 'Product not found', 404);

            const newQuantity = body.quantity !== undefined ? parseFloat(body.quantity) : (body.stock !== undefined ? parseFloat(body.stock) : (parseFloat(product.quantity) || 0));
            const newStockStatus = body.stock_status || (newQuantity <= 0 ? 'Out of Stock' : 'In Stock');

            const name = body.name !== undefined && body.name !== null ? body.name : product.name;
            const sku = body.sku !== undefined ? body.sku : product.sku;
            const category = body.category !== undefined ? body.category : product.category;
            const unit = body.unit !== undefined ? body.unit : (product.unit || 'PCS');
            const status = body.status !== undefined ? body.status : product.status;
            const low_stock_threshold = body.low_stock_threshold !== undefined ? body.low_stock_threshold : product.low_stock_threshold;
            const purchase_price = body.purchase_price !== undefined ? body.purchase_price : product.purchase_price;
            const selling_price = body.selling_price !== undefined ? body.selling_price : (body.price !== undefined ? body.price : product.selling_price);
            const barcode = body.barcode !== undefined ? body.barcode : product.barcode;
            const serial_number = body.serial_number !== undefined ? body.serial_number : product.serial_number;
            const batch_number = body.batch_number !== undefined ? body.batch_number : product.batch_number;
            const expiry_date = body.expiry_date !== undefined ? body.expiry_date : product.expiry_date;
            const tax_percentage = body.tax_percentage !== undefined ? body.tax_percentage : product.tax_percentage;
            const warehouse_id = body.warehouse_id !== undefined ? body.warehouse_id : product.warehouse_id;
            const resolvedHsn = body.hsn_code || body.hsn_sac || body.hsn || product.hsn_code || null;

            try {
                await db.prepare(`
                    UPDATE business_products SET
                        name = ?, sku = ?, category = ?, unit = ?, status = ?, stock_status = ?, quantity = ?,
                        low_stock_threshold = ?, purchase_price = ?, selling_price = ?, barcode = ?,
                        serial_number = ?, batch_number = ?, expiry_date = ?, tax_percentage = ?,
                        warehouse_id = ?, hsn_code = ?, updated_at = ?
                    WHERE id = ? AND user_id = ?
                `).run(
                    name, sku || null, category || null, unit, status || 'active', newStockStatus,
                    newQuantity, low_stock_threshold || 5, purchase_price || 0, selling_price || 0,
                    barcode || null, serial_number || null, batch_number || null, expiry_date || null,
                    tax_percentage || 18, warehouse_id || 'Main Godown', resolvedHsn, new Date().toISOString(), id, req.user.id
                );
            } catch (sqlErr) {
                await db.prepare(`
                    UPDATE business_products SET
                        name = ?, sku = ?, category = ?, status = ?, stock_status = ?, quantity = ?,
                        selling_price = ?, updated_at = ?
                    WHERE id = ? AND user_id = ?
                `).run(
                    name, sku || null, category || null, status || 'active', newStockStatus,
                    newQuantity, selling_price || 0, new Date().toISOString(), id, req.user.id
                );
            }

            const updated = await db.prepare('SELECT * FROM business_products WHERE id = ?').get(id);
            return sendSuccess(res, updated, 'Product updated successfully');
        } catch (error) {
            console.error('[Product Controller] Update product error:', error);
            return sendError(res, 'Failed to update product', 500);
        }
    },

    // 5. Delete Product
    deleteProduct: async (req, res) => {
        const { id } = req.params;
        try {
            const product = await db.prepare('SELECT id FROM business_products WHERE id = ? AND user_id = ?').get(id, req.user.id);
            if (!product) return sendError(res, 'Product not found', 404);

            await db.prepare('DELETE FROM business_products WHERE id = ?').run(id);
            return sendSuccess(res, null, 'Product deleted successfully');
        } catch (error) {
            return sendError(res, 'Failed to delete product', 500);
        }
    },

    // 6. Search Products
    searchProducts: async (req, res) => {
        const { q } = req.query;
        try {
            const wildcard = `%${q || ''}%`;
            const products = await db.prepare(`
                SELECT * FROM business_products
                WHERE user_id = ? AND (name LIKE ? OR sku LIKE ? OR barcode LIKE ?)
            `).all(req.user.id, wildcard, wildcard, wildcard);
            return sendSuccess(res, products, 'Products matched successfully');
        } catch (error) {
            return sendError(res, 'Search operation failed', 500);
        }
    },

    // 7. Product Images
    createImage: async (req, res) => {
        const { id } = req.params;
        const { image_url } = req.body;
        try {
            const result = await db.prepare(`
                INSERT INTO product_images (product_id, user_id, image_url, created_at)
                VALUES (?, ?, ?, ?)
            `).run(id, req.user.id, image_url, new Date().toISOString());

            const created = await db.prepare('SELECT * FROM product_images WHERE id = ?').get(result.lastInsertRowid);
            return sendSuccess(res, created, 'Product image uploaded successfully', 201);
        } catch (error) {
            return sendError(res, 'Failed to attach image', 500);
        }
    },

    getImages: async (req, res) => {
        const { id } = req.params;
        try {
            const images = await db.prepare('SELECT * FROM product_images WHERE product_id = ? AND user_id = ?').all(id, req.user.id);
            return sendSuccess(res, images, 'Images fetched successfully');
        } catch (error) {
            return sendError(res, 'Failed to load images', 500);
        }
    },

    deleteImage: async (req, res) => {
        const { id, imageId } = req.params;
        try {
            await db.prepare('DELETE FROM product_images WHERE id = ? AND product_id = ?').run(imageId, id);
            return sendSuccess(res, null, 'Product image removed successfully');
        } catch (error) {
            return sendError(res, 'Failed to remove image', 500);
        }
    },

    // 8. Product Documents
    createDocument: async (req, res) => {
        const { id } = req.params;
        const { file_name, file_url } = req.body;
        try {
            const result = await db.prepare(`
                INSERT INTO product_documents (product_id, user_id, file_name, file_url, created_at)
                VALUES (?, ?, ?, ?, ?)
            `).run(id, req.user.id, file_name, file_url || null, new Date().toISOString());

            const created = await db.prepare('SELECT * FROM product_documents WHERE id = ?').get(result.lastInsertRowid);
            return sendSuccess(res, created, 'Document attached successfully', 201);
        } catch (error) {
            return sendError(res, 'Failed to attach document', 500);
        }
    },

    getDocuments: async (req, res) => {
        const { id } = req.params;
        try {
            const docs = await db.prepare('SELECT * FROM product_documents WHERE product_id = ? AND user_id = ?').all(id, req.user.id);
            return sendSuccess(res, docs, 'Documents retrieved successfully');
        } catch (error) {
            return sendError(res, 'Failed to load documents', 500);
        }
    },

    // 9. Barcodes
    createBarcode: async (req, res) => {
        const { id } = req.params;
        const { barcode } = req.body;
        try {
            await db.prepare('UPDATE business_products SET barcode = ? WHERE id = ?').run(barcode, id);
            return sendSuccess(res, { id, barcode }, 'Barcode assigned successfully');
        } catch (error) {
            return sendError(res, 'Failed to assign barcode', 500);
        }
    },

    getBarcode: async (req, res) => {
        const { id } = req.params;
        try {
            const bc = await db.prepare('SELECT id, name, barcode FROM business_products WHERE id = ?').get(id);
            return sendSuccess(res, bc, 'Barcode loaded successfully');
        } catch (error) {
            return sendError(res, 'Failed to load barcode', 500);
        }
    },

    // 10. Serial Numbers
    createSerialNumber: async (req, res) => {
        const { id } = req.params;
        const { serial_number } = req.body;
        try {
            await db.prepare('UPDATE business_products SET serial_number = ? WHERE id = ?').run(serial_number, id);
            return sendSuccess(res, { id, serial_number }, 'Serial number updated successfully');
        } catch (error) {
            return sendError(res, 'Failed to update serial number', 500);
        }
    },

    getSerialNumber: async (req, res) => {
        const { id } = req.params;
        try {
            const sn = await db.prepare('SELECT id, name, serial_number FROM business_products WHERE id = ?').get(id);
            return sendSuccess(res, sn, 'Serial number loaded successfully');
        } catch (error) {
            return sendError(res, 'Failed to load serial number', 500);
        }
    },

    // 11. Batches
    createBatch: async (req, res) => {
        const { id } = req.params;
        const { batch_number, expiry_date } = req.body;
        try {
            await db.prepare('UPDATE business_products SET batch_number = ?, expiry_date = ? WHERE id = ?').run(batch_number, expiry_date, id);
            return sendSuccess(res, { id, batch_number, expiry_date }, 'Batch information updated successfully');
        } catch (error) {
            return sendError(res, 'Failed to update batch details', 500);
        }
    },

    getBatches: async (req, res) => {
        const { id } = req.params;
        try {
            const batch = await db.prepare('SELECT id, name, batch_number, expiry_date FROM business_products WHERE id = ?').get(id);
            return sendSuccess(res, batch, 'Batch data retrieved successfully');
        } catch (error) {
            return sendError(res, 'Failed to load batch data', 500);
        }
    },

    // 12. Pricing
    createPricing: async (req, res) => {
        const { id } = req.params;
        const { purchase_price, selling_price } = req.body;
        try {
            await db.prepare('UPDATE business_products SET purchase_price = ?, selling_price = ? WHERE id = ?').run(purchase_price, selling_price, id);
            return sendSuccess(res, { id, purchase_price, selling_price }, 'Pricing updated successfully');
        } catch (error) {
            return sendError(res, 'Failed to update pricing', 500);
        }
    },

    getPricing: async (req, res) => {
        const { id } = req.params;
        try {
            const pricing = await db.prepare('SELECT id, purchase_price, selling_price, tax_percentage FROM business_products WHERE id = ?').get(id);
            return sendSuccess(res, pricing, 'Pricing details fetched successfully');
        } catch (error) {
            return sendError(res, 'Failed to load pricing details', 500);
        }
    },

    // 13. Stock & History
    getStock: async (req, res) => {
        const { id } = req.params;
        try {
            const stock = await db.prepare('SELECT id, name, quantity, low_stock_threshold, stock_status FROM business_products WHERE id = ?').get(id);
            return sendSuccess(res, stock, 'Stock count fetched successfully');
        } catch (error) {
            return sendError(res, 'Failed to load stock count', 500);
        }
    },

    getStockHistory: async (req, res) => {
        const { id } = req.params;
        try {
            const history = await db.prepare('SELECT * FROM product_stock_history WHERE product_id = ? ORDER BY created_at DESC').all(id);
            return sendSuccess(res, history, 'Stock history loaded successfully');
        } catch (error) {
            return sendError(res, 'Failed to load stock history', 500);
        }
    },

    // 14. Purchases, Sales & Returns
    getPurchases: async (req, res) => {
        const { id } = req.params;
        try {
            const product = await db.prepare('SELECT name FROM business_products WHERE id = ?').get(id);
            const purchases = await db.prepare(`
                SELECT p.* FROM business_purchases p
                LEFT JOIN business_purchase_items i ON p.id = i.purchase_id
                WHERE p.user_id = ? AND i.product_name = ? AND p.doc_type = 'BILL'
            `).all(req.user.id, product.name);
            return sendSuccess(res, purchases, 'Product procurement history loaded successfully');
        } catch (error) {
            return sendError(res, 'Failed to load purchase history', 500);
        }
    },

    getSales: async (req, res) => {
        const { id } = req.params;
        try {
            const product = await db.prepare('SELECT name FROM business_products WHERE id = ?').get(id);
            const sales = await db.prepare(`
                SELECT o.* FROM business_orders o
                LEFT JOIN business_order_items i ON o.id = i.order_id
                WHERE o.user_id = ? AND i.name = ?
            `).all(req.user.id, product.name);
            return sendSuccess(res, sales, 'Product sales orders loaded successfully');
        } catch (error) {
            return sendError(res, 'Failed to load sales history', 500);
        }
    },

    getReturns: async (req, res) => {
        const { id } = req.params;
        try {
            const product = await db.prepare('SELECT name FROM business_products WHERE id = ?').get(id);
            const returns = await db.prepare(`
                SELECT r.* FROM business_returns r
                LEFT JOIN business_return_items i ON r.id = i.return_id
                WHERE r.user_id = ? AND i.product_name = ?
            `).all(req.user.id, product.name);
            return sendSuccess(res, returns, 'Product returns history loaded successfully');
        } catch (error) {
            return sendError(res, 'Failed to load returns history', 500);
        }
    },

    // 15. Product Suppliers
    getSuppliers: async (req, res) => {
        const { id } = req.params;
        try {
            const product = await db.prepare('SELECT name FROM business_products WHERE id = ?').get(id);
            const suppliers = await db.prepare(`
                SELECT DISTINCT p.supplier_name, p.contact_number
                FROM business_purchases p
                LEFT JOIN business_purchase_items i ON p.id = i.purchase_id
                WHERE p.user_id = ? AND i.product_name = ?
            `).all(req.user.id, product.name);
            return sendSuccess(res, suppliers, 'Product suppliers loaded successfully');
        } catch (error) {
            return sendError(res, 'Failed to load suppliers list', 500);
        }
    },

    // 16. Taxes
    createTax: async (req, res) => {
        const { id } = req.params;
        const { tax_percentage } = req.body;
        try {
            await db.prepare('UPDATE business_products SET tax_percentage = ? WHERE id = ?').run(tax_percentage, id);
            return sendSuccess(res, { id, tax_percentage }, 'Tax tier updated successfully');
        } catch (error) {
            return sendError(res, 'Failed to assign tax percentage', 500);
        }
    },

    getTax: async (req, res) => {
        const { id } = req.params;
        try {
            const tax = await db.prepare('SELECT id, tax_percentage FROM business_products WHERE id = ?').get(id);
            return sendSuccess(res, tax, 'Tax tier fetched successfully');
        } catch (error) {
            return sendError(res, 'Failed to load tax rate', 500);
        }
    },

    // 17. Categories
    createCategory: async (req, res) => {
        const { category_name } = req.body;
        if (!category_name) return sendError(res, 'Category name is required', 400);
        try {
            const result = await db.prepare(`
                INSERT INTO product_categories (user_id, category_name, created_at)
                VALUES (?, ?, ?)
            `).run(req.user.id, category_name, new Date().toISOString());

            const created = await db.prepare('SELECT * FROM product_categories WHERE id = ?').get(result.lastInsertRowid);
            return sendSuccess(res, created, 'Category created successfully', 201);
        } catch (error) {
            return sendError(res, 'Failed to add category', 500);
        }
    },

    getCategories: async (req, res) => {
        try {
            const cats = await db.prepare('SELECT DISTINCT category as category_name FROM business_products WHERE user_id = ? UNION SELECT category_name FROM product_categories WHERE user_id = ?').all(req.user.id, req.user.id);
            return sendSuccess(res, cats, 'Product categories fetched successfully');
        } catch (error) {
            return sendError(res, 'Failed to load categories', 500);
        }
    },

    updateCategory: async (req, res) => {
        const { categoryId } = req.params;
        const { category_name } = req.body;
        try {
            await db.prepare('UPDATE product_categories SET category_name = ? WHERE id = ?').run(category_name, categoryId);
            return sendSuccess(res, null, 'Category updated successfully');
        } catch (error) {
            return sendError(res, 'Failed to update category', 500);
        }
    },

    deleteCategory: async (req, res) => {
        const { categoryId } = req.params;
        try {
            await db.prepare('DELETE FROM product_categories WHERE id = ?').run(categoryId);
            return sendSuccess(res, null, 'Category removed successfully');
        } catch (error) {
            return sendError(res, 'Failed to remove category', 500);
        }
    },

    // 18. Units
    getUnits: async (req, res) => {
        const units = [{ id: 1, name: 'pcs' }, { id: 2, name: 'box' }, { id: 3, name: 'kgs' }, { id: 4, name: 'packet' }];
        return sendSuccess(res, units, 'Units list fetched successfully');
    },

    // 19. Warehouse
    createWarehouse: async (req, res) => {
        const { id } = req.params;
        const { warehouse_id } = req.body;
        try {
            await db.prepare('UPDATE business_products SET warehouse_id = ? WHERE id = ?').run(warehouse_id, id);
            return sendSuccess(res, null, 'Warehouse updated successfully');
        } catch (error) {
            return sendError(res, 'Failed to update warehouse placement', 500);
        }
    },

    getWarehouse: async (req, res) => {
        const { id } = req.params;
        try {
            const wh = await db.prepare('SELECT id, warehouse_id FROM business_products WHERE id = ?').get(id);
            return sendSuccess(res, wh, 'Warehouse location loaded successfully');
        } catch (error) {
            return sendError(res, 'Failed to load warehouse placement', 500);
        }
    },

    // 20. Notes Management
    createNote: async (req, res) => {
        const { id } = req.params;
        const { note } = req.body;
        try {
            const result = await db.prepare(`
                INSERT INTO product_notes (product_id, user_id, note, created_at)
                VALUES (?, ?, ?, ?)
            `).run(id, req.user.id, note, new Date().toISOString());

            const created = await db.prepare('SELECT * FROM product_notes WHERE id = ?').get(result.lastInsertRowid);
            return sendSuccess(res, created, 'Note registered successfully', 201);
        } catch (error) {
            return sendError(res, 'Failed to save note', 500);
        }
    },

    getNotes: async (req, res) => {
        const { id } = req.params;
        try {
            const notes = await db.prepare('SELECT * FROM product_notes WHERE product_id = ? AND user_id = ?').all(id, req.user.id);
            return sendSuccess(res, notes, 'Notes loaded successfully');
        } catch (error) {
            return sendError(res, 'Failed to load notes', 500);
        }
    },

    // 21. Analytics & Reports
    getAnalytics: async (req, res) => {
        const { id } = req.params;
        try {
            const detail = await db.prepare('SELECT quantity, purchase_price, selling_price FROM business_products WHERE id = ?').get(id);
            return sendSuccess(res, detail, 'Analytics retrieved successfully');
        } catch (error) {
            return sendError(res, 'Failed to fetch analytics', 500);
        }
    },

    getStockReport: async (req, res) => {
        try {
            const list = await db.prepare('SELECT id, name, sku, quantity, low_stock_threshold FROM business_products WHERE user_id = ?').all(req.user.id);
            return sendSuccess(res, list, 'Stock list loaded successfully');
        } catch (error) {
            return sendError(res, 'Failed to load stock report', 500);
        }
    },

    getSalesReport: async (req, res) => {
        try {
            const sum = await db.prepare('SELECT COALESCE(SUM(grand_total), 0) as sales_val FROM business_orders WHERE user_id = ?').get(req.user.id);
            return sendSuccess(res, sum, 'Sales aggregate fetched successfully');
        } catch (error) {
            return sendError(res, 'Failed to load sales report', 500);
        }
    },

    getProfitReport: async (req, res) => {
        try {
            const list = await db.prepare('SELECT name, quantity, (selling_price - purchase_price) as margin FROM business_products WHERE user_id = ?').all(req.user.id);
            return sendSuccess(res, list, 'Profit margins loaded successfully');
        } catch (error) {
            return sendError(res, 'Failed to load profit report', 500);
        }
    },

    getLowStockReport: async (req, res) => {
        try {
            const list = await db.prepare('SELECT id, name, quantity, low_stock_threshold FROM business_products WHERE user_id = ? AND quantity <= low_stock_threshold').all(req.user.id);
            return sendSuccess(res, list, 'Low stock report fetched successfully');
        } catch (error) {
            return sendError(res, 'Failed to load low stock report', 500);
        }
    },

    getExpiryReport: async (req, res) => {
        try {
            const list = await db.prepare('SELECT id, name, batch_number, expiry_date FROM business_products WHERE user_id = ? AND expiry_date IS NOT NULL').all(req.user.id);
            return sendSuccess(res, list, 'Expiry dates loaded successfully');
        } catch (error) {
            return sendError(res, 'Failed to load expiry report', 500);
        }
    },

    getTopProductsReport: async (req, res) => {
        try {
            const list = await db.prepare('SELECT id, name, quantity, selling_price FROM business_products WHERE user_id = ? ORDER BY quantity DESC LIMIT 5').all(req.user.id);
            return sendSuccess(res, list, 'Top products fetched successfully');
        } catch (error) {
            return sendError(res, 'Failed to load top products', 500);
        }
    },

    // 22. Bulk Import / Export
    importProducts: async (req, res) => {
        const { products } = req.body;
        if (!products || !Array.isArray(products)) {
            return sendError(res, 'Products array is required', 400);
        }

        try {
            const now = new Date().toISOString();
            const importTx = db.transaction(async () => {
                const insertStmt = db.prepare(`
                    INSERT INTO business_products (
                        user_id, name, sku, category, status, stock_status, quantity, low_stock_threshold,
                        purchase_price, selling_price, barcode, serial_number, batch_number, expiry_date,
                        tax_percentage, warehouse_id, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, 'active', 'In Stock', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `);

                for (const item of products) {
                    if (!item.name) {
                        throw new Error('Product name is required for all imported products');
                    }
                    await insertStmt.run(
                        req.user.id,
                        item.name,
                        item.sku || null,
                        item.category || null,
                        item.quantity || 0,
                        item.low_stock_threshold || 5,
                        item.purchase_price || 0,
                        item.selling_price || 0,
                        item.barcode || null,
                        item.serial_number || null,
                        item.batch_number || null,
                        item.expiry_date || null,
                        item.tax_percentage || 18,
                        item.warehouse_id || 'Main Godown',
                        now,
                        now
                    );
                }
                return products.length;
            });

            const count = await importTx();
            return sendSuccess(res, { count }, `${count} products imported successfully`);
        } catch (error) {
            console.error('[Product Controller] Error importing products:', error);
            return sendError(res, error.message || 'Failed to import products', 500);
        }
    },

    exportProducts: async (req, res) => {
        try {
            const list = await db.prepare('SELECT * FROM business_products WHERE user_id = ?').all(req.user.id);
            return sendSuccess(res, list, 'Products exported successfully');
        } catch (error) {
            return sendError(res, 'Failed to export products', 500);
        }
    },

    // 23. Actions Block / Unblock
    blockProduct: async (req, res) => {
        const { id } = req.params;
        try {
            await db.prepare('UPDATE business_products SET status = \'blocked\' WHERE id = ?').run(id);
            return sendSuccess(res, { id, status: 'blocked' }, 'Product blocked successfully');
        } catch (error) {
            return sendError(res, 'Failed to block product', 500);
        }
    },

    unblockProduct: async (req, res) => {
        const { id } = req.params;
        try {
            await db.prepare('UPDATE business_products SET status = \'active\' WHERE id = ?').run(id);
            return sendSuccess(res, { id, status: 'active' }, 'Product unblocked successfully');
        } catch (error) {
            return sendError(res, 'Failed to unblock product', 500);
        }
    },

    // 24. Dashboard Summary
    getDashboardSummary: async (req, res) => {
        try {
            const count = await db.prepare('SELECT COUNT(*) as product_count FROM business_products WHERE user_id = ?').get(req.user.id);
            return sendSuccess(res, count, 'Dashboard summary loaded successfully');
        } catch (error) {
            return sendError(res, 'Failed to load dashboard summary', 500);
        }
    },

    // 25. Timelines
    getHistory: async (req, res) => {
        return sendSuccess(res, [], 'History loaded successfully');
    },

    getTimeline: async (req, res) => {
        return sendSuccess(res, [], 'Timeline loaded successfully');
    }
};

module.exports = productController;
