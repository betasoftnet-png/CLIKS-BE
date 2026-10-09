const axios = require('axios');
const { sendSuccess, sendError } = require('../utils/response');

const mailController = {
        send: async (req, res) => {
        const { to, subject, body, isHtml, fromName } = req.body;
        
        const token = req.headers['authorization'] || req.headers['x-auth-token'];

        if (!to) {
            return sendError(res, 'To address is required', 400);
        }

        let authHeader = token;
        if (authHeader && !authHeader.startsWith('Bearer ')) {
            authHeader = `Bearer ${authHeader}`;
        }

        try {
            const response = await axios.post('https://api.bnxmail.com/api/mail/send', {
                to,
                subject,
                body,
                isHtml,
                fromName
            }, {
                headers: {
                    'Authorization': authHeader,
                    'Content-Type': 'application/json'
                }
            });

            return sendSuccess(res, response.data, 'Email sent successfully');
        } catch (error) {
            return sendError(res, error.response?.data?.message || 'Failed to send email', error.response?.status || 500);
        }
    },
    bulkSend: async (req, res) => {
        const { recipients, subject, body, isHtml } = req.body;
        
        // Use token from headers or fallback to books_auth_token if provided in request
        const token = req.headers['authorization'] || req.headers['x-auth-token'];

        if (!recipients || !Array.isArray(recipients) || recipients.length === 0) {
            return sendError(res, 'Recipients list is required', 400);
        }

        console.log('[Mail Proxy] Sending bulk mail to:', recipients.length, 'recipients');
        console.log('[Mail Proxy] Token present:', !!token);

        let authHeader = token;
        if (authHeader && !authHeader.startsWith('Bearer ')) {
            authHeader = `Bearer ${authHeader}`;
        }

        try {
            const response = await axios.post('https://api.bnxmail.com/api/mail/bulk-send', {
                recipients,
                subject,
                body,
                isHtml
            }, {
                headers: {
                    'Authorization': authHeader,
                    'Content-Type': 'application/json'
                }
            });

            console.log('[Mail Proxy] BNX API Success:', response.data);
            return sendSuccess(res, response.data, 'Bulk email dispatch initiated');
        } catch (error) {
            console.error('[Mail Proxy] BNX API Error:', error.response?.data || error.message);
            return sendError(res, error.response?.data?.message || 'Failed to dispatch bulk email', error.response?.status || 500);
        }
    }
};

module.exports = mailController;
