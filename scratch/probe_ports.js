const axios = require('axios');

const ports = [8000, 5000, 3000, 5001, 8080];
async function check() {
  for (const port of ports) {
    try {
      console.log(`Checking port ${port}...`);
      const res = await axios.get(`http://localhost:${port}/api/v1/health`);
      console.log(`Port ${port} responds! Data:`, res.data);
    } catch (e) {
      // ignore
    }
  }
}

check();
