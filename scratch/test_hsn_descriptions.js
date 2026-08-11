const hsnController = require('../controllers/hsnController');

async function testHsnDescription(code) {
  const req = { query: { q: code } };
  let results = [];
  const res = {
    status: function() { return this; },
    json: function(payload) {
      results = payload.data || [];
      return this;
    }
  };
  await hsnController.searchHSN(req, res);
  const match = results.find(r => String(r.hsnCode).trim() === code) || results[0];
  console.log(`\nHSN Code: [${code}]`);
  if (match) {
    console.log(`Matched Code: [${match.hsnCode}]`);
    console.log(`Description: ${match.description}`);
  } else {
    console.log('No description found');
  }
}

async function runAllDescriptionTests() {
  const codes = ['9503', '1006', '1003', '1001', '8517', '8471'];
  for (const c of codes) {
    await testHsnDescription(c);
  }
}

runAllDescriptionTests().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
