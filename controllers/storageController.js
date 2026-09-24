const fs = require('fs');
const path = require('path');
const db = require('../db/connection');
const { sendSuccess, sendError } = require('../utils/response');
const {
    STORAGE_QUOTA_BYTES,
    STORAGE_ROOT,
    VALID_MODULES,
    sanitizeEmail,
    normalizeModule,
    getAccountStorageUsage,
    getDirectorySize
} = require('../services/storageEngine');

const DEFAULT_CAPACITY_BYTES = STORAGE_QUOTA_BYTES; // 1073741824 bytes = 1.00 GB
const CDN_BASE_URL = process.env.CDN_BASE_URL || 'https://storage.beta-softnet.com/cdn';

const ensureStorageTable = async () => {
    try {
        const idType = db.dbType === 'postgres' ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
        await db.prepare(`
            CREATE TABLE IF NOT EXISTS user_storage_files (
                id ${idType},
                user_id INTEGER,
                user_email TEXT,
                file_name TEXT NOT NULL,
                file_type TEXT,
                file_size INTEGER DEFAULT 0,
                storage_path TEXT,
                module TEXT DEFAULT 'audit_tax',
                created_at TEXT,
                updated_at TEXT
            )
        `).run();

        // Migrate column if table existed previously without user_email
        try {
            await db.prepare("ALTER TABLE user_storage_files ADD COLUMN user_email TEXT").run();
        } catch (e) {
            // Already present
        }
    } catch (err) {
        console.warn('⚠️ Error initializing user_storage_files table:', err.message);
    }
};

// Initialize table
ensureStorageTable();

const formatBytes = (bytes) => {
    if (!bytes || bytes <= 0) return '0 KB';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    if (i === 0) return bytes + ' Bytes';
    return (bytes / Math.pow(k, i)).toFixed(i >= 2 ? 2 : 0) + ' ' + sizes[i];
};

const MODULE_CONFIGS = [
    { canonical: 'audit_tax', label: 'Audit & Tax (FIN-PRO)', defaultShare: '40%', files: 'PDFs, XLS, Signed Certificates', color: '#2563EB', badgeBg: '#EFF6FF' },
    { canonical: 'sales_purchases', label: 'Sales & Purchases', defaultShare: '25%', files: 'PDF Invoices, Vendor Bills', color: '#10B981', badgeBg: '#ECFDF5' },
    { canonical: 'expenses', label: 'Expenses', defaultShare: '15%', files: 'Receipt Scans, Images', color: '#8B5CF6', badgeBg: '#F5F3FF' },
    { canonical: 'hr_payroll', label: 'HR & Payroll', defaultShare: '10%', files: 'ID Documents, Payslip PDFs', color: '#F59E0B', badgeBg: '#FFFBEB' },
    { canonical: 'inventory_media', label: 'Inventory & Media', defaultShare: '10%', files: 'Product Photos, Barcodes', color: '#06B6D4', badgeBg: '#ECFEFF' }
];

const recordStorageFileHelper = async (userId, fileName, fileType, fileSize, storagePath, moduleName, userEmail) => {
    try {
        await ensureStorageTable();
        const normModule = normalizeModule(moduleName);
        const size = fileSize || 250000;
        const now = new Date().toISOString();
        const cleanEmail = sanitizeEmail(userEmail || (userId ? `user_${userId}@cliksbusiness.com` : 'default_account'));

        const existing = await db.prepare(
            'SELECT id FROM user_storage_files WHERE (user_id = ? OR user_email = ?) AND file_name = ? AND storage_path = ?'
        ).get(userId || 0, cleanEmail, fileName, storagePath || '');

        if (!existing) {
            await db.prepare(`
                INSERT INTO user_storage_files (user_id, user_email, file_name, file_type, file_size, storage_path, module, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(userId || null, cleanEmail, fileName, fileType || 'application/pdf', size, storagePath || '', normModule, now, now);
        }
    } catch (err) {
        console.error('[recordStorageFileHelper Error]', err);
    }
};

const calculateStorageUsage = async (userId, userEmail) => {
    await ensureStorageTable();

    const cleanEmail = userEmail ? sanitizeEmail(userEmail) : (userId ? `user_${userId}@cliksbusiness.com` : null);

    let userFiles = [];
    if (cleanEmail && userId) {
        userFiles = await db.prepare('SELECT * FROM user_storage_files WHERE user_email = ? OR user_id = ?').all(cleanEmail, userId);
    } else if (cleanEmail) {
        userFiles = await db.prepare('SELECT * FROM user_storage_files WHERE user_email = ?').all(cleanEmail);
    } else if (userId) {
        userFiles = await db.prepare('SELECT * FROM user_storage_files WHERE user_id = ?').all(userId);
    } else {
        userFiles = await db.prepare('SELECT * FROM user_storage_files').all();
    }

    try {
        let docFiles = [];
        if (userId) {
            docFiles = await db.prepare('SELECT * FROM documents WHERE business_owner_id = ? OR ca_id = ? OR uploaded_by = ?').all(userId, userId, userId);
        }
        for (const doc of docFiles) {
            const exists = userFiles.some(f => f.file_name === doc.name || f.storage_path === doc.file_path);
            if (!exists) {
                userFiles.push({
                    id: `doc_${doc.id}`,
                    user_id: doc.uploaded_by || doc.business_owner_id || userId || 1,
                    user_email: cleanEmail,
                    file_name: doc.name,
                    file_type: doc.file_path && (doc.file_path.endsWith('.png') || doc.file_path.endsWith('.jpg') || doc.file_path.endsWith('.jpeg')) ? 'image/png' : 'application/pdf',
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
    const moduleBytesMap = {
        audit_tax: 0,
        sales_purchases: 0,
        expenses: 0,
        hr_payroll: 0,
        inventory_media: 0
    };

    let usedBytes = 0;
    userFiles.forEach(file => {
        const sz = parseInt(file.file_size, 10) || 0;
        usedBytes += sz;
        const m = normalizeModule(file.module);
        moduleBytesMap[m] = (moduleBytesMap[m] || 0) + sz;
    });

    // Check disk usage for actual files
    if (cleanEmail) {
        const diskBytes = getDirectorySize(path.join(STORAGE_ROOT, cleanEmail));
        if (diskBytes > usedBytes) {
            usedBytes = diskBytes;
        }
    }

    const freeBytes = Math.max(0, totalCapacityBytes - usedBytes);
    const usedPercent = usedBytes > 0 ? parseFloat(((usedBytes / totalCapacityBytes) * 100).toFixed(2)) : 0;
    const usedFormatted = formatBytes(usedBytes);
    const totalCapacityFormatted = '1.00 GB';
    const freeFormatted = formatBytes(freeBytes);

    const moduleBreakdown = MODULE_CONFIGS.map(cfg => {
        const mBytes = moduleBytesMap[cfg.canonical] || 0;
        const sharePercent = usedBytes > 0 ? parseFloat(((mBytes / usedBytes) * 100).toFixed(1)) : 0;
        return {
            module: cfg.label,
            canonicalModule: cfg.canonical,
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
        userEmail: cleanEmail,
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
    /**
     * GET /api/v1/storage or /api/v1/storage/usage
     * Return user's 1.00 GB quota status and module breakdown.
     */
    getStorageUsage: async (req, res) => {
        try {
            const rawEmail = req.query?.userEmail || req.user?.email;
            const usage = await calculateStorageUsage(req.user?.id, rawEmail);
            return sendSuccess(res, usage, 'Storage usage retrieved successfully');
        } catch (error) {
            console.error('[StorageController getStorageUsage Error]', error);
            return sendError(res, 'Failed to retrieve storage usage', 500);
        }
    },

    /**
     * POST /api/v1/storage/upload
     * Accepts multipart/form-data via Multer, isolates to /storage_root/<userEmail>/<module>/,
     * rejects with 413 if account quota exceeds 1.00 GB, and returns public CDN URLs.
     */
    uploadFile: async (req, res) => {
        try {
            const userId = req.user?.id || null;
            let fileInfo = null;

            // Scenario 1: Multer Multipart Upload
            if (req.file) {
                const userEmail = req.file.userEmail || sanitizeEmail(req.body.userEmail || req.user?.email);
                const moduleName = req.file.module || normalizeModule(req.body.module);
                const filename = req.file.filename;
                const fileSize = req.file.size || 0;
                const relativePath = req.file.relativePath || `${userEmail}/${moduleName}/${filename}`;
                const fileType = req.file.mimetype || 'application/octet-stream';

                const cdnUrl = `${CDN_BASE_URL}/${relativePath}`;
                const directUrl = `/cdn/${relativePath}`;
                const streamUrl = `/api/v1/storage/file/${encodeURIComponent(userEmail)}/${moduleName}/${encodeURIComponent(filename)}`;

                let finalUserId = userId || 0;
                if (!finalUserId && userEmail) {
                    try {
                        const u = await db.prepare('SELECT id FROM users WHERE email = ?').get(userEmail);
                        if (u && u.id) finalUserId = u.id;
                    } catch (e) {}
                }

                await ensureStorageTable();
                const now = new Date().toISOString();
                const result = await db.prepare(`
                    INSERT INTO user_storage_files (user_id, user_email, file_name, file_type, file_size, storage_path, module, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).run(finalUserId, userEmail, filename, fileType, fileSize, directUrl, moduleName, now, now);

                const usage = await calculateStorageUsage(finalUserId, userEmail);

                return res.status(201).json({
                    success: true,
                    message: 'File uploaded and storage updated successfully',
                    data: {
                        id: result.lastInsertRowid,
                        fileName: filename,
                        originalName: req.file.originalname,
                        fileType,
                        fileSize,
                        fileSizeFormatted: formatBytes(fileSize),
                        module: moduleName,
                        userEmail,
                        cdnUrl,
                        directUrl,
                        streamUrl,
                        storageUsage: usage
                    }
                });
            }

            // Scenario 2: Legacy JSON / Base64 Payload
            const { fileName, fileType, fileSize, storagePath, fileData, module, userEmail } = req.body;
            if (!fileName) {
                return sendError(res, 'File name is required', 400);
            }

            const cleanEmail = sanitizeEmail(userEmail || req.user?.email);
            const moduleName = normalizeModule(module);

            let computedSize = parseInt(fileSize, 10) || 0;
            if (!computedSize && fileData) {
                computedSize = Math.round((fileData.length * 3) / 4);
            }
            if (!computedSize) {
                computedSize = 250000;
            }

            // Strict 1.00 GB Quota Check
            const currentUsage = await getAccountStorageUsage(cleanEmail, userId);
            if (currentUsage + computedSize > STORAGE_QUOTA_BYTES) {
                return res.status(413).json({
                    success: false,
                    error: {
                        code: 'STORAGE_QUOTA_EXCEEDED',
                        message: 'Storage quota exceeded for this account'
                    },
                    message: 'Storage quota exceeded for this account'
                });
            }

            // Write binary to disk if base64 fileData is provided
            let finalStoragePath = storagePath;
            let safeFilename = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
            const targetDir = path.join(STORAGE_ROOT, cleanEmail, moduleName);
            fs.mkdirSync(targetDir, { recursive: true });

            if (fileData) {
                const timestamp = Date.now();
                safeFilename = `${timestamp}_${safeFilename}`;
                const diskPath = path.join(targetDir, safeFilename);
                const buffer = Buffer.from(fileData.replace(/^data:.*?;base64,/, ''), 'base64');
                fs.writeFileSync(diskPath, buffer);
                computedSize = buffer.length;
                finalStoragePath = `/cdn/${cleanEmail}/${moduleName}/${safeFilename}`;
            }

            await recordStorageFileHelper(userId, safeFilename, fileType, computedSize, finalStoragePath || `/cdn/${cleanEmail}/${moduleName}/${safeFilename}`, moduleName, cleanEmail);
            const usage = await calculateStorageUsage(userId, cleanEmail);

            const relativePath = `${cleanEmail}/${moduleName}/${safeFilename}`;
            return res.status(201).json({
                success: true,
                message: 'File uploaded and storage updated successfully',
                data: {
                    fileName: safeFilename,
                    fileType: fileType || 'application/pdf',
                    fileSize: computedSize,
                    fileSizeFormatted: formatBytes(computedSize),
                    module: moduleName,
                    userEmail: cleanEmail,
                    cdnUrl: `${CDN_BASE_URL}/${relativePath}`,
                    directUrl: `/cdn/${relativePath}`,
                    streamUrl: `/api/v1/storage/file/${encodeURIComponent(cleanEmail)}/${moduleName}/${encodeURIComponent(safeFilename)}`,
                    storageUsage: usage
                }
            });
        } catch (error) {
            console.error('[StorageController uploadFile Error]', error);
            if (error.statusCode === 413 || error.status === 413 || error.message?.includes('Storage quota exceeded')) {
                return res.status(413).json({
                    success: false,
                    error: {
                        code: 'STORAGE_QUOTA_EXCEEDED',
                        message: 'Storage quota exceeded for this account'
                    },
                    message: 'Storage quota exceeded for this account'
                });
            }
            return sendError(res, 'Failed to upload file to storage', 500);
        }
    },

    /**
     * GET /api/v1/storage/files
     * List user storage files with CDN URLs.
     */
    getFiles: async (req, res) => {
        try {
            const rawEmail = req.query?.userEmail || req.user?.email;
            const cleanEmail = sanitizeEmail(rawEmail);
            const userId = req.user?.id;

            await ensureStorageTable();
            let files = [];
            if (cleanEmail && userId) {
                files = await db.prepare('SELECT * FROM user_storage_files WHERE user_email = ? OR user_id = ? ORDER BY id DESC').all(cleanEmail, userId);
            } else if (cleanEmail) {
                files = await db.prepare('SELECT * FROM user_storage_files WHERE user_email = ? ORDER BY id DESC').all(cleanEmail);
            } else {
                files = await db.prepare('SELECT * FROM user_storage_files ORDER BY id DESC').all();
            }

            const filesWithCdn = files.map(file => {
                const email = file.user_email || cleanEmail || 'default_account';
                const mod = normalizeModule(file.module);
                const fname = file.file_name;
                const relativePath = `${email}/${mod}/${fname}`;

                return {
                    id: file.id,
                    fileName: file.file_name,
                    fileType: file.file_type,
                    fileSize: file.file_size,
                    fileSizeFormatted: formatBytes(file.file_size),
                    module: mod,
                    userEmail: email,
                    cdnUrl: `${CDN_BASE_URL}/${relativePath}`,
                    directUrl: `/cdn/${relativePath}`,
                    streamUrl: `/api/v1/storage/file/${encodeURIComponent(email)}/${mod}/${encodeURIComponent(fname)}`,
                    createdAt: file.created_at
                };
            });

            return sendSuccess(res, filesWithCdn, 'Files retrieved successfully');
        } catch (error) {
            console.error('[StorageController getFiles Error]', error);
            return sendError(res, 'Failed to retrieve files', 500);
        }
    },

    /**
     * GET /api/v1/storage/file/:userEmail/:module/:filename
     * Direct binary file stream with proper Content-Type & Content-Disposition headers.
     */
    serveFile: async (req, res) => {
        try {
            const userEmail = sanitizeEmail(req.params.userEmail);
            const moduleName = normalizeModule(req.params.module);
            const filename = path.basename(req.params.filename);

            const filePath = path.join(STORAGE_ROOT, userEmail, moduleName, filename);

            if (!fs.existsSync(filePath)) {
                return res.status(404).json({
                    success: false,
                    error: { code: 'FILE_NOT_FOUND', message: 'Requested file not found in storage' }
                });
            }

            // Set Content-Disposition inline so images and PDFs open directly in browser
            res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');

            return res.sendFile(filePath);
        } catch (error) {
            console.error('[StorageController serveFile Error]', error);
            return res.status(500).json({ success: false, message: 'Failed to stream file' });
        }
    },

    /**
     * DELETE /api/v1/storage/files/:id
     * Delete file from database and remove physical file from disk.
     */
    deleteFile: async (req, res) => {
        try {
            const userId = req.user?.id;
            const { id } = req.params;

            const fileRecord = await db.prepare('SELECT * FROM user_storage_files WHERE id = ?').get(id);
            if (fileRecord) {
                const email = sanitizeEmail(fileRecord.user_email || req.user?.email);
                const mod = normalizeModule(fileRecord.module);
                const diskPath = path.join(STORAGE_ROOT, email, mod, fileRecord.file_name);
                if (fs.existsSync(diskPath)) {
                    try { fs.unlinkSync(diskPath); } catch (e) {}
                }
                await db.prepare('DELETE FROM user_storage_files WHERE id = ?').run(id);
            } else if (String(id).startsWith('doc_')) {
                const docId = id.replace('doc_', '');
                await db.prepare('DELETE FROM documents WHERE id = ?').run(docId);
            }

            const usage = await calculateStorageUsage(userId, req.user?.email);
            return sendSuccess(res, usage, 'File deleted and storage updated successfully');
        } catch (error) {
            console.error('[StorageController deleteFile Error]', error);
            return sendError(res, 'Failed to delete storage file', 500);
        }
    },

    recordStorageFileHelper,
    calculateStorageUsage,
    ensureStorageTable
};

module.exports = storageController;
