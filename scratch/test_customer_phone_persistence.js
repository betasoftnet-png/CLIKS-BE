const db = require('../db/connection');
const { runMigrations } = require('../db/migrations');
const crmController = require('../controllers/crmController');

async function testCustomerPhonePersistence() {
    console.log('================================================================');
    console.log('=== TESTING CUSTOMER PHONE NUMBER SAVE, EDIT & RETRIEVAL LOGIC ===');
    console.log('================================================================');

    await runMigrations();

    let merchant = await db.prepare("SELECT * FROM users WHERE id = 1").get();
    if (!merchant) {
        console.error("No user found!");
        return;
    }

    const testCustName = `Phone Test ${Date.now().toString().slice(-4)}`;
    const phoneInput = '9876543210';
    const altPhoneInput = '9976474828';

    // 1. CREATE CUSTOMER
    console.log(`\n--- STEP 1: Creating Customer (${testCustName}) with Phone: ${phoneInput} ---`);
    let createRes = null;
    const reqCreate = {
        user: merchant,
        body: {
            name: testCustName,
            business_name: 'Gupta Shop',
            email: 'santhosh@gmail.com',
            phone_number: phoneInput,
            alternate_phone: altPhoneInput,
            website: 'www.website.com',
            customer_type: 'Wholesale',
            gstin: '07AAAAA2345',
            pan_number: 'ABCDE1234F',
            tax_type: 'Registered Business',
            place_of_supply: 'Delhi',
            billing_address: 'Main Market',
            shipping_address: 'ughfuhu',
            opening_balance: 80000,
            credit_limit: 5000,
            due_days: 30,
            preferred_contact: 'WhatsApp'
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
        phone: createdData?.phone,
        phone_number: createdData?.phone_number,
        alternate_phone: createdData?.alternate_phone
    });

    if (createdData?.phone === phoneInput && createdData?.phone_number === phoneInput) {
        console.log('✅ STEP 1 PASSED: Phone Number saved successfully on creation!');
    } else {
        console.error('❌ STEP 1 FAILED: Phone Number not saved properly!');
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
        phone: foundInList?.phone,
        phone_number: foundInList?.phone_number,
        alternate_phone: foundInList?.alternate_phone
    });

    if (foundInList?.phone === phoneInput && foundInList?.phone_number === phoneInput) {
        console.log('✅ STEP 2 PASSED: Phone Number pre-filled correctly in customer list!');
    } else {
        console.error('❌ STEP 2 FAILED: Phone Number not returned in customer list!');
        return;
    }

    // 3. UPDATE CUSTOMER PHONE NUMBER
    const updatedPhoneInput = '9123456789';
    console.log(`\n--- STEP 3: Updating Customer #${createdId} Phone to: ${updatedPhoneInput} ---`);

    let updateRes = null;
    const reqUpdate = {
        user: merchant,
        params: { id: createdId },
        body: {
            ...createdData,
            phone_number: updatedPhoneInput,
            phone: updatedPhoneInput
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
        phone: updatedData?.phone,
        phone_number: updatedData?.phone_number,
        alternate_phone: updatedData?.alternate_phone
    });

    if (updatedData?.phone === updatedPhoneInput && updatedData?.phone_number === updatedPhoneInput) {
        console.log('✅ STEP 3 PASSED: Phone Number updated successfully!');
    } else {
        console.error('❌ STEP 3 FAILED: Phone Number update failed!');
        return;
    }

    // 4. VERIFY DIRECT DATABASE QUERY
    console.log('\n--- STEP 4: Direct Database Verification ---');
    const dbRecord = await db.prepare("SELECT id, name, phone, phone_number, alternate_phone FROM business_customers WHERE id = ?").get(createdId);
    console.log('Direct Database Record:', dbRecord);

    if (dbRecord?.phone === updatedPhoneInput && dbRecord?.phone_number === updatedPhoneInput && dbRecord?.alternate_phone === altPhoneInput) {
        console.log('\n================================================================');
        console.log('🎉 ALL PHONE NUMBER SAVE, EDIT & RETRIEVAL TESTS PASSED 100%');
        console.log('================================================================');
    } else {
        console.error('❌ STEP 4 FAILED: Database record mismatch!');
    }
}

testCustomerPhonePersistence().catch(err => console.error(err));
