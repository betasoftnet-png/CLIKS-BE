const express = require('express');
const router = express.Router();
const multer = require('multer');
const storageController = require('../controllers/storageController');
const { authenticateToken, optionalAuth } = require('../middleware/auth');
const { CentralStorageEngine, STORAGE_QUOTA_BYTES } = require('../services/storageEngine');

// Initialize Multer with isolated directory structure & streaming quota guard
const upload = multer({
    storage: new CentralStorageEngine(),
    limits: {
        fileSize: STORAGE_QUOTA_BYTES // 1073741824 bytes (1.00 GB max single file)
    }
});

// Middleware to handle Multer upload and catch quota exceed errors
const handleUploadMiddleware = (req, res, next) => {
    // If request is json, skip multer
    const contentType = req.headers['content-type'] || '';
    if (!contentType.includes('multipart/form-data')) {
        return next();
    }

    upload.single('file')(req, res, (err) => {
        if (err) {
            if (
                err.statusCode === 413 ||
                err.status === 413 ||
                err.code === 'LIMIT_FILE_SIZE' ||
                err.code === 'STORAGE_QUOTA_EXCEEDED' ||
                err.message?.includes('Storage quota exceeded') ||
                err.message?.includes('File too large')
            ) {
                return res.status(413).json({
                    success: false,
                    error: {
                        code: 'STORAGE_QUOTA_EXCEEDED',
                        message: 'Storage quota exceeded for this account'
                    },
                    message: 'Storage quota exceeded for this account'
                });
            }

            return res.status(400).json({
                success: false,
                error: {
                    code: 'UPLOAD_ERROR',
                    message: err.message
                },
                message: err.message
            });
        }
        next();
    });
};

// Quota usage
router.get('/', optionalAuth, storageController.getStorageUsage);
router.get('/usage', optionalAuth, storageController.getStorageUsage);

// List uploaded files
router.get('/files', optionalAuth, storageController.getFiles);

// Upload endpoint - supports both multipart/form-data with isolated folder destination & legacy base64
router.post('/upload', optionalAuth, handleUploadMiddleware, storageController.uploadFile);

// Public direct file streaming endpoint (opens directly in browser without SPA rewrite)
router.get('/file/:userEmail/:module/:filename', storageController.serveFile);

// Delete file
router.delete('/files/:id', authenticateToken, storageController.deleteFile);

module.exports = router;
