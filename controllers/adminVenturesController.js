const db = require('../db/connection');

/**
 * Admin Review Service Controller for SME Deal Marketplace / Capital Matrix
 */
exports.getAllPitches = async (req, res) => {
    try {
        const pitches = await db.prepare(`
            SELECT p.*, 
                   vp.company_name, vp.sector as vp_sector, vp.website, vp.location,
                   u.name as founder_name, COALESCE(p.founder_email, u.email) as founder_email, p.founder_phone
            FROM pitches p
            LEFT JOIN venture_profiles vp ON p.venture_id = vp.id
            LEFT JOIN users u ON p.user_id = u.id
            ORDER BY p.id DESC
        `).all();

        // Fallback check: if pitches table is empty, check legacy venture_pitches
        if (!pitches || pitches.length === 0) {
            const legacyPitches = await db.prepare(`
                SELECT vp.*, 
                       vp.id, vp.user_id,
                       vp.business_name as company_name, vp.industry as sector, vp.funding_target as goal_amount,
                       vp.headline as title, vp.use_of_funds as description,
                       COALESCE(vp.status, 'PENDING_REVIEW') as status, vp.admin_remarks,
                       u.name as founder_name, COALESCE(vp.founder_email, u.email) as founder_email, vp.founder_phone
                FROM venture_pitches vp
                LEFT JOIN users u ON vp.user_id = u.id
                ORDER BY vp.id DESC
            `).all();
            return res.json({ success: true, data: legacyPitches || [] });
        }

        res.json({ success: true, data: pitches });
    } catch (error) {
        console.error('Error fetching admin pitches:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch pitches for moderation' });
    }
};

exports.reviewPitch = async (req, res) => {
    const { id } = req.params;
    const { status, admin_remarks } = req.body;

    if (!['ACCEPTED', 'REJECTED', 'PENDING_REVIEW'].includes(status)) {
        return res.status(400).json({ success: false, message: 'Invalid status value. Must be ACCEPTED, REJECTED, or PENDING_REVIEW.' });
    }

    try {
        const now = new Date().toISOString();

        // Update in pitches table
        let pitch = await db.prepare('SELECT * FROM pitches WHERE id = ?').get(id);
        
        if (pitch) {
            await db.prepare(`
                UPDATE pitches 
                SET status = ?, admin_remarks = ?, updated_at = ?
                WHERE id = ?
            `).run(status, admin_remarks || '', now, id);
        } else {
            // Update in legacy venture_pitches table
            pitch = await db.prepare('SELECT * FROM venture_pitches WHERE id = ?').get(id);
            if (pitch) {
                const listingStatus = status === 'ACCEPTED' ? 'ACTIVE' : (status === 'REJECTED' ? 'REJECTED' : 'PENDING_REVIEW');
                await db.prepare(`
                    UPDATE venture_pitches 
                    SET status = ?, listing_status = ?, admin_remarks = ?
                    WHERE id = ?
                `).run(status, listingStatus, admin_remarks || '', id);
            } else {
                return res.status(404).json({ success: false, message: 'Pitch not found' });
            }
        }

        const userId = pitch.user_id || pitch.founder_id;
        const pitchTitle = pitch.title || pitch.headline || pitch.business_name || 'Venture Pitch';

        // Trigger notification to founder
        if (userId) {
            const notifTitle = `Pitch Status Update: ${status === 'ACCEPTED' ? 'Accepted & Published' : 'Needs Revision'}`;
            const notifMessage = status === 'ACCEPTED' 
                ? `Congratulations! Your venture pitch "${pitchTitle}" has been accepted and published to the marketplace.`
                : `Your venture pitch "${pitchTitle}" needs revision. Remarks: ${admin_remarks || 'Please review guidelines.'}`;

            await db.prepare(`
                INSERT INTO notifications (user_id, title, message, is_read, created_at)
                VALUES (?, ?, ?, 0, ?)
            `).run(userId, notifTitle, notifMessage, now);
        }

        res.json({
            success: true,
            message: `Pitch status successfully updated to ${status}.`,
            data: { id, status, admin_remarks }
        });
    } catch (error) {
        console.error('Error reviewing pitch:', error);
        res.status(500).json({ success: false, message: 'Failed to process admin pitch review' });
    }
};
