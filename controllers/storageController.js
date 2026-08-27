const db = require('../db/connection');
const { sendSuccess, sendError } = require('../utils/response');

// 1073741824 bytes = 1.00 GB
const DEFAULT_CAPACITY_BYTES = 1073741824;

const ensureStorageTable = async () => {
    try {
        const idType = db.dbType === 'postgres' ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
        await db.prepare(`
            CREATE TABLE IF NOT EXISTS user_storage_files (
                id ${idType},
                user_id INTEGER NOT NULL,
                file_name TEXT NOT NULL,
                file_type TEXT,
                file_size INTEGER DEFAULT 0,
                storage_path TEXT,
                module TEXT DEFAULT 'Audit & Tax (FIN-PRO)',
                created_at TEXT,
                updated_at TEXT
            )
        `).run();
    } catch (err) {
        console.warn('⚠️ Error initializing user_storage_files table:', err.message);
    }
};

// Initialize table
ensureStorageTable();

const formatBytes = (bytes) => {
    if (bytes === 0) return '0 KB';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    if (i === 0) return bytes + ' Bytes';
    return (bytes / Math.pow(k, i)).toFixed(i >= 2 ? 2 : 0) + ' ' + sizes[i];
};

const normalizeModule = (mod) => {
    if (!mod) return 'Audit & Tax (FIN-PRO)';
    const lower = String(mod).toLowerCase();
    if (lower.includes('audit') || lower.includes('tax') || lower.includes('fin-pro') || lower.includes('ca') || lower.includes('doc')) {
        return 'Audit & Tax (FIN-PRO)';
    }
    if (lower.includes('sale') || lower.includes('purchase') || lower.includes('invoice') || lower.includes('bill')) {
        return 'Sales & Purchases';
    }
    if (lower.includes('expense') || lower.includes('receipt')) {
        return 'Expenses';
    }
    if (lower.includes('hr') || lower.includes('payroll') || lower.includes('employee') || lower.includes('staff')) {
        return 'HR & Payroll';
    }
    if (lower.includes('inventory') || lower.includes('media') || lower.includes('product') || lower.includes('stock') || lower.includes('barcode')) {
        return 'Inventory & Media';
    }
    return 'Audit & Tax (FIN-PRO)';
};

const MODULE_CONFIGS = [
    { module: 'Audit & Tax (FIN-PRO)', defaultShare: '40%', files: 'PDFs, XLS, Signed Certificates', color: '#2563EB', badgeBg: '#EFF6FF' },
    { module: 'Sales & Purchases', defaultShare: '25%', files: 'PDF Invoices, Vendor Bills', color: '#10B981', badgeBg: '#ECFDF5' },
    { module: 'Expenses', defaultShare: '15%', files: 'Receipt Scans, Images', color: '#8B5CF6', badgeBg: '#F5F3FF' },
    { module: 'HR & Payroll', defaultShare: '10%', files: 'ID Documents, Payslip PDFs', color: '#F59E0B', badgeBg: '#FFFBEB' },
    { module: 'Inventory & Media', defaultShare: '10%', files: 'Product Photos, Barcodes', color: '#06B6D4', badgeBg: '#ECFEFF' }
];

const recordStorageFileHelper = async (userId, fileName, fileType, fileSize, storagePath, moduleName) => {
    try {
        await ensureStorageTable();
        const normModule = normalizeModule(moduleName);
        const size = fileSize || 250000;
        const now = new Date().toISOString();

        const existing = await db.prepare(
            'SELECT id FROM user_storage_files WHERE user_id = ? AND file_name = ? AND storage_path = ?'
        ).get(userId, fileName, storagePath || '');

        if (!existing) {
            await db.prepare(`
                INSERT INTO user_storage_files (user_id, file_name, file_type, file_size, storage_path, module, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).run(userId, fileName, fileType || 'application/pdf', size, storagePath || '', normModule, now, now);
        }
    } catch (err) {
        console.error('[recordStorageFileHelper Error]', err);
    }
};

const calculateStorageUsage = async (userId) => {
    await ensureStorageTable();

    let userFiles = [];
    if (userId) {
        userFiles = await db.prepare('SELECT * FROM user_storage_files WHERE user_id = ?').all(userId);
    }
    if (!userFiles || userFiles.length === 0) {
        userFiles = await db.prepare('SELECT * FROM user_storage_files').all();
    }

    try {
        let docFiles = [];
        if (userId) {
            docFiles = await db.prepare('SELECT * FROM documents WHERE business_owner_id = ? OR ca_id = ? OR uploaded_by = ?').all(userId, userId, userId);
        }
        if (!docFiles || docFiles.length === 0) {
            docFiles = await db.prepare('SELECT * FROM documents').all();
        }
        for (const doc of docFiles) {
            const exists = userFiles.some(f => f.file_name === doc.name || f.storage_path === doc.file_path);
            if (!exists) {
                userFiles.push({
                    id: `doc_${doc.id}`,
                    user_id: doc.uploaded_by || doc.business_owner_id || userId || 1,
                    file_name: doc.name,
                    file_type: doc.file_path && doc.file_path.endsWith('.png') ? 'image/png' : 'application/pdf',
                    file_size: 350000,
                    storage_path: doc.file_path,
                    module: normalizeModule(doc.category),
                    created_at: doc.created_at
                });
            }
        }
    } catch (e) {
        // Table might not exist or empty
    }

    const totalCapacityBytes = DEFAULT_CAPACITY_BYTES;
    let usedBytes = 0;
    const moduleBytesMap = {
        'Audit & Tax (FIN-PRO)': 0,
        'Sales & Purchases': 0,
        'Expenses': 0,
        'HR & Payroll': 0,
        'Inventory & Media': 0
    };

    userFiles.forEach(file => {
        const sz = parseInt(file.file_size) || 0;
        usedBytes += sz;
        const m = normalizeModule(file.module);
        moduleBytesMap[m] = (moduleBytesMap[m] || 0) + sz;
    });

    const freeBytes = Math.max(0, totalCapacityBytes - usedBytes);
    const usedPercent = usedBytes > 0 ? parseFloat(((usedBytes / totalCapacityBytes) * 100).toFixed(2)) : 0;
    const usedFormatted = formatBytes(usedBytes);
    const totalCapacityFormatted = '1.00 GB';
    const freeFormatted = formatBytes(freeBytes);

    const moduleBreakdown = MODULE_CONFIGS.map(cfg => {
        const mBytes = moduleBytesMap[cfg.module] || 0;
        const sharePercent = usedBytes > 0 ? parseFloat(((mBytes / usedBytes) * 100).toFixed(1)) : 0;
        return {
            module: cfg.module,
            bytes: mBytes,
            formatted: formatBytes(mBytes),
            share: `${sharePercent}%`,
            sharePercent,
            typicalQuota: cfg.defaultShare,
            files: cfg.files,
            color: cfg.color,
            badgeBg: cfg.badgeBg
        };
    });

    return {
        totalCapacityBytes,
        totalCapacityFormatted,
        usedBytes,
        usedFormatted,
        usedPercent,
        freeBytes,
        freeFormatted,
        moduleBreakdown,
        fileCount: userFiles.length,
        files: userFiles
    };
};

const storageController = {
    getStorageUsage: async (req, res) => {
        try {
            const usage = await calculateStorageUsage(req.user.id);
            return sendSuccess(res, usage, 'Storage usage retrieved successfully');
        } catch (error) {
            console.error('[StorageController getStorageUsage Error]', error);
            return sendError(res, 'Failed to retrieve storage usage', 500);
        }
    },

    uploadFile: async (req, res) => {
        try {
            const userId = req.user.id;
            const { fileName, fileType, fileSize, storagePath, fileData, module } = req.body;

            if (!fileName) {
                return sendError(res, 'File name is required', 400);
            }

            let computedSize = parseInt(fileSize) || 0;
            if (!computedSize && fileData) {
                computedSize = Math.round((fileData.length * 3) / 4);
            }
            if (!computedSize) {
                computedSize = 250000;
            }

            await recordStorageFileHelper(userId, fileName, fileType, computedSize, storagePath, module);
            const usage = await calculateStorageUsage(userId);
            return sendSuccess(res, usage, 'File uploaded and storage updated successfully', 201);
        } catch (error) {
            console.error('[StorageController uploadFile Error]', error);
            return sendError(res, 'Failed to upload file to storage', 500);
        }
    },

    deleteFile: async (req, res) => {
        try {
            const userId = req.user.id;
            const { id } = req.params;

            if (String(id).startsWith('doc_')) {
                const docId = id.replace('doc_', '');
                await db.prepare('DELETE FROM documents WHERE id = ? AND (business_owner_id = ? OR ca_id = ? OR uploaded_by = ?)').run(docId, userId, userId, userId);
            } else {
                await db.prepare('DELETE FROM user_storage_files WHERE id = ? AND user_id = ?').run(id, userId);
            }

            const usage = await calculateStorageUsage(userId);
            return sendSuccess(res, usage, 'File deleted and storage updated successfully');
        } catch (error) {
            console.error('[StorageController deleteFile Error]', error);
            return sendError(res, 'Failed to delete storage file', 500);
        }
    },

    recordStorageFileHelper
};

module.exports = storageController;
