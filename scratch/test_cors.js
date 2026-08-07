const express = require('express');
const app = require('../app');
const http = require('http');

async function testCorsHeaders() {
    console.log('Testing Universal CORS Headers on app.js...');
    const server = http.createServer(app);
    server.listen(0, () => {
        const port = server.address().port;

        const endpoints = [
            '/api/v1/profile',
            '/api/v1/customers',
            '/api/v1/notifications',
            '/api/v1/auth/heartbeat',
            '/api/v1/settings',
            '/api/v1/public/announcement'
        ];

        let completed = 0;

        endpoints.forEach(ep => {
            const options = {
                hostname: '127.0.0.1',
                port: port,
                path: ep,
                method: 'OPTIONS',
                headers: {
                    'Origin': 'https://cliksbusiness.com',
                    'Access-Control-Request-Method': 'GET',
                    'Access-Control-Request-Headers': 'Authorization, Content-Type'
                }
            };

            const req = http.request(options, (res) => {
                console.log(`[${ep}] Status: ${res.statusCode}, Allow-Origin: ${res.headers['access-control-allow-origin']}`);
                completed++;
                if (completed === endpoints.length) {
                    server.close();
                    console.log('🎉 ALL CORS PREFLIGHT TESTS PASSED SUCCESSFULLY!');
                }
            });

            req.on('error', (e) => {
                console.error(e);
                server.close();
            });
            req.end();
        });
    });
}

testCorsHeaders();
