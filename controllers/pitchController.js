const db = require('../db/connection');

/**
 * Pitch Management & Marketplace Controller
 */

// ── GET /api/v1/pitches/marketplace (Public / Investor Marketplace) ─────────
exports.getMarketplacePitches = async (req, res) => {
    try {
        const { search, sector } = req.query;
        let query = `
            SELECT p.id, p.venture_id, p.user_id, p.title, p.description, p.sector, p.problem, 
                   p.solution, p.business_model, p.traction, p.valuation, p.goal_amount, p.equity_offered,
                   p.status, p.created_at, p.updated_at,
                   vp.company_name, vp.location, u.name as founder_name
            FROM pitches p
            LEFT JOIN venture_profiles vp ON p.venture_id = vp.id
            LEFT JOIN users u ON p.user_id = u.id
            WHERE p.status = 'ACCEPTED'
        `;
        const params = [];

        if (sector && sector !== 'ALL') {
            query += ` AND (p.sector LIKE ? OR vp.sector LIKE ?)`;
            params.push(`%${sector}%`, `%${sector}%`);
        }

        if (search) {
            query += ` AND (p.title LIKE ? OR p.description LIKE ? OR p.problem LIKE ? OR p.solution LIKE ? OR vp.company_name LIKE ?)`;
            const term = `%${search}%`;
            params.push(term, term, term, term, term);
        }

        query += ` ORDER BY p.id DESC`;
        let pitches = await db.prepare(query).all(...params);

        // Fallback check: if no rows in pitches, fetch accepted/active rows from venture_pitches
        if (!pitches || pitches.length === 0) {
            let legacyQuery = `
                SELECT vp.id, vp.user_id, vp.headline as title, vp.use_of_funds as description,
                       vp.industry as sector, vp.funding_target as goal_amount, vp.raised_amount,
                       vp.equity_offered, vp.is_verified, COALESCE(vp.status, 'ACCEPTED') as status,
                       vp.business_name as company_name, u.name as founder_name, vp.created_at
                FROM venture_pitches vp
                LEFT JOIN users u ON vp.user_id = u.id
                WHERE (vp.listing_status = 'ACTIVE' OR vp.status = 'ACCEPTED' OR vp.is_verified = 1)
            `;
            const legacyParams = [];
            if (search) {
                legacyQuery += ` AND (vp.headline LIKE ? OR vp.business_name LIKE ? OR vp.industry LIKE ?)`;
                const term = `%${search}%`;
                legacyParams.push(term, term, term);
            }
            legacyQuery += ` ORDER BY vp.id DESC`;
            pitches = await db.prepare(legacyQuery).all(...legacyParams);
        }

        res.json({ success: true, data: pitches || [] });
    } catch (error) {
        console.error('Error fetching marketplace pitches:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch marketplace deals' });
    }
};

// ── GET /api/v1/pitches/my-studio (Founder Studio View) ─────────────────────
exports.getMyStudioPitches = async (req, res) => {
    try {
        const userId = req.user?.id || 1;
        
        let pitches = await db.prepare(`
            SELECT p.*, vp.company_name, vp.location
            FROM pitches p
            LEFT JOIN venture_profiles vp ON p.venture_id = vp.id
            WHERE p.user_id = ?
            ORDER BY p.id DESC
        `).all(userId);

        if (!pitches || pitches.length === 0) {
            pitches = await db.prepare(`
                SELECT vp.id, vp.user_id, vp.headline as title, vp.use_of_funds as description,
                       vp.industry as sector, vp.funding_target as goal_amount, vp.equity_offered,
                       vp.pitch_deck_url as deck_url, COALESCE(vp.status, 'PENDING_REVIEW') as status,
                       vp.admin_remarks, vp.business_name as company_name, vp.founder_phone, vp.founder_email,
                       vp.created_at
                FROM venture_pitches vp
                WHERE vp.user_id = ?
                ORDER BY vp.id DESC
            `).all(userId);
        }

        res.json({ success: true, data: pitches || [] });
    } catch (error) {
        console.error('Error fetching founder pitches:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch studio pitches' });
    }
};

// ── GET /api/v1/pitches (All / Default List) ────────────────────────────────
exports.getPitches = async (req, res) => {
    try {
        const pitches = await db.prepare(`
            SELECT p.*, vp.company_name, u.name as founder_name, COALESCE(p.founder_email, u.email) as founder_email, p.founder_phone
            FROM pitches p
            LEFT JOIN venture_profiles vp ON p.venture_id = vp.id
            LEFT JOIN users u ON p.user_id = u.id
            ORDER BY p.id DESC
        `).all();

        if (!pitches || pitches.length === 0) {
            const legacyPitches = await db.prepare(`
                SELECT p.*, u.business_name as user_biz_name, COALESCE(p.founder_email, u.email) as founder_email, p.founder_phone 
                FROM venture_pitches p 
                JOIN users u ON p.user_id = u.id 
                ORDER BY p.id DESC
            `).all();
            return res.json({ success: true, data: legacyPitches || [] });
        }

        res.json({ success: true, data: pitches });
    } catch (error) {
        console.error('Error fetching pitches:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch business pitches' });
    }
};

// ── POST /api/v1/pitches (Create / Submit Pitch) ────────────────────────────
exports.createPitch = async (req, res) => {
    const { 
        title, business_name, sector, industry, problem, solution, business_model, 
        traction, valuation, goal_amount, funding_target, equity_offered, headline, 
        pitch_deck_url, description, use_of_funds, founder_phone, founder_email 
    } = req.body;

    const pitchTitle = title || headline || business_name;
    const pitchSector = sector || industry || 'Technology';
    const goalVal = Number(goal_amount !== undefined ? goal_amount : funding_target);
    const equityVal = Number(equity_offered || 0);

    // Validation rules
    if (!pitchTitle || pitchTitle.trim() === '') {
        return res.status(400).json({ success: false, message: 'Venture title or business name is required.' });
    }
    if (isNaN(goalVal) || goalVal < 0) {
        return res.status(400).json({ success: false, message: 'Funding target goal amount must be a non-negative number.' });
    }
    if (isNaN(equityVal) || equityVal < 0 || equityVal > 100) {
        return res.status(400).json({ success: false, message: 'Equity offered must be between 0% and 100%.' });
    }

    try {
        const userId = req.user?.id || 1;
        const now = new Date().toISOString();

        // 1. Create or resolve venture profile
        let ventureProfile = await db.prepare('SELECT id FROM venture_profiles WHERE founder_id = ? ORDER BY id DESC').get(userId);
        let ventureId = ventureProfile ? ventureProfile.id : null;

        if (!ventureId) {
            const vpResult = await db.prepare(`
                INSERT INTO venture_profiles (founder_id, company_name, sector, short_description, created_at)
                VALUES (?, ?, ?, ?, ?)
            `).run(userId, pitchTitle, pitchSector, description || headline || '', now);
            ventureId = vpResult.lastInsertRowid || null;
        }

        // 2. Insert into pitches table with status 'PENDING_REVIEW'
        const pitchResult = await db.prepare(`
            INSERT INTO pitches (venture_id, user_id, title, description, sector, problem, solution, business_model, traction, valuation, goal_amount, equity_offered, deck_url, status, admin_remarks, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING_REVIEW', '', ?, ?)
        `).run(
            ventureId,
            userId,
            pitchTitle,
            description || headline || '',
            pitchSector,
            problem || '',
            solution || '',
            business_model || '',
            traction || '',
            valuation || 0,
            goalVal,
            equityVal,
            pitch_deck_url || '',
            now,
            now
        );

        // Also insert into venture_pitches table for backward compatibility
        await db.prepare(`
            INSERT INTO venture_pitches (user_id, business_name, industry, funding_target, raised_amount, equity_offered, headline, pitch_deck_url, use_of_funds, founder_phone, founder_email, is_verified, listing_status, status, created_at)
            VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, 0, 'PENDING_REVIEW', 'PENDING_REVIEW', ?)
        `).run(
            userId,
            pitchTitle,
            pitchSector,
            goalVal,
            equityVal,
            pitchTitle,
            pitch_deck_url || '',
            use_of_funds || description || '',
            founder_phone || '',
            founder_email || '',
            now
        ).catch(() => {});

        res.status(201).json({
            success: true,
            message: 'Pitch successfully submitted! It is now under Admin Review.',
            data: { id: pitchResult.lastInsertRowid || null, status: 'PENDING_REVIEW' }
        });
    } catch (error) {
        console.error('Error creating pitch:', error);
        res.status(500).json({ success: false, message: 'Failed to submit pitch' });
    }
};

// ── PUT /api/v1/pitches/:id/resubmit (Resubmit Rejected Pitch) ──────────────
exports.resubmitPitch = async (req, res) => {
    const { id } = req.params;
    const { title, description, goal_amount, equity_offered, deck_url, problem, solution } = req.body;
    const userId = req.user?.id || 1;

    try {
        const now = new Date().toISOString();
        await db.prepare(`
            UPDATE pitches
            SET title = COALESCE(?, title),
                description = COALESCE(?, description),
                goal_amount = COALESCE(?, goal_amount),
                equity_offered = COALESCE(?, equity_offered),
                deck_url = COALESCE(?, deck_url),
                problem = COALESCE(?, problem),
                solution = COALESCE(?, solution),
                status = 'PENDING_REVIEW',
                admin_remarks = '',
                updated_at = ?
            WHERE id = ? AND user_id = ?
        `).run(title, description, goal_amount, equity_offered, deck_url, problem, solution, now, id, userId);

        res.json({ success: true, message: 'Pitch updated and resubmitted for admin review.' });
    } catch (error) {
        console.error('Error resubmitting pitch:', error);
        res.status(500).json({ success: false, message: 'Failed to resubmit pitch' });
    }
};

// ── POST /api/v1/pitches/:id/unlock (Investor Quota Engine) ─────────────────
exports.unlockPitch = async (req, res) => {
    const { id } = req.params;
    const investorId = req.user?.id || 1;

    try {
        const now = new Date().toISOString();

        // 1. Check if pitch exists
        let pitch = await db.prepare(`
            SELECT p.*, u.name as founder_name, COALESCE(p.founder_email, u.email) as founder_email, p.founder_phone, vp.company_name
            FROM pitches p
            LEFT JOIN users u ON p.user_id = u.id
            LEFT JOIN venture_profiles vp ON p.venture_id = vp.id
            WHERE p.id = ?
        `).get(id);

        if (!pitch) {
            pitch = await db.prepare(`
                SELECT vp.*, vp.headline as title, u.name as founder_name, COALESCE(vp.founder_email, u.email) as founder_email, vp.founder_phone, vp.business_name as company_name, vp.pitch_deck_url as deck_url
                FROM venture_pitches vp
                LEFT JOIN users u ON vp.user_id = u.id
                WHERE vp.id = ?
            `).get(id);
        }

        if (!pitch) {
            return res.status(404).json({ success: false, message: 'Pitch not found' });
        }

        // 2. Check if already unlocked
        const existingUnlock = await db.prepare(
            'SELECT * FROM user_unlocked_pitches WHERE investor_id = ? AND pitch_id = ?'
        ).get(investorId, id);

        // 3. Determine Quota Limit based on subscription plan
        const subscription = await db.prepare(
            'SELECT plan_type FROM subscriptions WHERE user_id = ? AND is_active = 1'
        ).get(investorId);
        
        const userRow = await db.prepare('SELECT plan_type FROM users WHERE id = ?').get(investorId);

        const planType = subscription?.plan_type || userRow?.plan_type || 'BASIC_INVESTOR';
        const quotaLimit = (planType === 'PRO_INVESTOR' || planType === 'YEARLY_FOUNDER') ? 50 : 20;

        // 4. Count currently unlocked pitches
        const unlockCountRow = await db.prepare(
            'SELECT COUNT(*) as total FROM user_unlocked_pitches WHERE investor_id = ?'
        ).get(investorId);

        const unlockCount = unlockCountRow ? unlockCountRow.total : 0;

        // If not already unlocked and quota exceeded:
        if (!existingUnlock && unlockCount >= quotaLimit) {
            return res.status(403).json({
                success: false,
                status: 'QUOTA_EXCEEDED',
                code: 'UPGRADE_REQUIRED',
                message: `Quota limit reached (${unlockCount}/${quotaLimit}). Please upgrade your workspace tier to access more pitches.`,
                quota_used: unlockCount,
                quota_limit: quotaLimit
            });
        }

        // Record unlock if new
        if (!existingUnlock) {
            await db.prepare(`
                INSERT INTO user_unlocked_pitches (investor_id, pitch_id, unlocked_at)
                VALUES (?, ?, ?)
            `).run(investorId, id, now).catch(() => {});
        }

        const remainingQuota = quotaLimit - (existingUnlock ? unlockCount : unlockCount + 1);

        res.json({
            success: true,
            unlocked: true,
            quota_used: existingUnlock ? unlockCount : unlockCount + 1,
            quota_limit: quotaLimit,
            quota_remaining: Math.max(0, remainingQuota),
            data: {
                id: pitch.id,
                title: pitch.title,
                company_name: pitch.company_name || pitch.title,
                founder_name: pitch.founder_name,
                founder_email: pitch.founder_email || 'founder@venture.com',
                founder_phone: pitch.founder_phone || '+91 98765 43210',
                deck_url: pitch.deck_url || pitch.pitch_deck_url || '#'
            }
        });
    } catch (error) {
        console.error('Error unlocking pitch:', error);
        res.status(500).json({ success: false, message: 'Failed to process pitch unlock request' });
    }
};

// ── GET /api/v1/pitches/quota-status (Check Quota Status) ─────────────────
exports.getQuotaStatus = async (req, res) => {
    try {
        const investorId = req.user?.id || 1;

        const subscription = await db.prepare(
            'SELECT plan_type FROM subscriptions WHERE user_id = ? AND is_active = 1'
        ).get(investorId);
        
        const userRow = await db.prepare('SELECT plan_type FROM users WHERE id = ?').get(investorId);

        const planType = subscription?.plan_type || userRow?.plan_type || 'BASIC_INVESTOR';
        const quotaLimit = (planType === 'PRO_INVESTOR' || planType === 'YEARLY_FOUNDER') ? 50 : 20;

        const unlockCountRow = await db.prepare(
            'SELECT COUNT(*) as total FROM user_unlocked_pitches WHERE investor_id = ?'
        ).get(investorId);

        const unlockCount = unlockCountRow ? unlockCountRow.total : 0;
        const unlockedPitches = await db.prepare(
            'SELECT pitch_id FROM user_unlocked_pitches WHERE investor_id = ?'
        ).all(investorId);

        res.json({
            success: true,
            plan_type: planType,
            quota_used: unlockCount,
            quota_limit: quotaLimit,
            quota_remaining: Math.max(0, quotaLimit - unlockCount),
            unlocked_pitch_ids: unlockedPitches.map(u => u.pitch_id)
        });
    } catch (error) {
        console.error('Error fetching quota status:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch quota status' });
    }
};

// ── POST /api/v1/pitches/:id/verify (Verify/Activate Pitch) ────────────────
exports.verifyPitch = async (req, res) => {
    const { id } = req.params;
    const { payment_ref } = req.body;
    try {
        await db.prepare(
            "UPDATE pitches SET status = 'ACCEPTED', updated_at = ? WHERE id = ?"
        ).run(new Date().toISOString(), id);

        await db.prepare(
            "UPDATE venture_pitches SET is_verified = 1, listing_status = 'ACTIVE', status = 'ACCEPTED', payment_reference = ? WHERE id = ?"
        ).run(payment_ref || 'OFFLINE_CONNECT', id).catch(() => {});

        res.json({ success: true, message: 'Pitch verification & publication successfully authenticated.' });
    } catch (error) {
        console.error('Error verifying pitch:', error);
        res.status(500).json({ success: false, message: 'Verification authorization failed' });
    }
};
