const axios = require('axios');

/**
 * Masters India GST Compliance Service
 * 
 * Manages authentication, token caching, and proxy endpoints for:
 * 1. Sandbox E-Invoice & E-Way Bill Engine
 * 2. Common OAuth GSTIN Verification Engine
 */

class MastersIndiaService {
  constructor() {
    // ── Engine A: Sandbox E-Invoice & E-Way Bill ──────────────────────────
    this.sandboxConfig = {
      authUrl: 'https://sandb-api.mastersindia.co/api/v1/token-auth/',
      einvoiceUrl: 'https://sandb-api.mastersindia.co/api/v1/einvoice/',
      ewayBillUrl: 'https://sandb-api.mastersindia.co/api/v1/ewayBillsGenerate/',
      credentials: {
        username: process.env.MASTERS_INDIA_SANDBOX_USER || 'betasoftnet2025@gmail.com',
        password: process.env.MASTERS_INDIA_SANDBOX_PASSWORD || 'Masters@1234'
      }
    };
    this.sandboxToken = null;
    this.sandboxTokenExpiry = 0; // 5 hours cache

    // ── Engine B: Common OAuth GSTIN Verification ────────────────────────
    this.commonOAuthConfig = {
      authUrl: 'https://commonapi.mastersindia.co/oauth/access_token',
      searchGstinUrl: 'https://commonapi.mastersindia.co/commonapis/searchgstin',
      credentials: {
        username: process.env.MASTERS_INDIA_COMMON_USER || 'betasoftnet2025@gmail.com',
        password: process.env.MASTERS_INDIA_COMMON_PASSWORD || 'Masters@1234',
        client_id: process.env.MASTERS_INDIA_CLIENT_ID || 'aUYyZuuZoWRcOJMbpg',
        client_secret: process.env.MASTERS_INDIA_CLIENT_SECRET || '7ogcJCDMDtI6DZZhsJKMiI90',
        grant_type: 'password'
      }
    };
    this.commonAccessToken = null;
    this.commonTokenExpiry = 0; // expires_in - 5 minutes
  }

  // ──────────────────────────────────────────────────────────────────────────
  // ENGINE A: SANDBOX E-INVOICE & E-WAY BILL ENGINE
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Fetch or return cached JWT token for Sandbox E-Invoice / E-Way Bill.
   * Token cached for 5 hours.
   */
  async getSandboxToken() {
    const now = Date.now();
    if (this.sandboxToken && now < this.sandboxTokenExpiry) {
      return this.sandboxToken;
    }

    try {
      const response = await axios.post(
        this.sandboxConfig.authUrl,
        this.sandboxConfig.credentials,
        {
          headers: { 'Content-Type': 'application/json' },
          timeout: 15000
        }
      );

      const token = response.data?.token;
      if (!token) {
        throw new Error('No token returned in Sandbox authentication response');
      }

      this.sandboxToken = token;
      // Cache for 5 hours (5 * 60 * 60 * 1000 ms)
      this.sandboxTokenExpiry = now + 5 * 60 * 60 * 1000;
      return this.sandboxToken;
    } catch (error) {
      console.error('[MastersIndia] Sandbox Token Auth Failed:', error.response?.data || error.message);
      throw new Error(
        error.response?.data?.error ||
        error.response?.data?.message ||
        'Failed to authenticate with Masters India Sandbox API'
      );
    }
  }

  /**
   * Generate IRN (e-Invoice)
   * POST https://sandb-api.mastersindia.co/api/v1/einvoice/
   * Header: Authorization: JWT <token>
   */
  async generateIRN(payload) {
    const token = await this.getSandboxToken();
    try {
      const response = await axios.post(
        this.sandboxConfig.einvoiceUrl,
        payload,
        {
          headers: {
            'Authorization': `JWT ${token}`,
            'Content-Type': 'application/json'
          },
          timeout: 30000
        }
      );

      return response.data;
    } catch (error) {
      console.error('[MastersIndia] generateIRN Error:', error.response?.data || error.message);
      const errDetails = error.response?.data?.error || error.response?.data?.message || error.response?.data?.results?.ErrorMessage || error.message;
      throw new Error(typeof errDetails === 'string' ? errDetails : JSON.stringify(errDetails));
    }
  }

  /**
   * Generate E-Way Bill
   * POST https://sandb-api.mastersindia.co/api/v1/ewayBillsGenerate/
   * Header: Authorization: JWT <token>
   */
  async generateEWayBill(payload) {
    const token = await this.getSandboxToken();
    try {
      const response = await axios.post(
        this.sandboxConfig.ewayBillUrl,
        payload,
        {
          headers: {
            'Authorization': `JWT ${token}`,
            'Content-Type': 'application/json'
          },
          timeout: 30000
        }
      );

      return response.data;
    } catch (error) {
      console.error('[MastersIndia] generateEWayBill Error:', error.response?.data || error.message);
      const errDetails = error.response?.data?.error || error.response?.data?.message || error.response?.data?.results?.ErrorMessage || error.message;
      throw new Error(typeof errDetails === 'string' ? errDetails : JSON.stringify(errDetails));
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // ENGINE B: COMMON OAUTH GSTIN VERIFICATION ENGINE
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Fetch or return cached OAuth access_token for Common GSTIN Verification.
   * Token cached until 5 minutes before expiry.
   */
  async getCommonAccessToken() {
    const now = Date.now();
    if (this.commonAccessToken && now < this.commonTokenExpiry) {
      return this.commonAccessToken;
    }

    try {
      const response = await axios.post(
        this.commonOAuthConfig.authUrl,
        this.commonOAuthConfig.credentials,
        {
          headers: { 'Content-Type': 'application/json' },
          timeout: 15000
        }
      );

      const { access_token, expires_in } = response.data || {};
      if (!access_token) {
        console.error('[MastersIndia] Common OAuth returned unexpected body:', response.data);
        throw new Error('No access_token returned in Masters India Common OAuth response');
      }

      this.commonAccessToken = access_token;
      // expires_in in seconds (default 14400 or 21600). Cache until 5 minutes (300s) before expiry
      const ttlSeconds = Math.max(300, (expires_in || 14400) - 300);
      this.commonTokenExpiry = now + ttlSeconds * 1000;

      return this.commonAccessToken;
    } catch (error) {
      console.error('[MastersIndia] Common OAuth Auth Failed:', error.response?.data || error.message);
      throw new Error(
        error.response?.data?.error_description ||
        error.response?.data?.message ||
        'Failed to authenticate with Masters India Common OAuth API'
      );
    }
  }

  /**
   * Search and verify GSTIN
   * GET https://commonapi.mastersindia.co/commonapis/searchgstin?gstin=${gstin}
   * Headers:
   *   Authorization: Bearer <access_token>
   *   client_id: aUYyZuuZoWRcOJMbpg
   *   Content-Type: application/json
   */
  async searchGstin(gstin) {
    if (!gstin || typeof gstin !== 'string' || gstin.trim().length !== 15) {
      throw new Error('A valid 15-character GSTIN is required.');
    }

    const cleanGstin = gstin.trim().toUpperCase();
    const token = await this.getCommonAccessToken();

    try {
      const response = await axios.get(
        `${this.commonOAuthConfig.searchGstinUrl}?gstin=${encodeURIComponent(cleanGstin)}`,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'client_id': this.commonOAuthConfig.credentials.client_id,
            'Content-Type': 'application/json'
          },
          timeout: 20000
        }
      );

      return response.data;
    } catch (error) {
      console.error(`[MastersIndia] searchGstin(${cleanGstin}) Error:`, error.response?.data || error.message);
      const errMessage = error.response?.data?.message || error.response?.data?.error || error.message;
      throw new Error(errMessage);
    }
  }
}

// Export singleton instance
module.exports = new MastersIndiaService();
