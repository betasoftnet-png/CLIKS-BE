const db = require('../db/connection');
const { sendSuccess, sendError } = require('../utils/response');
const { normalizeQuery, resolveSearchIntent } = require('../utils/hsnTaxonomy');

function formatResults(results) {
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
    return data;
}

const hsnController = {
    searchHSN: async (req, res) => {
        try {
            const rawInput = req.query.q || '';
            const normalized = normalizeQuery(rawInput);

            if (!normalized || normalized.length < 1) {
                return sendSuccess(res, [], 'Empty query');
            }

            const intent = resolveSearchIntent(rawInput);
            const { isNumeric, primaryPrefixes, mappedPrefixes, mappedKeywords, cleanTerms } = intent;

            const conditions = [];
            const params = [];

            // Case 1: Direct numeric code search (e.g. 8517, 851712, 8471, 1001)
            if (isNumeric) {
                conditions.push(`(hsn_code LIKE ? OR hsn_code = ?)`);
                params.push(`${normalized}%`, normalized);

                const sql = `
                    SELECT hsn_code AS hsnCode, description
                    FROM hsn_master
                    WHERE ${conditions.join(' OR ')}
                    ORDER BY 
                        CASE 
                            WHEN hsn_code = ? THEN 1
                            WHEN hsn_code LIKE ? THEN 2
                            ELSE 3 
                        END, 
                        hsn_code ASC
                    LIMIT 20
                `;
                const results = await db.prepare(sql).all(...params, normalized, `${normalized}%`);
                return sendSuccess(res, formatResults(results), 'HSN numeric search results retrieved');
            }

            // Case 2: Category domain intent matched (e.g. MacBook Pro 5, iPhone 15, Toyota Car, Basmati Rice)
            if (mappedPrefixes.length > 0) {
                // Strictly filter to mapped category HSN code prefixes and mapped keywords
                for (const pref of mappedPrefixes) {
                    conditions.push(`hsn_code LIKE ?`);
                    params.push(`${pref}%`);
                }
                for (const kw of mappedKeywords) {
                    conditions.push(`description LIKE ?`);
                    params.push(`%${kw}%`);
                }

                // Primary category prefixes get Priority 1
                const primaryCases = primaryPrefixes.map(p => `WHEN hsn_code LIKE '${p}%' THEN 1`).join(' ');
                const secondaryCases = mappedPrefixes.filter(p => !primaryPrefixes.includes(p)).map(p => `WHEN hsn_code LIKE '${p}%' THEN 2`).join(' ');

                const sql = `
                    SELECT hsn_code AS hsnCode, description
                    FROM hsn_master
                    WHERE ${conditions.join(' OR ')}
                    ORDER BY 
                        CASE 
                            ${primaryCases}
                            ${secondaryCases}
                            ELSE 3 
                        END, 
                        hsn_code ASC
                    LIMIT 20
                `;
                const results = await db.prepare(sql).all(...params);
                return sendSuccess(res, formatResults(results), 'HSN category search results retrieved');
            }

            // Case 3: Generic text search (no domain category matched)
            if (cleanTerms.length > 0) {
                for (const term of cleanTerms) {
                    if (term.length >= 3) {
                        conditions.push(`(hsn_code LIKE ? OR description LIKE ?)`);
                        params.push(`%${term}%`, `%${term}%`);
                    }
                }
            }

            if (conditions.length === 0) {
                return sendSuccess(res, [], 'No meaningful search terms');
            }

            const sql = `
                SELECT hsn_code AS hsnCode, description
                FROM hsn_master
                WHERE ${conditions.join(' OR ')}
                ORDER BY 
                    CASE 
                        WHEN description LIKE ? THEN 1
                        WHEN hsn_code LIKE ? THEN 2
                        ELSE 3 
                    END, 
                    hsn_code ASC
                LIMIT 20
            `;

            const results = await db.prepare(sql).all(...params, `%${normalized}%`, `%${normalized}%`);
            return sendSuccess(res, formatResults(results), 'HSN text search results retrieved');
        } catch (error) {
            console.error('[HSN Controller] Search error:', error);
            return sendError(res, 'Failed to search HSN codes', 500);
        }
    }
};

module.exports = hsnController;
