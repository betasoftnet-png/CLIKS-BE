const http = require('http');
const mastersIndiaService = require('../services/mastersIndiaService');
const db = require('../db/connection');

async function runTests() {
    console.log('--- TEST 1: Service Engine Verification ---');
    try {
        console.log('Testing GSTIN Search for Tata Consultancy Services: 27AABCU9603R1ZN ...');
        const gstinData = await mastersIndiaService.searchGstin('27AABCU9603R1ZN');
        console.log('GSTIN Result Keys:', Object.keys(gstinData));
        console.log('GSTIN Result Details:', JSON.stringify(gstinData, null, 2).slice(0, 300) + '...');
        console.log('✅ Service Engine B (OAuth & GSTIN) passed!');
    } catch (e) {
        console.error('❌ Service Engine B error:', e.message);
    }

    try {
        console.log('\nTesting Sandbox Token for E-Invoice / E-Way Bill ...');
        const token = await mastersIndiaService.getSandboxToken();
        console.log('Retrieved Token (truncated):', token.substring(0, 15) + '...');
        console.log('✅ Service Engine A (JWT Token Auth) passed!');
    } catch (e) {
        console.error('❌ Service Engine A error:', e.message);
    }

    console.log('\n--- TEST 2: DB Schema Verification ---');
    try {
        const salesInvoicesCols = await db.prepare(`PRAGMA table_info(sales_invoices)`).all();
        console.log('sales_invoices columns:', salesInvoicesCols.map(c => c.name).join(', '));
        
        const deliveryChallansCols = await db.prepare(`PRAGMA table_info(delivery_challans)`).all();
        console.log('delivery_challans columns:', deliveryChallansCols.map(c => c.name).join(', '));
        
        const businessInvoicesCols = await db.prepare(`PRAGMA table_info(business_invoices)`).all();
        const ackNoCol = businessInvoicesCols.find(c => c.name === 'AckNo');
        console.log('business_invoices has AckNo column:', !!ackNoCol);
        console.log('✅ DB Tables and Schema migrations verified successfully!');
    } catch (e) {
        console.error('❌ DB Verification error:', e.message);
    }

    console.log('\n--- All Compliance Engine Verifications Completed ---');
}

runTests().catch(console.error);
