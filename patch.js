const fs = require('fs');
const file = '/Users/hi/Desktop/Cliks/CLIKS-BE/routes/customers.js';
let content = fs.readFileSync(file, 'utf8');
content = content.replace("const customerController = require('../controllers/customerController');", "const customerController = require('../controllers/customerController');\nconst customerCrmController = require('../controllers/customerCrmController');");
content = content.replace("router.get('/:id', authenticateToken, customerController.getCustomerById);", "router.get('/:id/ledger', authenticateToken, customerCrmController.getLedger);\nrouter.get('/:id', authenticateToken, customerController.getCustomerById);");
fs.writeFileSync(file, content);
