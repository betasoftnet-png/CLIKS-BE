const db = require('../db/connection');
const { runMigrations } = require('../db/migrations');
const crmController = require('../controllers/crmController');

async function testCustomerBillingAddressPersistence() {
    console.log('================================================================');
    console.log('=== TESTING BILLING ADDRESS SAVE, EDIT & RETRIEVAL LOGIC ===');
    console.log('================================================================');

    await runMigrations();

    const merchant = await db.prepare("SELECT * FROM users WHERE id = 1").get();
    if (!merchant) {
        console.error("Merchant user id = 1 not found");
        return;
    }

    const testCustName = `Billing Addr Test ${Date.now().toString().slice(-4)}`;
    const billingAddrInput = '123 Market Street, New Delhi';
    const shippingAddrInput = '456 Warehouse Lane, Delhi';

    // 1. CREATE CUSTOMER
    console.log(`\n--- STEP 1: Creating Customer (${testCustName}) with Billing Address: ${billingAddrInput} ---`);
    let createRes = null;
    const reqCreate = {
        user: merchant,
        body: {
            name: testCustName,
            business_name: 'Address Test Shop',
            email: 'addrtest@gmail.com',
            phone_number: '9876543210',
            alternate_phone: '1234567890',
            billing_address: billingAddrInput,
            shipping_address: shippingAddrInput,
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
        address: createdData?.address,
        billing_address: createdData?.billing_address,
        shipping_address: createdData?.shipping_address
    });

    if (createdData?.address === billingAddrInput && createdData?.billing_address === billingAddrInput) {
        console.log('✅ STEP 1 PASSED: Billing Address saved successfully on creation!');
    } else {
        console.error('❌ STEP 1 FAILED: Billing Address not saved properly!');
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
        address: foundInList?.address,
        billing_address: foundInList?.billing_address,
        shipping_address: foundInList?.shipping_address
    });

    if (foundInList?.address === billingAddrInput && foundInList?.billing_address === billingAddrInput) {
        console.log('✅ STEP 2 PASSED: Billing Address pre-filled correctly in customer list!');
    } else {
        console.error('❌ STEP 2 FAILED: Billing Address not returned in customer list!');
        return;
    }

    // 3. UPDATE CUSTOMER BILLING ADDRESS
    const updatedBillingAddrInput = '789 Commercial Hub, Connaught Place';
    console.log(`\n--- STEP 3: Updating Customer #${createdId} Billing Address to: ${updatedBillingAddrInput} ---`);

    let updateRes = null;
    const reqUpdate = {
        user: merchant,
        params: { id: createdId },
        body: {
            ...createdData,
            billing_address: updatedBillingAddrInput,
            address: updatedBillingAddrInput
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
        address: updatedData?.address,
        billing_address: updatedData?.billing_address,
        shipping_address: updatedData?.shipping_address
    });

    if (updatedData?.address === updatedBillingAddrInput && updatedData?.billing_address === updatedBillingAddrInput) {
        console.log('✅ STEP 3 PASSED: Billing Address updated successfully!');
    } else {
        console.error('❌ STEP 3 FAILED: Billing Address update failed!');
        return;
    }

    // 4. VERIFY DIRECT DATABASE QUERY
    console.log('\n--- STEP 4: Direct Database Verification ---');
    const dbRecord = await db.prepare("SELECT id, name, address, billing_address, shipping_address FROM business_customers WHERE id = ?").get(createdId);
    console.log('Direct Database Record:', dbRecord);

    if (dbRecord?.address === updatedBillingAddrInput && dbRecord?.billing_address === updatedBillingAddrInput && dbRecord?.shipping_address === shippingAddrInput) {
        console.log('\n================================================================');
        console.log('🎉 ALL BILLING ADDRESS SAVE, EDIT & RETRIEVAL TESTS PASSED 100%');
        console.log('================================================================');
    } else {
        console.error('❌ STEP 4 FAILED: Database record mismatch!');
    }
}

testCustomerBillingAddressPersistence().catch(err => console.error(err));
