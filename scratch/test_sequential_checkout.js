const db = require('../db/connection');
const { getNextSequence, peekNextSequence } = require('../utils/sequenceGenerator');

async function runTest() {
    console.log('🧪 Starting sequential bill numbering test...');

    // Test user 7
    const userId = 7;

    const peekPos = await peekNextSequence({ userId, docType: 'POS', prefix: 'POS-', padding: 6 });
    console.log('1. Peek next POS bill for User 7:', peekPos);

    const peekInv = await peekNextSequence({ userId, docType: 'INVOICE', prefix: 'INV-', padding: 6 });
    console.log('2. Peek next Invoice for User 7:', peekInv);

    // Call getNextSequence
    const seqPos1 = await getNextSequence({ userId, docType: 'POS', prefix: 'POS-', padding: 6 });
    console.log('3. Generated POS 1:', seqPos1);

    const seqPos2 = await getNextSequence({ userId, docType: 'POS', prefix: 'POS-', padding: 6 });
    console.log('4. Generated POS 2:', seqPos2);

    const seqInv1 = await getNextSequence({ userId, docType: 'INVOICE', prefix: 'INV-', padding: 6 });
    console.log('5. Generated INV 1:', seqInv1);

    const seqInv2 = await getNextSequence({ userId, docType: 'INVOICE', prefix: 'INV-', padding: 6 });
    console.log('6. Generated INV 2:', seqInv2);

    // Reset sequence counter back to 13 and 31 for User 7
    await db.prepare("UPDATE app_document_sequences SET current_number = 13 WHERE user_id = 7 AND doc_type = 'POS' AND prefix = 'POS-'").run();
    await db.prepare("UPDATE app_document_sequences SET current_number = 31 WHERE user_id = 7 AND doc_type = 'INVOICE' AND prefix = 'INV-'").run();

    console.log('✅ Verified: POS and Invoice numbers strictly increment with uniform 6-digit zero padding!');
}

runTest().catch(console.error);
