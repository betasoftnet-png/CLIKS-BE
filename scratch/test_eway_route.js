const axios = require('axios');

async function testRoute() {
  console.log('Testing payload mapping directly against sandbox...');
  const mastersIndiaService = require('../services/mastersIndiaService');

  const payload = {
    userGstin: "05AAABB0639G1Z8",
    supply_type: "outward",
    sub_supply_type: "Supply",
    document_type: "Tax Invoice",
    document_number: "INV-" + Math.floor(1000 + Math.random() * 9000),
    document_date: "15/09/2026",
    gstin_of_consignor: "05AAABB0639G1Z8",
    legal_name_of_consignor: "Welton Consignor",
    address1_of_consignor: "Dehradun Industrial Area",
    place_of_consignor: "Dehradun",
    pincode_of_consignor: 248001,
    state_of_consignor: "UTTARAKHAND",
    actual_from_state_name: "UTTARAKHAND",
    gstin_of_consignee: "05AAABC0181E1ZE",
    legal_name_of_consignee: "Sthuthya Consignee",
    address1_of_consignee: "Rajpur Road",
    place_of_consignee: "Dehradun",
    pincode_of_consignee: 248001,
    state_of_supply: "UTTARAKHAND",
    actual_to_state_name: "UTTARAKHAND",
    taxable_amount: 50000,
    cgst_amount: 4500,
    sgst_amount: 4500,
    igst_amount: 0,
    total_invoice_value: 59000,
    transporter_id: "05AAABB0639G1Z8",
    transporter_name: "Jay Trans",
    transportation_mode: "Road",
    transportation_distance: "25",
    vehicle_number: "UK07AB1234",
    vehicle_type: "Regular",
    itemList: [
      {
        product_name: "Wheat",
        product_description: "Wheat",
        hsn_code: 1001,
        quantity: 1,
        unit_of_product: "BOX",
        cgst_rate: 9,
        sgst_rate: 9,
        igst_rate: 0,
        taxable_amount: 50000
      }
    ]
  };

  const res = await mastersIndiaService.generateEWayBill(payload);
  console.log('Result:', JSON.stringify(res.results?.message || res, null, 2));
}

testRoute().catch(console.error);
