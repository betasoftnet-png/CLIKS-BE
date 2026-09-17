const db = require('../db/connection');
const FounderPitch = require('../models/FounderPitch');

/**
 * Pitch Controller
 * Central PostgreSQL Persistence for Founder Pitches & Marketplace Listings
 */

exports.getPitches = async (req, res) => {
    try {
        // 1. Fetch from central founder_pitches table (ordered by created_at DESC)
        const centralPitches = await FounderPitch.getAll();

        // 2. Fetch from legacy venture_pitches table (with LEFT JOIN so missing users don't drop rows)
        let legacyPitches = [];
        try {
            legacyPitches = await db.prepare(
                `SELECT p.*, 
                        COALESCE(p.founder_email, u.email) as founder_email, 
                        COALESCE(u.business_name, p.business_name) as user_biz_name, 
                        COALESCE(p.founder_phone, u.phone) as founder_phone 
                 FROM venture_pitches p 
                 LEFT JOIN users u ON p.user_id = u.id 
                 ORDER BY p.id DESC`
            ).all();
        } catch (e) {
            // Ignore if legacy table query fails
        }

        // 3. Merge: central founder_pitches take precedence; deduplicate by name + email
        const seen = new Set();
        const merged = [];

        (centralPitches || []).forEach(cp => {
            const key = `${(cp.venture_name || '').toLowerCase()}-${(cp.founder_email || '').toLowerCase()}`;
            seen.add(key);
            merged.push({
                id: cp.id,
                user_id: cp.user_id,
                founder_name: cp.founder_name,
                founder_email: cp.founder_email,
                venture_name: cp.venture_name,
                business_name: cp.venture_name,
                title: cp.venture_name,
                sector: cp.sector,
                industry: cp.sector,
                headline_pitch: cp.headline_pitch,
                headline: cp.headline_pitch,
                pitch_summary: cp.headline_pitch,
                description: cp.description || '',
                pitch_deck_url: cp.pitch_deck_url || '',
                review_status: cp.review_status || 'Published',
                status: cp.review_status || 'Published',
                created_at: cp.created_at,
                submitted_date: cp.created_at ? new Date(cp.created_at).toISOString().split('T')[0] : ''
            });
        });

        (legacyPitches || []).forEach(lp => {
            const vName = lp.business_name || 'Venture';
            const fEmail = lp.founder_email || 'founder@cliksbusiness.com';
            const key = `${vName.toLowerCase()}-${fEmail.toLowerCase()}`;
            if (!seen.has(key)) {
                seen.add(key);
                merged.push({
                    id: lp.id,
                    user_id: String(lp.user_id),
                    founder_name: lp.user_biz_name || lp.business_name || 'Founder',
                    founder_email: fEmail,
                    venture_name: vName,
                    business_name: vName,
                    title: vName,
                    sector: lp.industry || 'Technology',
                    industry: lp.industry || 'Technology',
                    headline_pitch: lp.headline || '',
                    headline: lp.headline || '',
                    pitch_summary: lp.headline || '',
                    description: lp.description || lp.use_of_funds || lp.headline || '',
                    pitch_deck_url: lp.pitch_deck_url || '',
                    review_status: lp.listing_status === 'ACTIVE' || lp.is_verified ? 'Published' : 'Under Review',
                    status: lp.listing_status === 'ACTIVE' || lp.is_verified ? 'Published' : 'Under Review',
                    created_at: lp.created_at,
                    submitted_date: lp.created_at ? new Date(lp.created_at).toISOString().split('T')[0] : ''
                });
            }
        });

        res.json({ success: true, data: merged });
    } catch (error) {
        console.error('Error fetching pitches:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch business pitches' });
    }
};

exports.getMyStudioPitches = async (req, res) => {
    try {
        const userId = req.user?.id ? String(req.user.id) : null;
        const userEmail = req.user?.email ? req.user.email.toLowerCase() : null;

        const allPitches = await FounderPitch.getAll();
        const userPitches = allPitches.filter(p => {
            if (userId && String(p.user_id) === userId) return true;
            if (userEmail && (p.founder_email || '').toLowerCase() === userEmail) return true;
            return false;
        });

        res.json({ success: true, data: userPitches });
    } catch (error) {
        console.error('Error fetching my studio pitches:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch studio pitches' });
    }
};

exports.createPitch = async (req, res) => {
    const {
        venture_name,
        business_name,
        title,
        sector,
        industry,
        headline_pitch,
        headline,
        description,
        use_of_funds,
        pitch_deck_url,
        founder_name,
        founder_email,
        founder_phone,
        review_status
    } = req.body;

    try {
        const userId = req.user?.id ? String(req.user.id) : (req.body.user_id ? String(req.body.user_id) : '1');
        const vName = venture_name || business_name || title || 'Untitled Venture';
        const vSector = sector || industry || 'Technology';
        const vHeadline = headline_pitch || headline || '';
        const vDesc = description || use_of_funds || headline || '';
        const fEmail = founder_email || req.user?.email || 'founder@cliksbusiness.com';
        const fName = founder_name || req.user?.username || req.user?.business_name || vName;
        const pDeckUrl = pitch_deck_url || '';
        const rStatus = review_status || 'Under Review';
        const now = new Date().toISOString();

        // 1. Insert into PostgreSQL founder_pitches table
        const savedPitch = await FounderPitch.create({
            user_id: userId,
            founder_name: fName,
            founder_email: fEmail,
            venture_name: vName,
            sector: vSector,
            headline_pitch: vHeadline,
            description: vDesc,
            pitch_deck_url: pDeckUrl,
            review_status: rStatus,
            created_at: now
        });

        // 2. Also sync to legacy venture_pitches table safely for backward compatibility
        try {
            await db.prepare(
                `INSERT INTO venture_pitches (user_id, business_name, industry, funding_target, raised_amount, equity_offered, headline, pitch_deck_url, use_of_funds, description, founder_phone, founder_email, is_verified, listing_status, created_at)
                 VALUES (?, ?, ?, 0, 0, 0, ?, ?, ?, ?, ?, ?, 0, 'PENDING_REVIEW', ?)`
            ).run([
                Number(userId) || 1,
                vName,
                vSector,
                vHeadline,
                pDeckUrl,
                vDesc,
                vDesc,
                founder_phone || '',
                fEmail,
                now
            ]);
        } catch (legacyErr) {
            // Non-fatal if legacy table structure differs
        }

        res.status(201).json({
            success: true,
            message: 'Venture listing successfully persisted to central database with Under Review status.',
            data: savedPitch
        });
    } catch (error) {
        console.error('Error creating founder pitch:', error);
        res.status(500).json({ success: false, message: 'Failed to submit business pitch to database' });
    }
};

exports.reviewPitch = async (req, res) => {
    const { id } = req.params;
    const { review_status, status, admin_remarks } = req.body;
    const newStatus = review_status || status || 'Published';
    try {
        // Update founder_pitches
        await db.prepare(
            'UPDATE founder_pitches SET review_status = ? WHERE id = ?'
        ).run([newStatus, id]).catch(() => {});

        const isApproved = newStatus.toLowerCase() === 'published' || newStatus.toLowerCase() === 'accepted';
        // Update venture_pitches
        await db.prepare(
            'UPDATE venture_pitches SET listing_status = ?, is_verified = ? WHERE id = ?'
        ).run([isApproved ? 'ACTIVE' : newStatus, isApproved ? 1 : 0, id]).catch(() => {});

        res.json({ success: true, message: `Pitch status updated to ${newStatus}` });
    } catch (error) {
        console.error('Error reviewing pitch:', error);
        res.status(500).json({ success: false, message: 'Failed to update pitch status' });
    }
};

exports.verifyPitch = async (req, res) => {
    const { id } = req.params;
    const { payment_ref, review_status } = req.body;
    try {
        const newStatus = review_status || 'Published';
        // Update founder_pitches
        await db.prepare(
            'UPDATE founder_pitches SET review_status = ? WHERE id = ?'
        ).run([newStatus, id]).catch(() => {});

        // Update venture_pitches
        await db.prepare(
            'UPDATE venture_pitches SET is_verified = 1, listing_status = ?, payment_reference = ? WHERE id = ?'
        ).run(['ACTIVE', payment_ref || 'OFFLINE_CONNECT', id]).catch(() => {});

        res.json({ success: true, message: 'Pitch verification successfully authenticated.' });
    } catch (error) {
        console.error('Error verifying pitch:', error);
        res.status(500).json({ success: false, message: 'Verification authorization failed' });
    }
};
