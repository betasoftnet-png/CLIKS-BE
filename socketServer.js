const { Server } = require('socket.io');
const db = require('./db/connection');

let io = null;
const activeUserSockets = new Map(); // userId -> Set of socketIds

function initSocketServer(httpServer) {
    io = new Server(httpServer, {
        cors: {
            origin: '*',
            methods: ['GET', 'POST']
        }
    });

    io.on('connection', (socket) => {
        let currentUserId = null;

        // 1. Event: user-online
        socket.on('user-online', async (data) => {
            const userId = typeof data === 'object' ? data.userId : data;
            if (!userId) return;
            currentUserId = userId;
            const now = new Date().toISOString();

            if (!activeUserSockets.has(userId)) {
                activeUserSockets.set(userId, new Set());
            }
            activeUserSockets.get(userId).add(socket.id);

            // Update database user_presence & users tables
            try {
                const existing = await db.prepare("SELECT * FROM user_presence WHERE user_id = ?").get(userId);
                if (existing) {
                    await db.prepare("UPDATE user_presence SET status = 'Online', login_time = ?, last_activity = ?, socket_id = ? WHERE user_id = ?").run(now, now, socket.id, userId);
                } else {
                    await db.prepare("INSERT INTO user_presence (user_id, status, login_time, last_activity, socket_id) VALUES (?, 'Online', ?, ?, ?)").run(userId, now, now, socket.id);
                }
                await db.prepare("UPDATE users SET is_online = 1, login_at = ?, last_seen_at = ? WHERE id = ?").run(now, now, userId);
            } catch (e) {
                console.error('[Socket user-online error]', e.message);
            }

            // Broadcast user-online event to all connected clients
            io.emit('user-online', { userId, status: 'Online', socketId: socket.id, lastSeen: now });
        });

        // 2. Event: join-conversation
        socket.on('join-conversation', ({ conversationId, partnerId, userId }) => {
            const roomName = conversationId || (partnerId && userId ? [String(userId), String(partnerId)].sort().join('_') : null);
            if (roomName) {
                socket.join(`room_${roomName}`);
            }
        });

        // 3. Event: leave-conversation
        socket.on('leave-conversation', ({ conversationId, partnerId, userId }) => {
            const roomName = conversationId || (partnerId && userId ? [String(userId), String(partnerId)].sort().join('_') : null);
            if (roomName) {
                socket.leave(`room_${roomName}`);
            }
        });

        // 4. Event: send-message
        socket.on('send-message', async (data) => {
            const { senderId, receiverId, message, conversationId } = data;
            if (!senderId || !receiverId || !message) return;

            const now = new Date().toISOString();
            let msgRecord = null;

            try {
                // Save to database
                const res = await db.prepare(`
                    INSERT INTO ca_messages (sender_id, receiver_id, message, is_read, created_at)
                    VALUES (?, ?, ?, 0, ?)
                `).run(senderId, receiverId, message.trim(), now);
                msgRecord = await db.prepare("SELECT m.*, u.username as sender_name FROM ca_messages m LEFT JOIN users u ON m.sender_id = u.id WHERE m.id = ?").get(res.lastInsertRowid);
            } catch (e) {
                console.error('[Socket send-message DB error]', e.message);
            }

            const payload = msgRecord || {
                id: Date.now(),
                sender_id: senderId,
                receiver_id: receiverId,
                message: message.trim(),
                is_read: 0,
                created_at: now
            };

            const roomName = conversationId || [String(senderId), String(receiverId)].sort().join('_');
            io.to(`room_${roomName}`).emit('receive-message', payload);

            // Send to receiver sockets if online
            const receiverSockets = activeUserSockets.get(receiverId);
            if (receiverSockets) {
                receiverSockets.forEach(sId => {
                    io.to(sId).emit('receive-message', payload);
                    io.to(sId).emit('new-unread-message', payload);
                });
            }
        });

        // 5. Event: typing
        socket.on('typing', ({ senderId, receiverId, conversationId }) => {
            const roomName = conversationId || [String(senderId), String(receiverId)].sort().join('_');
            socket.to(`room_${roomName}`).emit('typing', { senderId, receiverId, isTyping: true });
            const receiverSockets = activeUserSockets.get(receiverId);
            if (receiverSockets) {
                receiverSockets.forEach(sId => io.to(sId).emit('typing', { senderId, receiverId, isTyping: true }));
            }
        });

        // 6. Event: stop-typing
        socket.on('stop-typing', ({ senderId, receiverId, conversationId }) => {
            const roomName = conversationId || [String(senderId), String(receiverId)].sort().join('_');
            socket.to(`room_${roomName}`).emit('stop-typing', { senderId, receiverId, isTyping: false });
            const receiverSockets = activeUserSockets.get(receiverId);
            if (receiverSockets) {
                receiverSockets.forEach(sId => io.to(sId).emit('stop-typing', { senderId, receiverId, isTyping: false }));
            }
        });

        // 7. Event: mark-read
        socket.on('mark-read', async ({ userId, partnerId }) => {
            if (!userId || !partnerId) return;
            try {
                await db.prepare("UPDATE ca_messages SET is_read = 1 WHERE receiver_id = ? AND sender_id = ?").run(userId, partnerId);
            } catch (e) {
                console.error('[Socket mark-read error]', e.message);
            }
            const partnerSockets = activeUserSockets.get(partnerId);
            if (partnerSockets) {
                partnerSockets.forEach(sId => io.to(sId).emit('messages-read', { readBy: userId, partnerId }));
            }
        });

        // 8. Event: user-offline / disconnect
        const handleDisconnect = async () => {
            if (!currentUserId) return;
            const userSockets = activeUserSockets.get(currentUserId);
            if (userSockets) {
                userSockets.delete(socket.id);
                if (userSockets.size === 0) {
                    activeUserSockets.delete(currentUserId);
                    const now = new Date().toISOString();
                    try {
                        await db.prepare("UPDATE user_presence SET status = 'Offline', logout_time = ?, last_activity = ? WHERE user_id = ?").run(now, now, currentUserId);
                        await db.prepare("UPDATE users SET is_online = 0, last_seen_at = ? WHERE id = ?").run(now, currentUserId);
                    } catch (e) {}
                    io.emit('user-offline', { userId: currentUserId, status: 'Offline', lastSeen: now });
                }
            }
        };

        socket.on('user-offline', handleDisconnect);
        socket.on('disconnect', handleDisconnect);
    });

    return io;
}

function getIO() {
    return io;
}

module.exports = { initSocketServer, getIO };
