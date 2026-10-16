const db = require('../db/connection');

/**
 * Resolves the active branch ID for a request:
 * 1. If the authenticated user is a Sub-ID assigned to a branch, they are STRICTLY
 *    locked to that branch. Query params or headers attempting to access another branch
 *    are ignored.
 * 2. If the user is the Business Owner / Admin, they can filter by branch using
 *    query parameter (?branch_id=...) or header (x-branch-id). If omitted or 'all',
 *    null is returned, signifying company-wide consolidated view.
 */
function getEffectiveBranchId(req) {
    if (!req || !req.user) return null;

    // Showroom Manager (Sub-ID): Strictly isolated to assigned branch
    if (req.user.is_sub_id && req.user.branch_id) {
        const id = parseInt(req.user.branch_id, 10);
        return isNaN(id) ? null : id;
    }

    // Owner branch selection
    const raw = req.query?.branch_id || req.headers?.['x-branch-id'] || req.headers?.['x-branch'];
    if (raw !== undefined && raw !== null && raw !== '' && raw !== 'all' && raw !== 'null' && raw !== 'undefined') {
        const parsed = parseInt(raw, 10);
        return isNaN(parsed) ? null : parsed;
    }

    return null;
}

/**
 * Fetch branch metadata for the effective branch
 */
async function getEffectiveBranch(req) {
    const branchId = getEffectiveBranchId(req);
    if (!branchId) return null;

    try {
        const branch = await db.prepare('SELECT id, name, code, city, address, phone, is_main_branch FROM branches WHERE id = ? AND user_id = ?').get(branchId, req.user.id);
        return branch || null;
    } catch (e) {
        return null;
    }
}

/**
 * Returns SQL clause and parameters for branch filtering:
 * - If no branch selected: returns empty clause (consolidated company-wide).
 * - If Main Showroom: includes matching branch_id AND unassigned legacy records (branch_id IS NULL OR branch_id = 0).
 * - If specific secondary showroom: strictly isolates to that branch_id.
 */
function getBranchSqlCondition(branchId, isMainBranch, columnPrefix = '') {
    if (!branchId) return { clause: '', params: [] };
    const col = columnPrefix ? `${columnPrefix}.branch_id` : 'branch_id';
    if (isMainBranch) {
        return { clause: ` AND (${col} = ? OR ${col} IS NULL OR ${col} = 0)`, params: [branchId] };
    }
    return { clause: ` AND ${col} = ?`, params: [branchId] };
}

module.exports = {
    getEffectiveBranchId,
    getEffectiveBranch,
    getBranchSqlCondition
};
