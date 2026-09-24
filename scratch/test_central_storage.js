const request = require('supertest');
const fs = require('fs');
const path = require('path');
const app = require('../app');
const db = require('../db/connection');
const { STORAGE_ROOT } = require('../services/storageEngine');

async function runTests() {
    console.log('🧪 Starting Central Storage Service Tests...\n');
    let passed = 0;
    let failed = 0;

    const assert = (condition, msg) => {
        if (condition) {
            console.log(`  ✅ PASS: ${msg}`);
            passed++;
        } else {
            console.error(`  ❌ FAIL: ${msg}`);
            failed++;
        }
    };

    // Test 1: Upload a file for user1@business.com to 'expenses'
    console.log('--- Test 1: Upload multipart file to user1@business.com/expenses ---');
    const testBuffer1 = Buffer.from('Dummy receipt binary content for test 1');
    const res1 = await request(app)
        .post('/api/v1/storage/upload')
        .field('userEmail', 'user1@business.com')
        .field('module', 'expenses')
        .attach('file', testBuffer1, 'test_receipt.png');

    assert(res1.status === 201, `Status code is 201 (Got: ${res1.status})`);
    assert(res1.body.success === true, 'Response success is true');
    assert(res1.body.data.userEmail === 'user1@business.com', `User email matches (Got: ${res1.body.data?.userEmail})`);
    assert(res1.body.data.module === 'expenses', `Module matches 'expenses' (Got: ${res1.body.data?.module})`);
    assert(res1.body.data.cdnUrl.startsWith('https://storage.beta-softnet.com/cdn/user1@business.com/expenses/'), `CDN URL formatted correctly (Got: ${res1.body.data?.cdnUrl})`);
    assert(res1.body.data.directUrl.startsWith('/cdn/user1@business.com/expenses/'), `Direct URL formatted correctly (Got: ${res1.body.data?.directUrl})`);

    // Verify physical file on disk
    const expectedDir1 = path.join(STORAGE_ROOT, 'user1@business.com', 'expenses');
    const diskFiles1 = fs.existsSync(expectedDir1) ? fs.readdirSync(expectedDir1) : [];
    assert(diskFiles1.length > 0, `File physically exists under ${expectedDir1}`);

    // Test 2: Upload a file for user2@gmail.com to 'audit_tax'
    console.log('\n--- Test 2: Upload multipart file to user2@gmail.com/audit_tax ---');
    const testBuffer2 = Buffer.from('%PDF-1.4 Mock tax filing PDF');
    const res2 = await request(app)
        .post('/api/v1/storage/upload')
        .field('userEmail', 'user2@gmail.com')
        .field('module', 'audit_tax')
        .attach('file', testBuffer2, 'audit_report.pdf');

    assert(res2.status === 201, `Status code is 201 (Got: ${res2.status})`);
    assert(res2.body.data.userEmail === 'user2@gmail.com', `User email matches (Got: ${res2.body.data?.userEmail})`);
    assert(res2.body.data.module === 'audit_tax', `Module matches 'audit_tax' (Got: ${res2.body.data?.module})`);

    const expectedDir2 = path.join(STORAGE_ROOT, 'user2@gmail.com', 'audit_tax');
    const diskFiles2 = fs.existsSync(expectedDir2) ? fs.readdirSync(expectedDir2) : [];
    assert(diskFiles2.length > 0, `File physically exists under ${expectedDir2}`);

    // Test 3: Public Static CDN Access (Direct GET on /cdn/...)
    console.log('\n--- Test 3: Public Static CDN Access without Auth Header ---');
    const relativePath = res1.body.data.directUrl; // e.g. /cdn/user1@business.com/expenses/1234_test_receipt.png
    const cdnRes = await request(app).get(relativePath);

    assert(cdnRes.status === 200, `CDN status is 200 (Got: ${cdnRes.status})`);
    assert(cdnRes.headers['access-control-allow-origin'] === '*', 'CORS Allow-Origin header present');
    const receivedBuffer = Buffer.isBuffer(cdnRes.body) ? cdnRes.body : Buffer.from(cdnRes.text || '');
    assert(receivedBuffer.includes('Dummy receipt binary content'), 'Binary content matches uploaded file');

    // Test 4: Missing file does NOT fallback to SPA (fallthrough: false)
    console.log('\n--- Test 4: Missing file returns 404 without SPA fallback ---');
    const missingRes = await request(app).get('/cdn/user1@business.com/expenses/non_existent_file.pdf');
    assert(missingRes.status === 404, `Missing file returns 404 directly (Got: ${missingRes.status})`);

    // Test 5: Storage Quota Check (1.00 GB = 1073741824 bytes limit)
    console.log('\n--- Test 5: Quota Rejection (HTTP 413) ---');
    // Pre-seed an existing 1073741820 bytes usage for quota_user@business.com
    const quotaEmail = 'quota_user@business.com';
    await db.prepare('DELETE FROM user_storage_files WHERE user_email = ?').run(quotaEmail);
    await db.prepare(`
        INSERT INTO user_storage_files (user_id, user_email, file_name, file_type, file_size, storage_path, module, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(9999, quotaEmail, 'large_existing_backup.zip', 'application/zip', 1073741820, '/cdn/test', 'expenses', new Date().toISOString(), new Date().toISOString());

    // Now attempt to upload 50 bytes, which exceeds 1073741824 bytes
    const largeRes = await request(app)
        .post('/api/v1/storage/upload')
        .field('userEmail', quotaEmail)
        .field('module', 'inventory_media')
        .attach('file', Buffer.from('This buffer will push the account over 1.00 GB! Extra bytes 1234567890'), 'overflow.bin');

    assert(largeRes.status === 413, `Excessive size rejected with HTTP 413 (Got: ${largeRes.status})`);
    assert(
        largeRes.body.message === 'Storage quota exceeded for this account' ||
        largeRes.body.error?.message === 'Storage quota exceeded for this account',
        'Rejection message says "Storage quota exceeded for this account"'
    );

    // Verify partial file was unlinked and does not exist in inventory_media
    const quotaDir = path.join(STORAGE_ROOT, quotaEmail, 'inventory_media');
    const filesInQuotaDir = fs.existsSync(quotaDir) ? fs.readdirSync(quotaDir) : [];
    assert(filesInQuotaDir.length === 0, 'No partial file leaked on disk after quota rejection');

    // Clean up test quota user
    await db.prepare('DELETE FROM user_storage_files WHERE user_email = ?').run(quotaEmail);

    // Test 6: Storage Usage Endpoint
    console.log('\n--- Test 6: Storage Usage Breakdown ---');
    const usageRes = await request(app).get('/api/v1/storage/usage?userEmail=user1@business.com');
    assert(usageRes.status === 200, `Usage status is 200 (Got: ${usageRes.status})`);
    assert(usageRes.body.data.totalCapacityBytes === 1073741824, 'Total capacity is exactly 1073741824 bytes (1.00 GB)');
    assert(usageRes.body.data.totalCapacityFormatted === '1.00 GB', 'Formatted capacity is 1.00 GB');
    assert(Array.isArray(usageRes.body.data.moduleBreakdown), 'Module breakdown is an array');

    // Test 7: List Files
    console.log('\n--- Test 7: List Files for user1@business.com ---');
    const filesRes = await request(app).get('/api/v1/storage/files?userEmail=user1@business.com');
    assert(filesRes.status === 200, `Files status is 200 (Got: ${filesRes.status})`);
    assert(Array.isArray(filesRes.body.data) && filesRes.body.data.length > 0, 'Files returned in array');

    // Test 8: Direct file stream endpoint (GET /api/v1/storage/file/:userEmail/:module/:filename)
    console.log('\n--- Test 8: Direct API File Streaming ---');
    const uploadedFilename = res1.body.data.fileName;
    const streamRes = await request(app).get(`/api/v1/storage/file/user1@business.com/expenses/${uploadedFilename}`);
    assert(streamRes.status === 200, `Stream status is 200 (Got: ${streamRes.status})`);
    assert(streamRes.headers['content-disposition']?.includes('inline'), 'Content-Disposition header includes inline');

    console.log(`\n========================================`);
    console.log(`Summary: ${passed} passed, ${failed} failed`);
    console.log(`========================================\n`);

    if (failed > 0) {
        process.exit(1);
    } else {
        process.exit(0);
    }
}

runTests().catch(err => {
    console.error('Test execution failed:', err);
    process.exit(1);
});
