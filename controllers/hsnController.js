const db = require('../db/connection');
const { sendSuccess, sendError } = require('../utils/response');

const hsnController = {
    searchHSN: async (req, res) => {
        try {
            const rawQuery = (req.query.q || '').trim();
            if (!rawQuery || rawQuery.length < 1) {
                return sendSuccess(res, [], 'Empty query');
            }

            const searchQuery = `%${rawQuery}%`;
            const exactPrefixQuery = `${rawQuery}%`;

            const sql = `
                SELECT hsn_code AS hsnCode, description
                FROM hsn_master
                WHERE hsn_code LIKE ? OR description LIKE ?
                ORDER BY 
                    CASE 
                        WHEN hsn_code LIKE ? THEN 1 
                        WHEN description LIKE ? THEN 2 
                        ELSE 3 
                    END, 
                    hsn_code ASC
                LIMIT 20
            `;

            const results = await db.prepare(sql).all(searchQuery, searchQuery, exactPrefixQuery, searchQuery);
            
            // Transform results to ensure hsnCode and description keys are clean strings
            const data = (results || []).map(item => ({
                hsnCode: String(item.hsnCode || item.hsn_code || ''),
                description: String(item.description || '')
            }));

            return sendSuccess(res, data, 'HSN search results retrieved successfully');
        } catch (error) {
            console.error('[HSN Controller] Search error:', error);
            return sendError(res, 'Failed to search HSN codes', 500);
        }
    }
};

module.exports = hsnController;
