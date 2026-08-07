const db = require('../db/connection');
const { runMigrations } = require('../db/migrations');
const crmController = require('../controllers/crmController');

async function testCustomerApiExecution() {
    console.log('================================================================');
    console.log('=== VERIFYING POST /api/v1/customers & PATCH /api/v1/customers/:id ===');
    console.log('================================================================');

    await runMigrations();

    const merchant = await db.prepare("SELECT * FROM users WHERE id = 1").get();
    if (!merchant) {
        console.error("Merchant user id = 1 not found");
        return;
    }

    // 1. TEST POST /api/v1/customers
    console.log('\n--- 1. Testing POST /api/v1/customers (Create Customer) ---');
    const custCode = `CUST-TASK-${Date.now().toString().slice(-4)}`;
    let postResPayload = null;
    let postStatusCode = 200;

    const reqPost = {
        user: merchant,
        headers: { origin: 'https://cliksbusiness.com' },
        body: {
            customer_code: custCode,
            name: 'CORS Test Customer',
            business_name: 'CORS Test Business',
            email: 'corstest@domain.com',
            phone_number: '9876543210',
            alternate_phone: '9988776655',
            status: 'Active'
        }
    };

    const resPost = {
        status(c) { postStatusCode = c; return this; },
        json(p) { postResPayload = p; return this; }
    };

    await crmController.createCustomer(reqPost, resPost);

    console.log('POST Response Status:', postStatusCode);
    console.log('POST Response Body:', postResPayload);

    if (postStatusCode === 201 && postResPayload?.success && postResPayload?.data?.id) {
        console.log('✅ TASK 1 VERIFICATION PASSED: POST /api/v1/customers SUCCEEDS with HTTP 201!');
    } else {
        console.error('❌ TASK 1 VERIFICATION FAILED: POST /api/v1/customers failed!');
        return;
    }

    const createdId = postResPayload.data.id;

    // 2. TEST PATCH /api/v1/customers/:id
    console.log(`\n--- 2. Testing PATCH /api/v1/customers/${createdId} (Update Customer) ---`);
    let patchResPayload = null;
    let patchStatusCode = 200;

    const reqPatch = {
        user: merchant,
        params: { id: createdId },
        headers: { origin: 'https://cliksbusiness.com' },
        body: {
            phone_number: '9123456789',
            alternate_phone: '9988776655'
        }
    };

    const resPatch = {
        status(c) { patchStatusCode = c; return this; },
        json(p) { patchResPayload = p; return this; }
    };

    await crmController.updateCustomer(reqPatch, resPatch);

    console.log('PATCH Response Status:', patchStatusCode);
    console.log('PATCH Response Body:', patchResPayload);

    if (patchStatusCode === 200 && patchResPayload?.success && patchResPayload?.data?.phone_number === '9123456789') {
        console.log('✅ TASK 1 VERIFICATION PASSED: PATCH /api/v1/customers/:id SUCCEEDS with HTTP 200!');
    } else {
        console.error('❌ TASK 1 VERIFICATION FAILED: PATCH /api/v1/customers/:id failed!');
        return;
    }

    console.log('\n================================================================');
    console.log('🎉 POST & PATCH CUSTOMER API ENDPOINTS SUCCEED 100% CLEANLY!');
    console.log('================================================================');
}

testCustomerApiExecution().catch(err => console.error(err));
