/**
 * Centralized Backend Global Field Validator for CLIKS
 */

const validatePhone = (phone, isRequired = false) => {
    if (!phone || !String(phone).trim()) {
        if (isRequired) return 'Phone number is required';
        return null;
    }
    const clean = String(phone).trim();
    if (!/^\d+$/.test(clean)) {
        return 'Phone number must contain numbers only';
    }
    if (clean.length !== 10) {
        return 'Phone number must contain exactly 10 digits';
    }
    return null;
};

const validateEmail = (email, isRequired = false) => {
    if (!email || !String(email).trim()) {
        if (isRequired) return 'Email address is required';
        return null;
    }
    const clean = String(email).trim().toLowerCase();
    const basicEmailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!basicEmailRegex.test(clean)) {
        return 'Please enter a valid email address';
    }
    if (!clean.endsWith('@bnxmail.com')) {
        return 'Email address must end with @bnxmail.com';
    }
    return null;
};

const validateGstin = (gstin, isRequired = false) => {
    if (!gstin || !String(gstin).trim()) {
        if (isRequired) return 'GSTIN is required';
        return null;
    }
    const clean = String(gstin).trim();
    if (clean.length !== 15 || !/^[a-zA-Z0-9]{15}$/.test(clean)) {
        return 'GSTIN must contain exactly 15 alphanumeric characters';
    }
    return null;
};

const validatePan = (pan, isRequired = false) => {
    if (!pan || !String(pan).trim()) {
        if (isRequired) return 'PAN number is required';
        return null;
    }
    const clean = String(pan).trim();
    if (clean.length !== 10 || !/^[a-zA-Z0-9]{10}$/.test(clean)) {
        return 'PAN must contain exactly 10 alphanumeric characters';
    }
    return null;
};

const validatePayload = (payload = {}, rules = {}) => {
    const errors = [];

    if (rules.phone) {
        const err = validatePhone(payload.phone || payload.phone_number || payload.contact_phone, rules.phone.required);
        if (err) errors.push(err);
    }
    if (rules.email) {
        const err = validateEmail(payload.email, rules.email.required);
        if (err) errors.email = err;
        if (err) errors.push(err);
    }
    if (rules.gstin) {
        const err = validateGstin(payload.gstin || payload.gst_number || payload.supplier_gstin, rules.gstin.required);
        if (err) errors.push(err);
    }
    if (rules.pan) {
        const err = validatePan(payload.pan || payload.pan_number, rules.pan.required);
        if (err) errors.push(err);
    }

    return errors.length > 0 ? errors[0] : null;
};

module.exports = {
    validatePhone,
    validateEmail,
    validateGstin,
    validatePan,
    validatePayload
};
