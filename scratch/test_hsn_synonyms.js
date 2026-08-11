const hsnController = require('../controllers/hsnController');

async function runQuery(q) {
  const req = { query: { q } };
  let resultData = null;
  const res = {
    status: function() { return this; },
    json: function(payload) {
      resultData = payload.data;
      return this;
    }
  };
  await hsnController.searchHSN(req, res);
  return resultData;
}

async function testAll() {
  const queries = [
    'iPhone',
    'Apple iPhone',
    'Samsung mobile',
    'OnePlus phone',
    'Vivo mobile',
    'Redmi phone',
    'Laptop',
    'MacBook',
    'Barley',
    'Wheat',
    'Rice',
    '8517',
    '851712'
  ];

  for (const q of queries) {
    console.log(`\n========================================`);
    console.log(`QUERY: "${q}"`);
    console.log(`========================================`);
    const data = await runQuery(q);
    console.log(`Returned ${data.length} results:`);
    data.slice(0, 5).forEach((item, idx) => {
      console.log(`  ${idx + 1}. [${item.hsnCode}] - ${item.description.slice(0, 80)}...`);
    });
  }
}

testAll().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
