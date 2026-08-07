const db = require('../db/connection');
const { runMigrations } = require('../db/migrations');
const crmController = require('../controllers/crmController');

async function testCustomerPanPersistence() {
    console.log('================================================================');
    console.log('=== TESTING CUSTOMER PAN NUMBER SAVE, EDIT & RETRIEVAL LOGIC ===');
    console.log('================================================================');

    await runMigrations();

    const merchant = await db.prepare("SELECT * FROM users WHERE id = 1").get();
    if (!merchant) {
        console.error("Merchant user id = 1 not found");
        return;
    }

    const testCustName = `PAN Test ${Date.now().toString().slice(-4)}`;
    const panInput = 'ABCDE1234F';
    const altPhoneInput = '1234567890';

    // 1. CREATE CUSTOMER
    console.log(`\n--- STEP 1: Creating Customer (${testCustName}) with PAN: ${panInput} ---`);
    let createRes = null;
    const reqCreate = {
        user: merchant,
        body: {
            name: testCustName,
            business_name: 'PAN Test Shop',
            email: 'pantest@gmail.com',
            phone_number: '9876543210',
            alternate_phone: altPhoneInput,
            pan_number: panInput,
            status: 'Active'
        }
    };

    const resCreate = {
        status(c) { this.statusCode = c; return this; },
        json(payload) { createRes = payload; return this; }
    };

    await crmController.createCustomer(reqCreate, resCreate);

    const createdData = createRes?.data;
    console.log('Created Customer Response:', {
        id: createdData?.id,
        name: createdData?.name,
        pan: createdData?.pan,
        pan_number: createdData?.pan_number,
        alternate_phone: createdData?.alternate_phone
    });

    if (createdData?.pan === panInput && createdData?.pan_number === panInput) {
        console.log('✅ STEP 1 PASSED: PAN Number saved successfully on creation!');
    } else {
        console.error('❌ STEP 1 FAILED: PAN Number not saved properly!');
        return;
    }

    const createdId = createdData.id;

    // 2. FETCH CUSTOMERS LIST
    console.log('\n--- STEP 2: Fetching Customers List ---');
    let listRes = null;
    await crmController.getCustomers({ user: merchant }, {
        status(c) { this.statusCode = c; return this; },
        json(payload) { listRes = payload; return this; }
    });

    const foundInList = (listRes?.data || []).find(c => c.id === createdId);
    console.log('Customer in List:', {
        id: foundInList?.id,
        name: foundInList?.name,
        pan: foundInList?.pan,
        pan_number: foundInList?.pan_number,
        alternate_phone: foundInList?.alternate_phone
    });

    if (foundInList?.pan === panInput && foundInList?.pan_number === panInput) {
        console.log('✅ STEP 2 PASSED: PAN Number pre-filled correctly in customer list!');
    } else {
        console.error('❌ STEP 2 FAILED: PAN Number not returned in customer list!');
        return;
    }

    // 3. UPDATE CUSTOMER PAN NUMBER
    const updatedPanInput = 'XYZPD9876Q';
    console.log(`\n--- STEP 3: Updating Customer #${createdId} PAN to: ${updatedPanInput} ---`);

    let updateRes = null;
    const reqUpdate = {
        user: merchant,
        params: { id: createdId },
        body: {
            ...createdData,
            pan_number: updatedPanInput,
            pan: updatedPanInput
        }
    };

    await crmController.updateCustomer(reqUpdate, {
        status(c) { this.statusCode = c; return this; },
        json(payload) { updateRes = payload; return this; }
    });

    const updatedData = updateRes?.data;
    console.log('Updated Customer Response:', {
        id: updatedData?.id,
        name: updatedData?.name,
        pan: updatedData?.pan,
        pan_number: updatedData?.pan_number,
        alternate_phone: updatedData?.alternate_phone
    });

    if (updatedData?.pan === updatedPanInput && updatedData?.pan_number === updatedPanInput) {
        console.log('✅ STEP 3 PASSED: PAN Number updated successfully!');
    } else {
        console.error('❌ STEP 3 FAILED: PAN Number update failed!');
        return;
    }

    // 4. VERIFY DIRECT DATABASE QUERY
    console.log('\n--- STEP 4: Direct Database Verification ---');
    const dbRecord = await db.prepare("SELECT id, name, pan, pan_number, alternate_phone FROM business_customers WHERE id = ?").get(createdId);
    console.log('Direct Database Record:', dbRecord);

    if (dbRecord?.pan === updatedPanInput && dbRecord?.pan_number === updatedPanInput && dbRecord?.alternate_phone === altPhoneInput) {
        console.log('\n================================================================');
        console.log('🎉 ALL PAN NUMBER SAVE, EDIT & RETRIEVAL TESTS PASSED 100%');
        console.log('================================================================');
    } else {
        console.error('❌ STEP 4 FAILED: Database record mismatch!');
    }
}

testCustomerPanPersistence().catch(err => console.error(err));
