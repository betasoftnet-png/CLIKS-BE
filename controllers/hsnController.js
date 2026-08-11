const db = require('../db/connection');
const { sendSuccess, sendError } = require('../utils/response');
const { normalizeQuery, resolveSearchIntent } = require('../utils/hsnTaxonomy');

const hsnController = {
    searchHSN: async (req, res) => {
        try {
            const rawInput = req.query.q || '';
            const normalized = normalizeQuery(rawInput);

            if (!normalized || normalized.length < 1) {
                return sendSuccess(res, [], 'Empty query');
            }

            const intent = resolveSearchIntent(rawInput);
            const { isNumeric, mappedPrefixes, mappedKeywords } = intent;

            const conditions = [];
            const params = [];

            // 1. Direct LIKE search on hsn_code or description
            conditions.push(`(hsn_code LIKE ? OR description LIKE ?)`);
            params.push(`%${normalized}%`, `%${normalized}%`);

            // Search individual words if query is multi-word
            const words = normalized.split(' ').filter(w => w.length >= 2);
            for (const w of words) {
                conditions.push(`(hsn_code LIKE ? OR description LIKE ?)`);
                params.push(`%${w}%`, `%${w}%`);
            }

            // 2. Add category mapped HSN code prefixes
            if (mappedPrefixes.length > 0) {
                for (const pref of mappedPrefixes) {
                    conditions.push(`hsn_code LIKE ?`);
                    params.push(`${pref}%`);
                }
            }

            // 3. Add category mapped description keywords
            if (mappedKeywords.length > 0) {
                for (const kw of mappedKeywords) {
                    conditions.push(`description LIKE ?`);
                    params.push(`%${kw}%`);
                }
            }

            const whereClause = conditions.join(' OR ');

            // Multi-tier search ranking logic
            let orderByClause = '';
            const orderParams = [];

            if (isNumeric) {
                orderByClause = `
                    ORDER BY 
                        CASE 
                            WHEN hsn_code = ? THEN 1
                            WHEN hsn_code LIKE ? THEN 2
                            WHEN description LIKE ? THEN 3
                            ELSE 4 
                        END, 
                        hsn_code ASC
                `;
                orderParams.push(normalized, `${normalized}%`, `%${normalized}%`);
            } else if (mappedPrefixes.length > 0) {
                // Priority 1 for any mapped domain category HSN prefix
                const prefCases = mappedPrefixes.map(p => `WHEN hsn_code LIKE '${p}%' THEN 1`).join(' ');
                orderByClause = `
                    ORDER BY 
                        CASE 
                            ${prefCases}
                            WHEN description LIKE ? THEN 2
                            WHEN hsn_code LIKE ? THEN 3
                            ELSE 4 
                        END, 
                        hsn_code ASC
                `;
                orderParams.push(`%${normalized}%`, `%${normalized}%`);
            } else {
                orderByClause = `
                    ORDER BY 
                        CASE 
                            WHEN description LIKE ? THEN 1
                            WHEN hsn_code LIKE ? THEN 2
                            ELSE 3 
                        END, 
                        hsn_code ASC
                `;
                orderParams.push(`%${normalized}%`, `%${normalized}%`);
            }

            const sql = `
                SELECT hsn_code AS hsnCode, description
                FROM hsn_master
                WHERE ${whereClause}
                ${orderByClause}
                LIMIT 20
            `;

            const allParams = [...params, ...orderParams];
            const results = await db.prepare(sql).all(...allParams);

            // Deduplicate and format clean response
            const seen = new Set();
            const data = [];
            for (const item of (results || [])) {
                const code = String(item.hsnCode || item.hsn_code || '');
                const desc = String(item.description || '');
                const key = `${code}_${desc}`;
                if (!seen.has(key)) {
                    seen.add(key);
                    data.push({ hsnCode: code, description: desc });
                }
            }

            return sendSuccess(res, data, 'HSN search results retrieved successfully');
        } catch (error) {
            console.error('[HSN Controller] Search error:', error);
            return sendError(res, 'Failed to search HSN codes', 500);
        }
    }
};

module.exports = hsnController;
