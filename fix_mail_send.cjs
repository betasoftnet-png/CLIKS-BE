const fs = require('fs');
const filePathCtrl = '/Users/hi/Desktop/Cliks/CLIKS-BE/controllers/mailController.js';
let contentCtrl = fs.readFileSync(filePathCtrl, 'utf8');

const sendMethod = `    send: async (req, res) => {
        const { to, subject, body, isHtml, fromName } = req.body;
        
        const token = req.headers['authorization'] || req.headers['x-auth-token'];

        if (!to) {
            return sendError(res, 'To address is required', 400);
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
                    'Authorization': token,
                    'Content-Type': 'application/json'
                }
            });

            return sendSuccess(res, response.data, 'Email sent successfully');
        } catch (error) {
            return sendError(res, error.response?.data?.message || 'Failed to send email', error.response?.status || 500);
        }
    },
    bulkSend: async (req, res) => {`;

if (!contentCtrl.includes('send: async (req, res)')) {
    contentCtrl = contentCtrl.replace('bulkSend: async (req, res) => {', sendMethod);
    fs.writeFileSync(filePathCtrl, contentCtrl);
    console.log('Added send method to mailController.js');
}

const filePathRoutes = '/Users/hi/Desktop/Cliks/CLIKS-BE/routes/mail.js';
let contentRoutes = fs.readFileSync(filePathRoutes, 'utf8');

if (!contentRoutes.includes("router.post('/send'")) {
    contentRoutes = contentRoutes.replace("router.post('/bulk-send'", "router.post('/send', auth, mailController.send);\nrouter.post('/bulk-send'");
    fs.writeFileSync(filePathRoutes, contentRoutes);
    console.log('Added /send route to mail.js');
}
