const axios = require('axios');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET || 'change_me_to_a_long_random_secret_32chars+';
const BASE_URL = 'http://localhost:3000/api/v1';

async function testGstErrors() {
    const token = jwt.sign({ id: 7, email: 'sanjay123@bnxmail.com', username: 'sanjay123', role: 'business' }, JWT_SECRET);

    console.log("--- Testing GET /api/v1/gst/invoices ---");
    try {
        const res1 = await axios.get(`${BASE_URL}/gst/invoices`, { headers: { Authorization: `Bearer ${token}` } });
        console.log("Status:", res1.status, "Data Count:", res1.data?.data?.length || res1.data?.length);
    } catch (e) {
        console.error("Error /gst/invoices:", e.response?.status, e.response?.data || e.message);
    }

    console.log("\n--- Testing GET /api/v1/gst/reports/gstr9?fy=2024-25 ---");
    try {
        const res2 = await axios.get(`${BASE_URL}/gst/reports/gstr9?fy=2024-25`, { headers: { Authorization: `Bearer ${token}` } });
        console.log("Status:", res2.status, "Data:", res2.data);
    } catch (e) {
        console.error("Error /gst/reports/gstr9:", e.response?.status, e.response?.data || e.message);
    }
}

testGstErrors();
