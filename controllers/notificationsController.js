const db = require('../db/connection');

exports.getNotifications = async (req, res) => {
    try {
        const userId = req.user?.id || 1;
        const notifications = await db.prepare(
            'SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 50'
        ).all(userId);
        res.json({ success: true, data: notifications || [] });
    } catch (error) {
        console.error('Error fetching notifications:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch notifications' });
    }
};

exports.markAsRead = async (req, res) => {
    try {
        const userId = req.user?.id || 1;
        const { id } = req.params;
        await db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?').run(id, userId);
        res.json({ success: true, message: 'Notification marked as read' });
    } catch (error) {
        console.error('Error marking notification read:', error);
        res.status(500).json({ success: false, message: 'Failed to update notification' });
    }
};

exports.markAllAsRead = async (req, res) => {
    try {
        const userId = req.user?.id || 1;
        await db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(userId);
        res.json({ success: true, message: 'All notifications marked as read' });
    } catch (error) {
        console.error('Error marking all notifications read:', error);
        res.status(500).json({ success: false, message: 'Failed to update notifications' });
    }
};
