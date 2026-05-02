const db = require('../db/connection');

exports.getMeetups = async (req, res) => {
    try {
        const meetups = await db.prepare('SELECT * FROM meetups ORDER BY date ASC').all();
        res.json({ success: true, data: meetups });
    } catch (error) {
        console.error('Error fetching meetups:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch meetups' });
    }
};

exports.createMeetup = async (req, res) => {
    const { title, type, date, time, location, price, description, category, image_url, icon, gradient } = req.body;
    try {
        const userId = req.user?.id || 1; // Fallback to 1 if not authenticated for simplicity in this task
        const result = await db.prepare(
            `INSERT INTO meetups (user_id, title, type, date, time, location, price, description, category, image_url, icon, gradient, attendees, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run([
                userId,
                title,
                type || 'Offline',
                date || new Date().toISOString(),
                time || '00:00',
                location || 'TBA',
                price || 'Free',
                description || '',
                category || 'General',
                image_url || '',
                icon || 'Users',
                gradient || 'linear-gradient(135deg, #1B6B3A 0%, #22C55E 100%)',
                1,
                new Date().toISOString()
            ]);
        res.status(201).json({
            success: true,
            data: { id: result.lastID || result.id || result[0]?.id || null, title, type, date, time, location, price, description, category, image_url, icon, gradient, attendees: 1 }
        });
    } catch (error) {
        console.error('Error creating meetup:', error);
        res.status(500).json({ success: false, message: 'Failed to create meetup' });
    }
};
exports.joinMeetup = async (req, res) => {
    const { id } = req.params;
    try {
        await db.prepare('UPDATE meetups SET attendees = attendees + 1 WHERE id = ?').run([id]);
        res.json({ success: true, message: 'Joined meetup successfully' });
    } catch (error) {
        console.error('Error joining meetup:', error);
        res.status(500).json({ success: false, message: 'Failed to join meetup' });
    }
};
