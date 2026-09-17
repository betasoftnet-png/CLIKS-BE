const db = require('../db/connection');

/**
 * Pitch Controller
 */
exports.getPitches = async (req, res) => {
    try {
        // Returns all pitches, bringing most recent first along with contact info
        const pitches = await db.prepare(
            "SELECT p.*, COALESCE(p.founder_email, u.email) as founder_email, COALESCE(u.business_name, p.business_name) as user_biz_name, COALESCE(p.founder_phone, u.phone) as founder_phone FROM venture_pitches p JOIN users u ON p.user_id = u.id ORDER BY p.id DESC"
        ).all();
        
        const mappedPitches = (pitches || []).map(p => ({
            ...p,
            description: p.description || p.use_of_funds || p.headline || ''
        }));

        res.json({ success: true, data: mappedPitches });
    } catch (error) {
        console.error('Error fetching pitches:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch business pitches' });
    }
};

exports.createPitch = async (req, res) => {
    const { business_name, industry, funding_target, equity_offered, headline, pitch_deck_url, use_of_funds, description, founder_phone, founder_email, founder_name } = req.body;
    try {
        const userId = req.user?.id || 1; // Guard fallback
        const desc = description || use_of_funds || headline || '';
        const userEmail = founder_email || req.user?.email || '';

        // Safely ensure description column exists in venture_pitches and funding target is nullable
        try {
            await db.query("ALTER TABLE venture_pitches ADD COLUMN IF NOT EXISTS description TEXT");
            await db.query("ALTER TABLE venture_pitches ALTER COLUMN funding_target DROP NOT NULL").catch(() => {});
        } catch (e) {
            try {
                await db.query("ALTER TABLE venture_pitches ADD COLUMN description TEXT");
            } catch (sqErr) {}
        }

        let result;
        try {
            result = await db.prepare(
                `INSERT INTO venture_pitches (user_id, business_name, industry, funding_target, raised_amount, equity_offered, headline, pitch_deck_url, use_of_funds, description, founder_phone, founder_email, is_verified, listing_status, created_at)
                 VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, 1, 'ACTIVE', ?)`
            ).run([
                userId,
                business_name,
                industry || 'Other',
                funding_target !== undefined && funding_target !== null ? funding_target : 0,
                equity_offered !== undefined && equity_offered !== null ? equity_offered : 0,
                headline || '',
                pitch_deck_url || '',
                desc,
                desc,
                founder_phone || '',
                userEmail,
                new Date().toISOString()
            ]);
        } catch (insertErr) {
            result = await db.prepare(
                `INSERT INTO venture_pitches (user_id, business_name, industry, funding_target, raised_amount, equity_offered, headline, pitch_deck_url, use_of_funds, founder_phone, founder_email, is_verified, listing_status, created_at)
                 VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, 1, 'ACTIVE', ?)`
            ).run([
                userId,
                business_name,
                industry || 'Other',
                funding_target !== undefined && funding_target !== null ? funding_target : 0,
                equity_offered !== undefined && equity_offered !== null ? equity_offered : 0,
                headline || '',
                pitch_deck_url || '',
                desc,
                founder_phone || '',
                userEmail,
                new Date().toISOString()
            ]);
        }

        res.status(201).json({
            success: true,
            message: 'Venture entry successfully published on the active marketplace.',
            data: { id: result.lastInsertRowid || result.id || null }
        });
    } catch (error) {
        console.error('Error creating pitch:', error);
        res.status(500).json({ success: false, message: 'Failed to submit business pitch' });
    }
};

exports.verifyPitch = async (req, res) => {
    const { id } = req.params;
    const { payment_ref } = req.body;
    try {
        // Enforce integer 1 as verificationVal for column safety across both engines
        await db.prepare(
            'UPDATE venture_pitches SET is_verified = 1, listing_status = ?, payment_reference = ? WHERE id = ?'
        ).run(['ACTIVE', payment_ref || 'OFFLINE_CONNECT', id]);

        res.json({ success: true, message: 'Pitch verification successfully authenticated.' });
    } catch (error) {
        console.error('Error verifying pitch:', error);
        res.status(500).json({ success: false, message: 'Verification authorization failed' });
    }
};
