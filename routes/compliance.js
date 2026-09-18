const express = require('express');
const router = express.Router();
const db = require('../db/connection');
const mastersIndiaService = require('../services/mastersIndiaService');
const { sendSuccess, sendError } = require('../utils/response');
const { requireBusinessAccount } = require('../middleware/auth');

// Ensure eway_bills table exists on startup/query
(async () => {
  try {
    if (db.raw) {
      db.raw.exec(`
        CREATE TABLE IF NOT EXISTS eway_bills (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER,
          business_id INTEGER,
          eway_bill_no TEXT UNIQUE,
          carrier_name TEXT,
          vehicle_no TEXT,
          distance_km REAL,
          from_place TEXT,
          to_place TEXT,
          status TEXT DEFAULT 'GENERATED',
          pdf_url TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
      `);
    } else {
      await db.query(`
        CREATE TABLE IF NOT EXISTS eway_bills (
          id SERIAL PRIMARY KEY,
          user_id INTEGER,
          business_id INTEGER,
          eway_bill_no VARCHAR(50) UNIQUE,
          carrier_name VARCHAR(255),
          vehicle_no VARCHAR(50),
          distance_km NUMERIC,
          from_place VARCHAR(100),
          to_place VARCHAR(100),
          status VARCHAR(50) DEFAULT 'GENERATED',
          pdf_url TEXT,
          created_at TIMESTAMP DEFAULT NOW()
        );
      `);
    }
  } catch (err) {
    console.warn('[ComplianceRoute] Ensure eway_bills table note:', err.message);
  }
})();

/**
 * Helper: Format date as DD/MM/YYYY for Masters India
 */
function formatDateDDMMYYYY(dateInput) {
  if (!dateInput) {
    const d = new Date();
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
  }
  if (typeof dateInput === 'string' && /^\d{2}\/\d{2}\/\d{4}$/.test(dateInput)) {
    return dateInput;
  }
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) {
    const today = new Date();
    return `${String(today.getDate()).padStart(2, '0')}/${String(today.getMonth() + 1).padStart(2, '0')}/${today.getFullYear()}`;
  }
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

/**
 * Helper: Format full address string from Masters India address object
 */
function formatAddress(addrObj) {
  if (!addrObj) return '';
  if (typeof addrObj === 'string') return addrObj;
  const parts = [
    addrObj.flno,
    addrObj.bno,
    addrObj.bnm,
    addrObj.st,
    addrObj.locality,
    addrObj.loc,
    addrObj.dst,
    addrObj.stcd,
    addrObj.pncd
  ].filter(p => p && String(p).trim().length > 0 && String(p).trim() !== 'NA');
  return parts.join(', ');
}

// ────────────────────────────────────────────────────────────────────────────
// 1. GET /api/v1/compliance/verify-gstin/:gstin
// ────────────────────────────────────────────────────────────────────────────
router.get('/verify-gstin/:gstin', async (req, res) => {
  try {
    const { gstin } = req.params;
    if (!gstin || gstin.trim().length !== 15) {
      return sendError(res, 'GSTIN must be a 15-character alphanumeric identifier.', 400);
    }

    const cleanGstin = gstin.trim().toUpperCase();
    const rawResult = await mastersIndiaService.searchGstin(cleanGstin);

    // Masters India returns payload in either `data` or root
    const data = rawResult.data || rawResult.results || rawResult;

    const pradrAddr = data.pradr?.addr || {};
    const formattedAddr = formatAddress(pradrAddr);
    const regType = data.dty || (data.ctb ? 'Regular' : 'Regular');

    const result = {
      gstin: data.gstin || cleanGstin,
      legalName: data.lgnm || data.tradeNam || '',
      tradeName: data.tradeNam || data.lgnm || '',
      status: data.sts || 'Active',
      registrationType: regType,
      address: formattedAddr || '',
      pincode: pradrAddr.pncd || '',
      city: pradrAddr.loc || pradrAddr.dst || '',
      state: pradrAddr.stcd || '',
      stateCode: cleanGstin.slice(0, 2),
      ctb: data.ctb || '',
      einvoiceStatus: data.einvoiceStatus || 'No',
      raw: data
    };

    return sendSuccess(res, result, 'GSTIN verified successfully');
  } catch (error) {
    console.error('[ComplianceRoute] verify-gstin Error:', error.message);
    return sendError(res, error.message || 'Failed to verify GSTIN with Masters India API', 500);
  }
});

// ────────────────────────────────────────────────────────────────────────────
// 2. POST /api/v1/compliance/generate-einvoice (and /generate-irn)
// ────────────────────────────────────────────────────────────────────────────
router.post(['/generate-einvoice', '/generate-irn', '/einvoice'], async (req, res) => {
  try {
    const taxableAmount = Number(req.body.taxable_value || req.body.taxable_amount || 1000);
    const docNo = req.body.document_number || `CLK-INV-${Math.floor(1000 + Math.random() * 9000)}`;
    const docDate = req.body.document_date ? formatDateDDMMYYYY(req.body.document_date) : "16/09/2026";
    const buyerGstin = req.body.buyer_details?.gstin || req.body.customer_gstin || "09AAAPG7885R002";
    const clientName = req.body.buyer_details?.legal_name || req.body.customer_name || req.body.client_name || "Sthuthya Consignee";
    const prodName = req.body.product_name || req.body.sender_product_name || req.body.receiver_product_name || "Wheat";
    
    // Masters India requires at least 6 digits for HSN
    let rawHsn = String(req.body.hsn_code || "1001");
    let hsnCode = rawHsn.length >= 6 ? rawHsn : (rawHsn === "1001" ? "100190" : rawHsn.padEnd(6, "0"));
    const qty = Number(req.body.quantity || 1);
    const unit = req.body.unit || "BOX";
    const gstRate = 18;
    const igstAmount = Number((taxableAmount * 0.18).toFixed(2));
    const totalInvoiceValue = Number((taxableAmount + igstAmount).toFixed(2));

    const payload = {
      user_gstin: "05AAAPG7885R002",
      data_source: "erp",
      transaction_details: {
        supply_type: "B2B",
        charge_type: "N",
        igst_on_intra: "N"
      },
      document_details: {
        document_type: "INV",
        document_number: docNo,
        document_date: docDate
      },
      seller_details: {
        gstin: "05AAAPG7885R002",
        legal_name: "Welton Consignor",
        address1: "Dehradun Central",
        location: "Dehradun",
        pincode: 248001,
        state_code: "05"
      },
      buyer_details: {
        gstin: buyerGstin,
        legal_name: clientName,
        place_of_supply: "09",
        address1: "Noida Sector 62",
        location: "Noida",
        pincode: 201301,
        state_code: "09"
      },
      item_list: [{
        item_serial_number: "1",
        product_description: prodName,
        is_service: "N",
        hsn_code: hsnCode,
        quantity: qty,
        unit: unit,
        unit_price: taxableAmount,
        total_amount: taxableAmount,
        assessable_value: taxableAmount,
        gst_rate: gstRate,
        igst_amount: igstAmount,
        cgst_amount: 0,
        sgst_amount: 0,
        total_item_value: totalInvoiceValue
      }],
      value_details: {
        total_assessable_value: taxableAmount,
        total_igst_value: igstAmount,
        total_cgst_value: 0,
        total_sgst_value: 0,
        total_invoice_value: totalInvoiceValue
      }
    };

    console.log('>>> [E-INVOICE] Calling Masters India API with docNo:', docNo);
    const einvResponse = await mastersIndiaService.generateIRN(payload);
    const results = einvResponse.results || einvResponse.data || einvResponse;

    if (einvResponse.status === 'Failed' || einvResponse.code === 204 || einvResponse.errorMessage || results.status === 'Failed' || results.code === 204 || results.errorMessage) {
      const errMsg = einvResponse.errorMessage || results.errorMessage || (typeof results.message === 'string' && results.message) || results.ErrorMessage || 'Failed to generate e-Invoice from Masters India';
      console.warn('[ComplianceRoute] Masters India rejected e-Invoice:', errMsg);
      return res.status(400).json({
        success: false,
        message: errMsg,
        errorMessage: errMsg,
        results: { message: errMsg },
        error: { message: errMsg }
      });
    }

    const resMsg = results.message || results || {};
    const pdfUrl = resMsg.EinvoicePdf || resMsg.QRCodeUrl || null;
    const irn = resMsg.Irn || resMsg.irn || '';
    const ackNo = resMsg.AckNo || resMsg.ack_no || '';
    const ackDt = resMsg.AckDt || resMsg.ack_date || '';
    const signedQrCode = resMsg.SignedQRCode || resMsg.signed_qr_code || '';
    const signedInvoice = resMsg.SignedInvoice || resMsg.signed_invoice || '';

    const nowIso = new Date().toISOString();
    const userId = req.user?.id || req.user?.userId || 1;

    // 1. Save to invoices DB table so GET queries return it:
    try {
      await db.query(`
        INSERT INTO invoices (
          user_id,
          invoice_number,
          customer_name,
          customer_gstin,
          taxable_amount,
          total_amount,
          irn,
          ack_no,
          ack_date,
          signed_qr,
          pdf_url,
          status,
          created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'GENERATED', NOW())
        ON CONFLICT (invoice_number) 
        DO UPDATE SET 
          customer_name = EXCLUDED.customer_name,
          customer_gstin = EXCLUDED.customer_gstin,
          taxable_amount = EXCLUDED.taxable_amount,
          total_amount = EXCLUDED.total_amount,
          irn = EXCLUDED.irn,
          ack_no = EXCLUDED.ack_no,
          ack_date = EXCLUDED.ack_date,
          signed_qr = EXCLUDED.signed_qr,
          pdf_url = EXCLUDED.pdf_url,
          status = 'GENERATED';
      `, [
        userId,
        docNo,
        clientName,
        buyerGstin,
        taxableAmount,
        totalInvoiceValue,
        irn,
        String(ackNo),
        ackDt,
        signedQrCode,
        pdfUrl
      ]);
      console.log('>>> [E-INVOICE] Successfully upserted into invoices table for docNo:', docNo);
    } catch (saveInvErr) {
      console.warn('[ComplianceRoute] invoices table save error:', saveInvErr.message);
    }

    let savedGstId = null;
    // 2. Save into gst_invoices table
    try {
      const insertGst = await db.prepare(`
        INSERT INTO gst_invoices (
          user_id, invoice_number, client_name, customer_name, customer_gstin, customer_state,
          sender_name, sender_gstin, sender_state, amount, gst_amount, 
          invoice_type, place_of_supply, taxable_value, gst_percentage, 
          cgst, sgst, igst, cgst_amount, sgst_amount, igst_amount, total_tax, 
          reverse_charge, total_invoice, tax_type, irn_number, qr_status, is_eway_bill, is_reconciliation,
          created_at, updated_at, product_name, pdf_url
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Exclusive', ?, 'Signed', 'false', 'false', ?, ?, ?, ?)
      `).run(
        userId,
        docNo,
        clientName,
        clientName,
        buyerGstin,
        '09 - Uttar Pradesh',
        payload.seller_details.legal_name,
        payload.seller_details.gstin,
        '05 - Uttarakhand',
        totalInvoiceValue,
        igstAmount,
        req.body.invoice_type || 'B2B',
        req.body.place_of_supply || '09-Uttar Pradesh',
        taxableAmount,
        gstRate,
        0, 0, igstAmount,
        0, 0, igstAmount,
        igstAmount,
        req.body.reverse_charge || 'No',
        totalInvoiceValue,
        irn,
        nowIso,
        nowIso,
        prodName,
        pdfUrl
      );
      savedGstId = insertGst?.lastInsertRowid;
    } catch (saveGstErr) {
      console.warn('[ComplianceRoute] gst_invoices save error with product_name:', saveGstErr.message);
      try {
        const fallbackInsert = await db.prepare(`
          INSERT INTO gst_invoices (
            user_id, invoice_number, client_name, customer_name, customer_gstin, customer_state,
            sender_name, sender_gstin, sender_state, amount, gst_amount, 
            invoice_type, place_of_supply, taxable_value, gst_percentage, 
            cgst, sgst, igst, cgst_amount, sgst_amount, igst_amount, total_tax, 
            reverse_charge, total_invoice, tax_type, irn_number, qr_status, is_eway_bill, is_reconciliation,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Exclusive', ?, 'Signed', 'false', 'false', ?, ?)
        `).run(
          userId,
          docNo,
          clientName,
          clientName,
          buyerGstin,
          '09 - Uttar Pradesh',
          payload.seller_details.legal_name,
          payload.seller_details.gstin,
          '05 - Uttarakhand',
          totalInvoiceValue,
          igstAmount,
          req.body.invoice_type || 'B2B',
          req.body.place_of_supply || '09-Uttar Pradesh',
          taxableAmount,
          gstRate,
          0, 0, igstAmount,
          0, 0, igstAmount,
          igstAmount,
          req.body.reverse_charge || 'No',
          totalInvoiceValue,
          irn,
          nowIso,
          nowIso
        );
        savedGstId = fallbackInsert?.lastInsertRowid;
      } catch (fallbackErr) {
        console.warn('[ComplianceRoute] gst_invoices fallback save error:', fallbackErr.message);
      }
    }

    // 3. Save / update sales_invoices
    try {
      await db.prepare(`
        INSERT INTO sales_invoices (
          user_id, invoice_number, client_name, client_gstin, total_amount, status,
          AckNo, AckDt, Irn, SignedQRCode, signed_invoice, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'IRN Active', ?, ?, ?, ?, ?, ?, ?)
      `).run(
        userId,
        docNo,
        clientName,
        buyerGstin,
        totalInvoiceValue,
        String(ackNo),
        String(ackDt),
        irn,
        signedQrCode,
        signedInvoice,
        nowIso,
        nowIso
      );
    } catch (saveSalesErr) {
      console.warn('[ComplianceRoute] sales_invoices save error:', saveSalesErr.message);
    }

    // 4. Return unified response for frontend hydration
    const returnData = {
      id: savedGstId || Date.now(),
      invoice_number: docNo,
      document_number: docNo,
      irn: irn,
      irn_number: irn,
      AckNo: ackNo,
      ack_no: ackNo,
      AckDt: ackDt,
      ack_date: ackDt,
      date: ackDt,
      SignedQRCode: signedQrCode,
      signed_qr_code: signedQrCode,
      EinvoicePdf: pdfUrl,
      einvoice_pdf_url: pdfUrl,
      pdf_url: pdfUrl,
      status: 'Generated',
      invoice_type: req.body.invoice_type || 'B2B',
      customer_name: clientName,
      client_name: clientName,
      customer_gstin: buyerGstin,
      taxable_amount: taxableAmount,
      taxable_value: taxableAmount,
      amount: taxableAmount,
      total_tax: igstAmount,
      tax_amount: igstAmount,
      igst_amount: igstAmount,
      cgst_amount: 0,
      sgst_amount: 0,
      total_amount: totalInvoiceValue,
      total_invoice: totalInvoiceValue,
      gst_percentage: gstRate,
      product_name: prodName,
      sender_product_name: prodName,
      receiver_product_name: prodName,
      results: {
        message: resMsg
      }
    };

    return res.status(200).json({
      success: true,
      results: { message: resMsg },
      pdf_url: pdfUrl,
      data: returnData,
      ...returnData
    });

  } catch (error) {
    console.error('[ComplianceRoute] generate-einvoice Fatal Error:', error.message);
    return res.status(400).json({
      success: false,
      message: error.message || 'Failed to generate e-Invoice',
      errorMessage: error.message || 'Failed to generate e-Invoice',
      error: { message: error.message }
    });
  }
});


// ────────────────────────────────────────────────────────────────────────────
// 3. POST /api/v1/compliance/generate-ewaybill
// ────────────────────────────────────────────────────────────────────────────
router.post('/generate-ewaybill', async (req, res) => {
  try {
    const {
      challanNumber,
      invoiceNumber: rawInvNo,
      invoice_number: rawInvNo2,
      customerName: rawCustName,
      client_name: rawClientName,
      customer_name: rawCustName2,
      shippingAddress: rawShipAddr,
      shipping_address: rawShipAddr2,
      delivery_location: rawDelivLoc,
      deliveryLocation: rawDelivLoc2,
      dispatch_location: rawDispLoc,
      dispatchLocation: rawDispLoc2,
      transporter_name: rawTransName,
      transporterName: rawTransName2,
      transporter_gstin: rawTransGstin,
      transporterGstin: rawTransGstin2,
      vehicleNumber: rawVehNo,
      vehicle_number: rawVehNo2,
      transportMode = '1',
      transport_mode,
      distance = 50,
      transport_distance,
      sellerGstin,
      sellerName,
      sellerAddress,
      sellerPlace,
      sellerPincode,
      sellerStateCode,
      buyerGstin,
      buyerPlace,
      buyerPincode,
      buyerStateCode,
      docDate,
      invoice_date,
      items,
      totalAmount,
      total_amount,
      goods_total_value,
      taxable_value
    } = req.body;

    const documentNumber = 
      req.body.document_number || 
      req.body.invoice_number || 
      req.body.docNo || 
      rawInvNo || 
      rawInvNo2 || 
      challanNumber || 
      `CLK-${Date.now()}`;
    const invoiceNumber = documentNumber;
    const invoiceDate = docDate || invoice_date || req.body.document_date;
    const formattedDocDt = formatDateDDMMYYYY(invoiceDate);

    const taxableVal = Number(req.body.taxable_value || req.body.taxable_amount || req.body.goods_taxable_value || totalAmount || total_amount || 50000) || 50000;
    const cgstAmt = Math.round(taxableVal * 0.09 * 100) / 100 || 4500;
    const sgstAmt = Math.round(taxableVal * 0.09 * 100) / 100 || 4500;
    const igstAmt = 0;
    const totalInvVal = Math.round((taxableVal + cgstAmt + sgstAmt) * 100) / 100 || 59000;

    const rawVehicle = req.body.vehicle_number || rawVehNo || rawVehNo2 || 'UK07AB1234';
    const cleanVehicle = (rawVehicle || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase() || 'UK07AB1234';

    const rawDistance = req.body.distance !== undefined && req.body.distance !== null && req.body.distance !== '' ? req.body.distance : (transport_distance !== undefined ? transport_distance : (distance || '25'));
    const transDistance = String(rawDistance || '25');

    const rawItems = Array.isArray(req.body.itemList) && req.body.itemList.length > 0 ? req.body.itemList :
                     Array.isArray(items) && items.length > 0 ? items : [
      {
        product_name: req.body.product_name || req.body.goods_product_name || "Wheat",
        product_description: req.body.product_description || req.body.product_name || req.body.goods_product_name || "Wheat",
        hsn_code: Number(req.body.hsn_code || req.body.goods_hsn_code) || 1001,
        quantity: Number(req.body.quantity || req.body.goods_quantity) || 1,
        unit_of_product: req.body.unit || req.body.unit_of_product || req.body.goods_unit || "BOX",
        cgst_rate: 9,
        sgst_rate: 9,
        igst_rate: 0,
        taxable_amount: taxableVal
      }
    ];

    const mappedItemList = rawItems.map(itm => ({
      product_name: itm.product_name || itm.description || itm.name || "Wheat",
      product_description: itm.product_description || itm.description || itm.product_name || "Wheat",
      hsn_code: Number(itm.hsn_code || itm.hsn) || 1001,
      quantity: Number(itm.quantity || itm.qty) || 1,
      unit_of_product: itm.unit_of_product || itm.unit || "BOX",
      cgst_rate: 9,
      sgst_rate: 9,
      igst_rate: 0,
      taxable_amount: Number(itm.taxable_amount || itm.price || taxableVal) || taxableVal
    }));

    // Designated sandbox transporter ID as per Masters India Enterprise API specification
    const SANDBOX_TRANSPORTER_ID = "05AAAAU6537D1ZO";
    const SANDBOX_TRANSPORTER_NAME = "M/S UTTARAYAN CO-OPERATIVE FOR RENEWABLE ENERGY";
    const SANDBOX_RECOGNIZED_TRANSPORTERS = [
      "05AAAAU6537D1ZO",
      "05AAABC0181E1ZE",
      "05AAABB0639G1Z8"
    ];

    const rawTransId = req.body.transporter_id || req.body.transporterId || req.body.transporter_gstin || rawTransGstin || rawTransGstin2 || req.body.trans_id;
    let cleanTransporterId = (rawTransId || '').toString().trim().toUpperCase();

    // Use designated sandbox transporter ID if missing or dummy test ID passed to sandbox API
    if (!cleanTransporterId || cleanTransporterId === '27AAAAA1111A1Z1' || (!SANDBOX_RECOGNIZED_TRANSPORTERS.includes(cleanTransporterId) && cleanTransporterId.startsWith('27'))) {
      cleanTransporterId = SANDBOX_TRANSPORTER_ID;
    }

    let cleanTransporterName = req.body.transport_company_name || req.body.transporter_name || transporterName;
    if (!cleanTransporterName || cleanTransporterId === SANDBOX_TRANSPORTER_ID) {
      cleanTransporterName = cleanTransporterName || SANDBOX_TRANSPORTER_NAME;
    }

    const payload = {
      userGstin: "05AAABB0639G1Z8",
      supply_type: "outward",
      sub_supply_type: "Supply",
      document_type: "Tax Invoice",
      document_number: documentNumber,
      document_date: formattedDocDt,
      gstin_of_consignor: req.body.consignor_gstin || req.body.user_gstin || "05AAABB0639G1Z8",
      legal_name_of_consignor: req.body.consignor_name || req.body.sender_name || "Welton Consignor",
      address1_of_consignor: req.body.consignor_address || req.body.dispatch_location || dispatchLocation || "Dehradun Industrial Area",
      place_of_consignor: req.body.dispatch_location || "Dehradun",
      pincode_of_consignor: Number(req.body.consignor_pincode || 248001),
      state_of_consignor: (req.body.consignor_state || "UTTARAKHAND").toUpperCase(),
      actual_from_state_name: (req.body.consignor_state || "UTTARAKHAND").toUpperCase(),
      gstin_of_consignee: "05AAABC0181E1ZE",
      legal_name_of_consignee: "Sthuthya Consignee",
      address1_of_consignee: req.body.delivery_destination || req.body.delivery_location || shippingAddress || "Rajpur Road",
      place_of_consignee: "Dehradun",
      pincode_of_consignee: 248001,
      state_of_supply: "UTTARAKHAND",
      actual_to_state_name: "UTTARAKHAND",
      taxable_amount: taxableVal,
      cgst_amount: cgstAmt,
      sgst_amount: sgstAmt,
      igst_amount: igstAmt,
      total_invoice_value: totalInvVal,
      transporter_id: cleanTransporterId,
      transporter_name: cleanTransporterName,
      transportation_mode: "Road",
      transportation_distance: transDistance,
      vehicle_number: cleanVehicle,
      vehicle_type: "Regular",
      itemList: mappedItemList
    };

    let ewbResponse;
    try {
      ewbResponse = await mastersIndiaService.generateEWayBill(payload);
    } catch (apiErr) {
      console.error('[ComplianceRoute] Sandbox EWB Error:', apiErr.message);
      return res.status(400).json({
        success: false,
        message: apiErr.message || 'Failed to generate e-Way Bill',
        results: {
          message: apiErr.message || 'Failed to generate e-Way Bill'
        },
        error: {
          message: apiErr.message || 'Failed to generate e-Way Bill'
        }
      });
    }

    const results = ewbResponse.results || ewbResponse.data || ewbResponse;
    const msgObj = (results.message && typeof results.message === 'object') ? results.message : {};
    const rawEwbNo = msgObj.ewayBillNo || results.ewayBillNo || results.eway_bill_no || results.EwbNo || '';
    const parsedEwbNo = String(rawEwbNo || '').trim();

    // Check if Masters India sandbox returns a failure (e.g. code 204 or error message like "Invalid distance")
    const isFailed = results.status === 'Failed' || 
                     results.code === 204 || 
                     (typeof results.message === 'string' && results.message.trim().length > 0 && !/^\d{12}$/.test(parsedEwbNo)) ||
                     (results.errorMessage && !/^\d{12}$/.test(parsedEwbNo)) ||
                     !/^\d{12}$/.test(parsedEwbNo);

    if (isFailed) {
      const errMessage = (typeof results.message === 'string' && results.message) || 
                         results.errorMessage || 
                         results.InfoDtls || 
                         'Failed to generate e-Way Bill from sandbox API';
      console.warn('[ComplianceRoute] Masters India rejected EWB generation:', errMessage);
      return res.status(400).json({
        success: false,
        message: errMessage,
        results: { message: errMessage },
        error: { message: errMessage }
      });
    }

    const mastersRes = ewbResponse?.data ? ewbResponse : { data: ewbResponse };
    const ewbRes = mastersRes.data?.results?.message || mastersRes.data?.results || mastersRes.data || {};
    const ewayBillNo = String(ewbRes.EwbNo || ewbRes.ewayBillNo || req.body.eway_bill_number || parsedEwbNo || Date.now());
    const pdfUrl = ewbRes.EwaybillPdf || ewbRes.pdf_url || ewbRes.url || (ewayBillNo ? `https://sandb-api.mastersindia.co/api/v1/detailPrintPdf/${ewayBillNo}` : null);
    const ewbDate = ewbRes.EwbDt || ewbRes.ewayBillDate || formattedDocDt || new Date();
    const validUpto = ewbRes.EwbValidTill || ewbRes.validUpto || null;

    const finalEwbNo = ewayBillNo;
    const finalEwbDate = ewbDate;
    const finalValidUpto = validUpto;
    const finalPdfUrl = pdfUrl;

    try {
      await db.query(`
        INSERT INTO eway_bills (
          user_id, business_id, eway_bill_no, carrier_name, vehicle_no, distance_km, from_place, to_place, status, pdf_url, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'GENERATED', $9, NOW())
        ON CONFLICT (eway_bill_no) 
        DO UPDATE SET status = 'GENERATED', pdf_url = EXCLUDED.pdf_url;
      `, [
        req.user?.id || 1,
        req.user?.business_id || req.business?.id || 1,
        ewayBillNo,
        req.body.transporter_name || req.body.carrier_name || req.body.transport_company_name || transporterName || "Jay Trans",
        req.body.vehicle_number || req.body.vehicle_no || cleanVehicle || "UK07AB1234",
        Number(req.body.transportation_distance || req.body.distance_km || req.body.transport_distance || req.body.distance || 40),
        req.body.from_place || req.body.dispatch_location || dispatchLocation || "Dehradun",
        req.body.to_place || req.body.delivery_destination || req.body.delivery_location || shippingAddress || "Noida",
        pdfUrl
      ]);
      console.log('>>> [EWB-SAVE] Successfully saved into eway_bills table:', ewayBillNo);
    } catch (ewbDbErr) {
      console.error('>>> [EWB-SAVE-ERROR] Failed to save into eway_bills:', ewbDbErr.message);
    }

    // 2. Also keep delivery_challans in sync for legacy references
    const resolvedCarrierName = req.body.transporter_name || req.body.carrier_name || req.body.transport_company_name || cleanTransporterName || "Jay Trans";
    const resolvedVehicleNo = req.body.vehicle_number || cleanVehicle || "UK07AB1234";
    const resolvedDistance = Number(req.body.transportation_distance || req.body.distance_km || req.body.transport_distance || transDistance || 40);
    const resolvedFromPlace = req.body.from_place || req.body.dispatch_location || rawDispLoc || rawDispLoc2 || "Dehradun";
    const resolvedToPlace = req.body.to_place || req.body.delivery_destination || req.body.delivery_location || rawShipAddr || rawShipAddr2 || "Noida";
    const resolvedCustName = rawCustName || rawClientName || rawCustName2 || req.body.legal_name_of_consignee || 'Valued Client';
    const resolvedTransportMode = req.body.transportation_mode || req.body.transport_mode || transport_mode || transportMode || 'Road';
    const nowIso = new Date().toISOString();

    try {
      await db.query(`
        INSERT INTO delivery_challans (
          user_id,
          eway_bill_no,
          carrier_name,
          vehicle_number,
          distance,
          source_place,
          destination_place,
          status,
          valid_upto,
          pdf_url,
          created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
        ON CONFLICT DO NOTHING;
      `, [
        req.user?.id || 1,
        String(ewayBillNo),
        resolvedCarrierName,
        resolvedVehicleNo,
        String(resolvedDistance),
        resolvedFromPlace,
        resolvedToPlace,
        "GENERATED",
        validUpto,
        pdfUrl
      ]);
    } catch (dbErr) {
      // ignore
    }

    // 3. Save into gst_invoices table so BusinessGST.jsx immediately displays it in e-Way Logistics tab
    try {
      if (typeof db.prepare === 'function') {
        await db.prepare(`
          INSERT INTO gst_invoices (
            user_id, invoice_number, client_name, customer_name, transporter_name, vehicle_number,
            transport_distance, dispatch_location, delivery_location,
            status, eway_bill_no, eway_bill_number, is_eway_bill, is_reconciliation,
            transport_mode, transporter_gstin,
            amount, created_at, updated_at, reference_invoice,
            pdf_url, valid_upto, eway_bill_date
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Active', ?, ?, 'true', 'false', ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          req.user?.id || 1, documentNumber, resolvedCustName, resolvedCustName,
          resolvedCarrierName,
          resolvedVehicleNo,
          resolvedDistance,
          resolvedFromPlace,
          resolvedToPlace,
          finalEwbNo, finalEwbNo,
          resolvedTransportMode, cleanTransporterId || null,
          totalInvVal, nowIso, nowIso, documentNumber, finalPdfUrl, finalValidUpto, finalEwbDate
        );
      }
    } catch (saveGstErr) {
      console.warn('[ComplianceRoute] gst_invoices save error:', saveGstErr.message);
    }

    return res.status(200).json({
      success: true,
      results: {
        message: {
          ewayBillNo: finalEwbNo,
          ewayBillDate: finalEwbDate,
          validUpto: finalValidUpto,
          url: finalPdfUrl
        }
      },
      challanNumber: documentNumber,
      ewayBillNo: finalEwbNo,
      ewayBillDate: finalEwbDate,
      validUpto: finalValidUpto,
      url: finalPdfUrl,
      pdfUrl: finalPdfUrl,
      vehicleNumber: cleanVehicle,
      distance: transDistance,
      status: 'EWB Active'
    });

  } catch (error) {
    console.error('[ComplianceRoute] generate-ewaybill Fatal Error:', error.message);
    return sendError(res, error.message || 'Failed to generate E-Way Bill', 500);
  }
});

// ────────────────────────────────────────────────────────────────────────────
// 4. GET /api/v1/compliance/ewaybills (and /ewaybill)
// ────────────────────────────────────────────────────────────────────────────
router.get(['/ewaybills', '/ewaybill'], requireBusinessAccount, async (req, res) => {
  try {
    const businessId = req.user?.business_id || req.business?.id || 1;
    const userId = req.user?.id || req.user?.userId || 1;

    const result = await db.query(`
      SELECT 
        id,
        eway_bill_no,
        carrier_name,
        vehicle_no,
        distance_km,
        from_place,
        to_place,
        status,
        pdf_url,
        created_at
      FROM eway_bills
      WHERE business_id = $1 OR user_id = $2
      ORDER BY created_at DESC, id DESC
    `, [businessId, userId]);

    const sanitizePdfUrl = (u) => {
      if (!u) return '';
      const trimmed = String(u).trim();
      return (trimmed.startsWith('http://') || trimmed.startsWith('https://')) ? trimmed : `https://${trimmed}`;
    };

    const formattedRows = (result.rows || []).map(row => {
      const safePdf = sanitizePdfUrl(row.pdf_url);
      const src = row.from_place || 'Dehradun';
      const dest = row.to_place || 'Noida';
      const dist = row.distance_km ? `${row.distance_km} Kms` : '40 Kms';

      return {
        ...row,
        id: row.id,
        eway_bill_no: row.eway_bill_no,
        ewayBillNo: row.eway_bill_no,
        eway_bill_number: row.eway_bill_no,
        carrier_name: row.carrier_name,
        carrierName: row.carrier_name,
        transporter_name: row.carrier_name,
        transport_company_name: row.carrier_name,
        vehicle_no: row.vehicle_no,
        vehicleNo: row.vehicle_no,
        vehicle_number: row.vehicle_no,
        distance_km: row.distance_km,
        distance: dist,
        transport_distance: Number(row.distance_km) || 40,
        from_place: src,
        to_place: dest,
        dispatch_location: src,
        source_place: src,
        delivery_location: dest,
        destination_place: dest,
        delivery_destination: dest,
        sourceDestination: `${src} → ${dest}`,
        status: row.status || 'GENERATED',
        pdf_url: safePdf,
        url: safePdf,
        print_url: safePdf,
        created_at: row.created_at
      };
    });

    return res.json({
      success: true,
      data: formattedRows,
      results: {
        message: formattedRows,
        ewayBills: formattedRows
      }
    });
  } catch (err) {
    console.error("Error fetching ewaybills:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// 5. GET /api/v1/compliance/invoices (and /einvoices)
// ────────────────────────────────────────────────────────────────────────────
router.get(['/invoices', '/einvoices', '/einvoice'], async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.userId || 1;

    let invRows = [];
    try {
      invRows = await db.prepare(`
        SELECT * FROM invoices 
        WHERE user_id = ? OR user_id = 1
        ORDER BY id DESC
      `).all(userId);
    } catch (e) {
      console.warn('[ComplianceRoute] invoices fetch warning:', e.message);
    }

    let gstRows = [];
    try {
      gstRows = await db.prepare(`
        SELECT * FROM gst_invoices 
        WHERE user_id = ? OR user_id = 1
        ORDER BY id DESC
      `).all(userId);
    } catch (e) {
      console.warn('[ComplianceRoute] gst_invoices fetch warning:', e.message);
    }

    const sanitizePdfUrl = (u) => {
      if (!u) return '';
      const trimmed = String(u).trim();
      return (trimmed.startsWith('http://') || trimmed.startsWith('https://')) ? trimmed : `https://${trimmed}`;
    };

    const recordsMap = new Map();
    for (const r of [...(invRows || []), ...(gstRows || [])]) {
      const invNum = r.invoice_number;
      if (!invNum) continue;
      if (!recordsMap.has(invNum)) {
        const taxable = parseFloat(r.taxable_amount || r.taxable_value || 0);
        const total = parseFloat(r.total_amount || r.amount || r.total_invoice || (taxable * 1.18));
        const safePdf = sanitizePdfUrl(r.pdf_url);
        recordsMap.set(invNum, {
          id: r.id,
          invoice_number: invNum,
          document_number: invNum,
          client_name: r.customer_name || r.client_name || 'Client',
          customer_name: r.customer_name || r.client_name || 'Client',
          customer_gstin: r.customer_gstin || r.client_gstin || '09AAAPG7885R002',
          invoice_type: r.invoice_type || 'B2B',
          place_of_supply: r.place_of_supply || '09-Uttar Pradesh',
          taxable_value: taxable,
          taxable_amount: taxable,
          gst_percentage: parseFloat(r.gst_percentage || 18),
          total_tax: parseFloat(r.total_tax || (taxable * 0.18)),
          amount: total,
          total_amount: total,
          total_invoice: total,
          irn: r.irn || r.irn_number || null,
          irn_number: r.irn || r.irn_number || null,
          ack_no: r.ack_no || r.AckNo || null,
          ack_date: r.ack_date || r.AckDt || null,
          signed_qr: r.signed_qr || r.SignedQRCode || null,
          SignedQRCode: r.signed_qr || r.SignedQRCode || null,
          pdf_url: safePdf,
          url: safePdf,
          qr_status: r.qr_status || (r.irn || r.irn_number ? 'Signed' : 'Unsigned'),
          status: r.status || 'GENERATED',
          created_at: r.created_at || new Date().toISOString()
        });
      }
    }

    const invoiceList = Array.from(recordsMap.values());
    invoiceList.sort((a, b) => (Number(b.id) || 0) - (Number(a.id) || 0));

    return res.status(200).json({
      success: true,
      data: invoiceList,
      results: {
        message: invoiceList,
        invoices: invoiceList
      }
    });
  } catch (error) {
    console.error('[ComplianceRoute] get invoices error:', error.message);
    return res.status(200).json({ success: true, data: [], results: { invoices: [] } });
  }
});

module.exports = router;
