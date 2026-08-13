/**
 * Centralized Backend Global Field Validator for CLIKS
 */

const validatePhone = (phone, isRequired = false) => {
    const clean = phone ? String(phone).trim() : '';
    if (!clean) {
        if (isRequired) return 'Phone number is required.';
        return null;
    }
    if (!/^\d+$/.test(clean) || clean.length !== 10) {
        return 'Phone number must contain exactly 10 digits.';
    }
    return null;
};

const validateEmail = (email, isRequired = false) => {
    const clean = email ? String(email).trim().toLowerCase() : '';
    if (!clean) {
        if (isRequired) return 'Email address is required.';
        return null;
    }
    const basicEmailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!basicEmailRegex.test(clean)) {
        return 'Please enter a valid email address.';
    }
    return null;
};

const validateGstin = (gstin, isRequired = false) => {
    const clean = gstin ? String(gstin).trim() : '';
    if (!clean) {
        if (isRequired) return 'GSTIN is required.';
        return null;
    }
    if (clean.length !== 15 || !/^[a-zA-Z0-9]{15}$/.test(clean)) {
        return 'GSTIN must contain exactly 15 alphanumeric characters.';
    }
    return null;
};

const validatePan = (pan, isRequired = false) => {
    const clean = pan ? String(pan).trim() : '';
    if (!clean) {
        if (isRequired) return 'PAN is required.';
        return null;
    }
    if (clean.length !== 10 || !/^[a-zA-Z0-9]{10}$/.test(clean)) {
        return 'PAN must contain exactly 10 alphanumeric characters.';
    }
    return null;
};

const validatePayload = (payload = {}, rules = {}) => {
    if (rules.phone) {
        const err = validatePhone(payload.phone || payload.phone_number || payload.contact_phone, rules.phone.required);
        if (err) return err;
    }
    if (rules.email) {
        const err = validateEmail(payload.email, rules.email.required);
        if (err) return err;
    }
    if (rules.gstin) {
        const err = validateGstin(payload.gstin || payload.gst_number || payload.supplier_gstin, rules.gstin.required);
        if (err) return err;
    }
    if (rules.pan) {
        const err = validatePan(payload.pan || payload.pan_number, rules.pan.required);
        if (err) return err;
    }
    return null;
};

module.exports = {
    validatePhone,
    validateEmail,
    validateGstin,
    validatePan,
    validatePayload
};
