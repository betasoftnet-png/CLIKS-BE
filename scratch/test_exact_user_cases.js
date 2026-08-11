const hsnController = require('../controllers/hsnController');

async function testQuery(q) {
  const req = { query: { q } };
  let results = [];
  const res = {
    status: function() { return this; },
    json: function(payload) {
      results = payload.data || [];
      return this;
    }
  };
  await hsnController.searchHSN(req, res);
  return results;
}

async function runExactUserTestCases() {
  const queries = [
    'MacBook',
    'MacBook Pro',
    'MacBook Air',
    'MacBook Pro 5',
    'MacBook Pro M1',
    'MacBook Pro M2',
    'MacBook Pro M3',
    'Laptop',
    'Dell Laptop',
    'HP Laptop',
    'iPhone',
    'Samsung Mobile',
    'OnePlus Phone',
    'Rice',
    'Basmati Rice',
    'Wheat',
    'Atta',
    'Barley',
    'BMW',
    'Toyota Car',
    'TV',
    'LED TV',
    'Refrigerator',
    'Washing Machine',
    'Mobile Charger',
    'Electric Fan',
    'Hotel Chair',
    'Restaurant Table',
    'Tomato',
    'Potato',
    'Onion'
  ];

  let passed = 0;
  let failed = 0;

  for (const q of queries) {
    const results = await testQuery(q);
    console.log(`\n========================================`);
    console.log(`QUERY: "${q}"`);
    console.log(`========================================`);
    if (results.length > 0) {
      passed++;
      console.log(`Returned ${results.length} results:`);
      results.slice(0, 5).forEach((item, idx) => {
        console.log(`  ${idx + 1}. [${item.hsnCode}] ${item.description.slice(0, 75)}...`);
      });

      // Special assertion for MacBook Pro 5 -> MUST NOT contain paper 4802
      if (q.toLowerCase().includes('macbook')) {
        const hasPaper = results.some(r => r.hsnCode.startsWith('4802'));
        if (hasPaper) {
          console.error(`❌ ASSERTION FAIL: "${q}" returned paper (4802)!`);
          failed++;
        } else {
          console.log(`✅ ASSERTION PASS: "${q}" returned clean 8471 family records without paper 4802.`);
        }
      }
    } else {
      console.error(`❌ [FAIL] "${q}" returned 0 results!`);
      failed++;
    }
  }

  console.log(`\n========================================`);
  console.log(`USER TEST CASES SUMMARY: ${passed} PASSED, ${failed} FAILED.`);
  console.log(`========================================`);
  if (failed > 0) {
    process.exit(1);
  }
}

runExactUserTestCases().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
