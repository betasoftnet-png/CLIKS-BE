const http = require('http');
const app = require('../app');

async function testSplitUploadCors() {
  console.log('Testing CORS on /api/v1/split-expenses/upload...');
  const server = http.createServer(app);
  server.listen(0, () => {
    const port = server.address().port;

    // 1. Test OPTIONS Preflight
    const preflightOptions = {
      hostname: '127.0.0.1',
      port: port,
      path: '/api/v1/split-expenses/upload',
      method: 'OPTIONS',
      headers: {
        'Origin': 'https://cliksbusiness.com',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Content-Type, Authorization, X-Requested-With, Accept'
      }
    };

    const preflightReq = http.request(preflightOptions, (res) => {
      console.log(`[OPTIONS /api/v1/split-expenses/upload] Status: ${res.statusCode}`);
      console.log(`  Access-Control-Allow-Origin: ${res.headers['access-control-allow-origin']}`);
      console.log(`  Access-Control-Allow-Methods: ${res.headers['access-control-allow-methods']}`);
      console.log(`  Access-Control-Allow-Headers: ${res.headers['access-control-allow-headers']}`);

      if (res.headers['access-control-allow-origin'] !== 'https://cliksbusiness.com') {
        console.error('FAIL: Allow-Origin header missing or mismatched');
        server.close();
        process.exit(1);
      }

      // 2. Test POST Upload with Origin header
      const postData = JSON.stringify({
        name: 'test_cors_file.png',
        content: Buffer.from('test image content').toString('base64')
      });

      const postOptions = {
        hostname: '127.0.0.1',
        port: port,
        path: '/api/v1/split-expenses/upload',
        method: 'POST',
        headers: {
          'Origin': 'https://cliksbusiness.com',
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        }
      };

      const postReq = http.request(postOptions, (postRes) => {
        let body = '';
        postRes.on('data', chunk => body += chunk);
        postRes.on('end', () => {
          console.log(`[POST /api/v1/split-expenses/upload] Status: ${postRes.statusCode}`);
          console.log(`  Access-Control-Allow-Origin: ${postRes.headers['access-control-allow-origin']}`);
          console.log(`  Response: ${body}`);

          if (postRes.headers['access-control-allow-origin'] === 'https://cliksbusiness.com') {
            console.log('✅ CORS AND UPLOAD TEST SUCCEEDED 100%!');
          } else {
            console.error('FAIL: Post Allow-Origin header missing or mismatched');
          }
          server.close();
          process.exit(0);
        });
      });

      postReq.on('error', (err) => {
        console.error('POST error:', err);
        server.close();
        process.exit(1);
      });

      postReq.write(postData);
      postReq.end();
    });

    preflightReq.on('error', (err) => {
      console.error('Preflight error:', err);
      server.close();
      process.exit(1);
    });

    preflightReq.end();
  });
}

testSplitUploadCors();
