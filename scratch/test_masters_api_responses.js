const mastersIndiaService = require('../services/mastersIndiaService');

async function testStateName() {
  const payload = {
    supply_type: 'O',
    sub_supply_type: '1',
    document_type: 'INV',
    document_number: 'INV-' + Math.floor(1000 + Math.random() * 9000),
    document_date: '15/09/2026',
    gstin_of_consignor: '05AAAPG7885R002',
    legal_name_of_consignor: 'MastersIndia UP',
    address1_of_consignor: 'Rajpur Road',
    place_of_consignor: 'Dehradun',
    pincode_of_consignor: 248001,
    state_of_consignor: 'UTTARAKHAND',
    gstin_of_consignee: '09AAAPG7885R002',
    legal_name_of_consignee: 'Client Enterprise',
    address1_of_consignee: 'Sector 62',
    place_of_consignee: 'Noida',
    pincode_of_consignee: 201301,
    state_of_supply: 'UTTAR PRADESH',
    total_taxable_amount: 10000,
    cgst_amount: 0,
    sgst_amount: 0,
    igst_amount: 1800,
    cess_amount: 0,
    total_invoice_amount: 11800,
    trans_mode: '1',
    distance: 250,
    transporter_name: 'Bluedart Cargo',
    transporter_id: '05AAABB0639G1Z8',
    vehicle_number: 'MH02EH9081',
    vehicle_type: 'R',
    itemList: [
      {
        item_no: 1,
        product_name: 'Steel Rods',
        product_description: 'Industrial rods',
        hsn_code: 7214,
        quantity: 10,
        qty_unit: 'NOS',
        taxable_amount: 10000,
        cgst_rate: 0,
        sgst_rate: 0,
        igst_rate: 18,
        cess_rate: 0
      }
    ]
  };

  const res = await mastersIndiaService.generateEWayBill(payload);
  console.log('Result with State Names:', JSON.stringify(res, null, 2));
}

testStateName().catch(console.error);
