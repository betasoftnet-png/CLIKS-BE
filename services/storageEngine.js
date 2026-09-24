const fs = require('fs');
const path = require('path');
const db = require('../db/connection');

// Storage Quota: Exactly 1.00 GB (1,073,741,824 bytes)
const STORAGE_QUOTA_BYTES = 1073741824;

// Storage Root Directory
const STORAGE_ROOT = process.env.STORAGE_ROOT || path.join(__dirname, '../storage_root');

// Standardized Modules Mapping
const VALID_MODULES = [
    'audit_tax',
    'sales_purchases',
    'expenses',
    'hr_payroll',
    'inventory_media'
];

/**
 * Sanitize user email to create safe directory names while preserving email semantics.
 */
function sanitizeEmail(email) {
    if (!email) return 'default_account';
    const trimmed = String(email).trim().toLowerCase();
    // Replace characters invalid in filesystems (Windows/Linux)
    const sanitized = trimmed.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
    // Prevent directory traversal
    return sanitized.replace(/^\.+|\.+$/g, '').replace(/\.{2,}/g, '_') || 'default_account';
}

/**
 * Normalize input module to one of the 5 canonical module folders.
 */
function normalizeModule(mod) {
    if (!mod) return 'audit_tax';
    const lower = String(mod).toLowerCase().trim();

    if (lower.includes('audit') || lower.includes('tax') || lower.includes('fin-pro') || lower.includes('ca')) {
        return 'audit_tax';
    }
    if (lower.includes('sale') || lower.includes('purchase') || lower.includes('invoice') || lower.includes('bill')) {
        return 'sales_purchases';
    }
    if (lower.includes('expense') || lower.includes('receipt') || lower.includes('split')) {
        return 'expenses';
    }
    if (lower.includes('hr') || lower.includes('payroll') || lower.includes('employee') || lower.includes('staff')) {
        return 'hr_payroll';
    }
    if (lower.includes('inventory') || lower.includes('media') || lower.includes('product') || lower.includes('stock') || lower.includes('barcode')) {
        return 'inventory_media';
    }

    const slug = lower.replace(/[^a-z0-9_]/g, '_');
    if (VALID_MODULES.includes(slug)) {
        return slug;
    }
    return 'audit_tax';
}

/**
 * Recursively calculate directory size in bytes.
 */
function getDirectorySize(dirPath) {
    let size = 0;
    try {
        if (!fs.existsSync(dirPath)) return 0;
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dirPath, entry.name);
            if (entry.isDirectory()) {
                size += getDirectorySize(fullPath);
            } else if (entry.isFile()) {
                try {
                    size += fs.statSync(fullPath).size;
                } catch (e) {
                    // Ignore transient file lock
                }
            }
        }
    } catch (e) {
        // Ignore access error
    }
    return size;
}

/**
 * Calculate current storage usage for an account by email and user ID.
 */
async function getAccountStorageUsage(userEmail, userId) {
    let dbBytes = 0;
    try {
        const cleanEmail = sanitizeEmail(userEmail);
        const row = await db.prepare(
            'SELECT COALESCE(SUM(file_size), 0) as total FROM user_storage_files WHERE user_email = ? OR user_id = ?'
        ).get(cleanEmail, userId || 0);
        if (row && row.total) {
            dbBytes = parseInt(row.total, 10) || 0;
        }
    } catch (e) {
        // Table or column might be absent initially
    }

    const cleanEmail = sanitizeEmail(userEmail);
    const userDirPath = path.join(STORAGE_ROOT, cleanEmail);
    const diskBytes = getDirectorySize(userDirPath);

    return Math.max(dbBytes, diskBytes);
}

/**
 * Custom Multer Storage Engine:
 * 1. Isolates storage by User Email: /storage_root/<userEmail>/<module>/
 * 2. Pre-checks and streams quota: reject with HTTP 413 if currentUsage + file.size > 1073741824
 */
function CentralStorageEngine(options = {}) {
    this.storageRoot = options.storageRoot || STORAGE_ROOT;
}

CentralStorageEngine.prototype._handleFile = async function _handleFile(req, file, cb) {
    try {
        // 1. Resolve User Email & Module dynamically
        const rawEmail = req.body?.userEmail || req.query?.userEmail || req.headers['x-user-email'] || req.user?.email || 'default_account';
        const userEmail = sanitizeEmail(rawEmail);
        const moduleName = normalizeModule(req.body?.module || req.query?.module || req.headers['x-module']);

        // 2. Calculate Current Usage for this account
        const currentUsage = await getAccountStorageUsage(userEmail, req.user?.id);

        // Immediate check if request content-length already exceeds remaining quota
        const incomingContentLength = parseInt(req.headers['content-length'] || 0, 10);
        if (incomingContentLength > 0 && (currentUsage + incomingContentLength) > STORAGE_QUOTA_BYTES) {
            const err = new Error('Storage quota exceeded for this account');
            err.statusCode = 413;
            err.status = 413;
            err.code = 'STORAGE_QUOTA_EXCEEDED';
            return cb(err);
        }

        if (currentUsage >= STORAGE_QUOTA_BYTES) {
            const err = new Error('Storage quota exceeded for this account');
            err.statusCode = 413;
            err.status = 413;
            err.code = 'STORAGE_QUOTA_EXCEEDED';
            return cb(err);
        }

        // 3. Prepare Target Directory: /storage_root/<userEmail>/<module>/
        const targetDir = path.join(this.storageRoot, userEmail, moduleName);
        fs.mkdirSync(targetDir, { recursive: true });

        // Safe filename with timestamp prefix
        const timestamp = Date.now();
        const safeOriginalName = file.originalname ? file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_') : 'file.bin';
        const finalFilename = `${timestamp}_${safeOriginalName}`;
        const finalPath = path.join(targetDir, finalFilename);

        const writeStream = fs.createWriteStream(finalPath);
        let bytesWritten = 0;
        let quotaExceeded = false;

        file.stream.on('data', (chunk) => {
            bytesWritten += chunk.length;
            if (currentUsage + bytesWritten > STORAGE_QUOTA_BYTES) {
                quotaExceeded = true;
                file.stream.unpipe(writeStream);
                file.stream.pause();
                writeStream.destroy();

                // Clean up partial file on disk
                fs.unlink(finalPath, () => {});

                const err = new Error('Storage quota exceeded for this account');
                err.statusCode = 413;
                err.status = 413;
                err.code = 'STORAGE_QUOTA_EXCEEDED';
                return cb(err);
            }
        });

        writeStream.on('error', (err) => {
            if (!quotaExceeded) {
                fs.unlink(finalPath, () => {});
                cb(err);
            }
        });

        writeStream.on('finish', () => {
            if (!quotaExceeded) {
                cb(null, {
                    destination: targetDir,
                    filename: finalFilename,
                    path: finalPath,
                    size: bytesWritten,
                    userEmail: userEmail,
                    module: moduleName,
                    relativePath: `${userEmail}/${moduleName}/${finalFilename}`
                });
            }
        });

        file.stream.pipe(writeStream);
    } catch (err) {
        cb(err);
    }
};

CentralStorageEngine.prototype._removeFile = function _removeFile(req, file, cb) {
    if (file && file.path) {
        fs.unlink(file.path, cb);
    } else {
        cb(null);
    }
};

module.exports = {
    CentralStorageEngine,
    STORAGE_QUOTA_BYTES,
    STORAGE_ROOT,
    VALID_MODULES,
    sanitizeEmail,
    normalizeModule,
    getAccountStorageUsage,
    getDirectorySize
};
