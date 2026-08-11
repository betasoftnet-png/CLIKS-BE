const billingController = require('../controllers/billingController');
const customerController = require('../controllers/customerController');

async function testFixes() {
  console.log('--- TEST 1: Customer Update with Non-Existent ID 88 ---');
  const reqCust = {
    params: { id: 88 },
    user: { id: 7 },
    body: {
      name: 'ravi',
      email: 'clikskumar20@bnxmail.com',
      loyalty_points: 15
    }
  };
  let custStatus = 200;
  let custResult = null;
  const resCust = {
    status: function(s) { custStatus = s; return this; },
    json: function(p) { custResult = p; return this; }
  };

  await customerController.updateCustomer(reqCust, resCust);
  console.log(`Customer Update Result (Status ${custStatus}):`, custResult);

  console.log('\n--- TEST 2: Invoice Creation with Customer Integration ---');
  const reqInv = {
    user: { id: 7 },
    body: {
      invoice_number: `INV-TEST-${Date.now().toString().slice(-4)}`,
      client_name: 'ravi',
      client_email: 'clikskumar20@bnxmail.com',
      amount: 200,
      total_amount: 200,
      paid_amount: 200,
      due_amount: 0,
      payment_mode: 'Cash',
      status: 'Paid',
      items: [
        { name: 'Item A', quantity: 1, price: 200, total: 200 }
      ]
    }
  };
  let invStatus = 200;
  let invResult = null;
  const resInv = {
    status: function(s) { invStatus = s; return this; },
    json: function(p) { invResult = p; return this; }
  };

  await billingController.createInvoice(reqInv, resInv);
  console.log(`Invoice Creation Result (Status ${invStatus}):`, invResult);
}

testFixes().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
