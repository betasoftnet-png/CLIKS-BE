const hsnController = require('../controllers/hsnController');

async function runApiTest() {
  const req = {
    query: { q: 'macbook' }
  };
  const res = {
    status: function(statusCode) {
      this.statusCode = statusCode;
      return this;
    },
    json: function(payload) {
      this.body = payload;
      return this;
    }
  };

  console.log('--- Testing HSN Search Controller for query: "macbook" ---');
  await hsnController.searchHSN(req, res);
  console.log('Response Status:', res.statusCode || 200);
  console.log('Response Body:', JSON.stringify(res.body, null, 2));

  console.log('\n--- Testing HSN Search Controller for query: "0101" ---');
  req.query.q = '0101';
  await hsnController.searchHSN(req, res);
  console.log('Response Body data length:', res.body.data.length);
  console.log('First 2 results:', res.body.data.slice(0, 2));
}

runApiTest().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
