const hsnController = require('../controllers/hsnController');

async function testBMWQueries() {
  const queries = [
    'BMW',
    'BMW car',
    'BMW vehicle',
    'BMW X5',
    'BMW 3 Series',
    'Toyota',
    'Toyota car',
    'Hyundai',
    'Tata car',
    'Mahindra',
    'Maruti',
    'car',
    'automobile',
    'motor car',
    'vehicle'
  ];

  console.log('--- Testing Automobile / BMW Search Queries ---');
  for (const q of queries) {
    let results = [];
    const req = { query: { q } };
    const res = {
      status: function() { return this; },
      json: function(payload) {
        results = payload.data || [];
        return this;
      }
    };
    await hsnController.searchHSN(req, res);
    console.log(`\nQuery: "${q}" -> Returned ${results.length} results:`);
    results.slice(0, 4).forEach((item, idx) => {
      console.log(`  ${idx + 1}. [${item.hsnCode}] ${item.description.slice(0, 75)}...`);
    });
  }
}

testBMWQueries().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
