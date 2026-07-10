const axios = require('axios');

async function run() {
  try {
    console.log("Creating transaction on production using developer-token...");
    const txRes = await axios.post('https://cliks.beta-softnet.com/api/v1/transactions', {
      type: 'income',
      amount: 450,
      category: 'Income',
      description: 'Axios Production Test',
      date: new Date().toISOString().split('T')[0]
    }, {
      headers: {
        Authorization: `Bearer developer-token`
      }
    });

    console.log("Production Transaction created successfully!", txRes.data);
  } catch (err) {
    console.error("Production API test failed:", err.response ? err.response.data : err.message);
  }
}

run();
