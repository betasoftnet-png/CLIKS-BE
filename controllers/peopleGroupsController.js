const db = require('../db/connection');
const { sendSuccess, sendError } = require('../utils/response');

let schemaEnsured = false;
const isPostgres = (process.env.DB_TYPE || '').toLowerCase() === 'postgres';

const ensurePeopleGroupsSchema = async () => {
  if (schemaEnsured) return;
  try {
    if (isPostgres) {
      await db.query(`
        CREATE TABLE IF NOT EXISTS people_groups (
          id SERIAL PRIMARY KEY,
          created_by INTEGER NOT NULL,
          name VARCHAR(255) NOT NULL,
          description TEXT,
          group_type VARCHAR(50) DEFAULT 'syndicate',
          currency VARCHAR(10) DEFAULT 'INR',
          target_amount NUMERIC(15, 2) DEFAULT 0,
          status VARCHAR(50) DEFAULT 'active',
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS people_group_members (
          id SERIAL PRIMARY KEY,
          group_id INTEGER NOT NULL,
          user_id INTEGER,
          email VARCHAR(255) NOT NULL,
          name VARCHAR(255) NOT NULL,
          role VARCHAR(50) DEFAULT 'member',
          status VARCHAR(50) DEFAULT 'pending',
          invited_by INTEGER,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS people_group_transactions (
          id SERIAL PRIMARY KEY,
          group_id INTEGER NOT NULL,
          created_by INTEGER NOT NULL,
          paid_by_member_id INTEGER,
          type VARCHAR(50) NOT NULL,
          amount NUMERIC(15, 2) NOT NULL,
          title VARCHAR(255) NOT NULL,
          category VARCHAR(100) DEFAULT 'General',
          notes TEXT,
          date DATE,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS people_group_splits (
          id SERIAL PRIMARY KEY,
          transaction_id INTEGER NOT NULL,
          member_id INTEGER NOT NULL,
          owed_amount NUMERIC(15, 2) NOT NULL
        );

        CREATE TABLE IF NOT EXISTS people_group_private_notes (
          id SERIAL PRIMARY KEY,
          group_id INTEGER NOT NULL,
          user_id INTEGER NOT NULL,
          member_id INTEGER NOT NULL,
          amount NUMERIC(15, 2) DEFAULT 0,
          notes TEXT,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
      `);
    } else {
      if (db.raw && typeof db.raw.exec === 'function') {
        db.raw.exec(`
          CREATE TABLE IF NOT EXISTS people_groups (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            created_by INTEGER NOT NULL,
            name TEXT NOT NULL,
            description TEXT,
            group_type TEXT DEFAULT 'syndicate',
            currency TEXT DEFAULT 'INR',
            target_amount REAL DEFAULT 0,
            status TEXT DEFAULT 'active',
            created_at TEXT,
            updated_at TEXT
          );

          CREATE TABLE IF NOT EXISTS people_group_members (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            group_id INTEGER NOT NULL,
            user_id INTEGER,
            email TEXT NOT NULL,
            name TEXT NOT NULL,
            role TEXT DEFAULT 'member',
            status TEXT DEFAULT 'pending',
            invited_by INTEGER,
            created_at TEXT,
            updated_at TEXT
          );

          CREATE TABLE IF NOT EXISTS people_group_transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            group_id INTEGER NOT NULL,
            created_by INTEGER NOT NULL,
            paid_by_member_id INTEGER,
            type TEXT NOT NULL,
            amount REAL NOT NULL,
            title TEXT NOT NULL,
            category TEXT DEFAULT 'General',
            notes TEXT,
            date TEXT,
            created_at TEXT,
            updated_at TEXT
          );

          CREATE TABLE IF NOT EXISTS people_group_splits (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            transaction_id INTEGER NOT NULL,
            member_id INTEGER NOT NULL,
            owed_amount REAL NOT NULL
          );

          CREATE TABLE IF NOT EXISTS people_group_private_notes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            group_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            member_id INTEGER NOT NULL,
            amount REAL DEFAULT 0,
            notes TEXT,
            created_at TEXT,
            updated_at TEXT
          );
        `);
      } else {
        await db.prepare(`
          CREATE TABLE IF NOT EXISTS people_groups (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            created_by INTEGER NOT NULL,
            name TEXT NOT NULL,
            description TEXT,
            group_type TEXT DEFAULT 'syndicate',
            currency TEXT DEFAULT 'INR',
            target_amount REAL DEFAULT 0,
            status TEXT DEFAULT 'active',
            created_at TEXT,
            updated_at TEXT
          )
        `).run();
        await db.prepare(`
          CREATE TABLE IF NOT EXISTS people_group_members (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            group_id INTEGER NOT NULL,
            user_id INTEGER,
            email TEXT NOT NULL,
            name TEXT NOT NULL,
            role TEXT DEFAULT 'member',
            status TEXT DEFAULT 'pending',
            invited_by INTEGER,
            created_at TEXT,
            updated_at TEXT
          )
        `).run();
        await db.prepare(`
          CREATE TABLE IF NOT EXISTS people_group_transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            group_id INTEGER NOT NULL,
            created_by INTEGER NOT NULL,
            paid_by_member_id INTEGER,
            type TEXT NOT NULL,
            amount REAL NOT NULL,
            title TEXT NOT NULL,
            category TEXT DEFAULT 'General',
            notes TEXT,
            date TEXT,
            created_at TEXT,
            updated_at TEXT
          )
        `).run();
        await db.prepare(`
          CREATE TABLE IF NOT EXISTS people_group_splits (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            transaction_id INTEGER NOT NULL,
            member_id INTEGER NOT NULL,
            owed_amount REAL NOT NULL
          )
        `).run();
        await db.prepare(`
          CREATE TABLE IF NOT EXISTS people_group_private_notes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            group_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            member_id INTEGER NOT NULL,
            amount REAL DEFAULT 0,
            notes TEXT,
            created_at TEXT,
            updated_at TEXT
          )
        `).run();
      }
    }
    schemaEnsured = true;
  } catch (err) {
    console.error('Error ensuring people groups schema:', err);
  }
};

const BNXMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@bnxmail\.com$/i;

// ── GET /api/people/groups ───────────────────────────────────────────────────
const getGroups = async (req, res) => {
  await ensurePeopleGroupsSchema();
  const currentUser = await db.prepare('SELECT id, email FROM users WHERE id = ?').get(req.user.id);
  const userEmail = (currentUser?.email || req.user?.email || '').toLowerCase().trim();

  // Find all groups where user is creator or an active/pending member
  const groups = await db.prepare(`
    SELECT DISTINCT g.*,
      m.role as my_role,
      m.status as my_membership_status
    FROM people_groups g
    LEFT JOIN people_group_members m ON g.id = m.group_id AND (m.user_id = ? OR LOWER(m.email) = LOWER(?))
    WHERE g.created_by = ? OR (m.id IS NOT NULL AND m.status != 'rejected')
    ORDER BY g.updated_at DESC, g.id DESC
  `).all(req.user.id, userEmail, req.user.id);

  // Augment each group with summary statistics
  const enhancedGroups = await Promise.all(
    (groups || []).map(async (group) => {
      const members = await db.prepare(`
        SELECT id, name, email, role, status
        FROM people_group_members
        WHERE group_id = ?
      `).all(group.id);

      const activeMembers = members.filter(m => m.status === 'accepted');
      const pendingMembers = members.filter(m => m.status === 'pending');

      const txSummary = await db.prepare(`
        SELECT
          COALESCE(SUM(CASE WHEN type = 'contribution' THEN amount ELSE 0 END), 0) as total_contributed,
          COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) as total_expenses,
          COALESCE(SUM(CASE WHEN type = 'loan' THEN amount ELSE 0 END), 0) as total_loans
        FROM people_group_transactions
        WHERE group_id = ?
      `).get(group.id);

      return {
        ...group,
        member_count: activeMembers.length,
        pending_member_count: pendingMembers.length,
        total_members: members.length,
        total_contributed: Number(txSummary?.total_contributed || 0),
        total_expenses: Number(txSummary?.total_expenses || 0),
        total_loans: Number(txSummary?.total_loans || 0),
        target_amount: Number(group.target_amount || 0)
      };
    })
  );

  return sendSuccess(res, enhancedGroups, 'Financial groups fetched');
};

// ── POST /api/people/groups ──────────────────────────────────────────────────
const createGroup = async (req, res) => {
  await ensurePeopleGroupsSchema();
  const { name, description, group_type = 'syndicate', currency = 'INR', target_amount = 0, members = [] } = req.body;

  if (!name || !name.trim()) {
    return sendError(res, 'Group name is required.', 400, 'BAD_REQUEST');
  }

  const currentUser = await db.prepare('SELECT id, email, username, business_name FROM users WHERE id = ?').get(req.user.id);
  const creatorEmail = (currentUser?.email || req.user?.email || '').toLowerCase().trim();
  const creatorName = currentUser?.business_name || currentUser?.username || 'Group Creator';

  // Validate invited members
  const sanitizedInvites = [];
  const seenEmails = new Set();
  if (creatorEmail) seenEmails.add(creatorEmail);

  if (Array.isArray(members)) {
    for (const mem of members) {
      if (!mem.email) continue;
      const cleanEmail = mem.email.trim().toLowerCase();
      
      // Strict @bnxmail.com check
      if (!BNXMAIL_REGEX.test(cleanEmail)) {
        return sendError(res, `Invalid email "${mem.email}". Only official @bnxmail.com emails are accepted.`, 400, 'BAD_REQUEST');
      }

      // Check self-invite
      if (cleanEmail === creatorEmail) {
        return sendError(res, 'You cannot invite yourself as a separate member.', 400, 'BAD_REQUEST');
      }

      if (seenEmails.has(cleanEmail)) {
        return sendError(res, `Duplicate email "${cleanEmail}" in member list.`, 400, 'BAD_REQUEST');
      }
      seenEmails.add(cleanEmail);

      sanitizedInvites.push({
        name: (mem.name || cleanEmail.split('@')[0]).trim(),
        email: cleanEmail,
        role: ['admin', 'manager', 'member', 'auditor'].includes(mem.role) ? mem.role : 'member'
      });
    }
  }

  const now = new Date().toISOString();

  // Create Group
  const groupStmt = await db.prepare(`
    INSERT INTO people_groups (created_by, name, description, group_type, currency, target_amount, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)
  `).run(req.user.id, name.trim(), description ? description.trim() : null, group_type, currency, Number(target_amount) || 0, now, now);

  const groupId = groupStmt.lastInsertRowid;

  // Add Creator as Accepted Admin Member
  await db.prepare(`
    INSERT INTO people_group_members (group_id, user_id, email, name, role, status, invited_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'admin', 'accepted', ?, ?, ?)
  `).run(groupId, req.user.id, creatorEmail, creatorName, req.user.id, now, now);

  // Add Invited Members with Pending Status
  for (const inv of sanitizedInvites) {
    // Check if user already exists in platform
    const existingUser = await db.prepare('SELECT id FROM users WHERE LOWER(email) = LOWER(?)').get(inv.email);
    const matchedUserId = existingUser ? existingUser.id : null;

    await db.prepare(`
      INSERT INTO people_group_members (group_id, user_id, email, name, role, status, invited_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)
    `).run(groupId, matchedUserId, inv.email, inv.name, inv.role, req.user.id, now, now);
  }

  const createdGroup = await db.prepare('SELECT * FROM people_groups WHERE id = ?').get(groupId);
  const createdMembers = await db.prepare('SELECT * FROM people_group_members WHERE group_id = ?').all(groupId);

  return sendSuccess(res, { ...createdGroup, members: createdMembers }, 'Financial group created and invitations dispatched', 201);
};

// ── GET /api/people/groups/:id ───────────────────────────────────────────────
const getGroupDetails = async (req, res) => {
  await ensurePeopleGroupsSchema();
  const groupId = req.params.id;

  const group = await db.prepare('SELECT * FROM people_groups WHERE id = ?').get(groupId);
  if (!group) return sendError(res, 'Financial group not found', 404, 'NOT_FOUND');

  // Authorization check: User must be creator or member
  const currentUser = await db.prepare('SELECT id, email FROM users WHERE id = ?').get(req.user.id);
  const userEmail = (currentUser?.email || req.user?.email || '').toLowerCase().trim();

  const myMembership = await db.prepare(`
    SELECT * FROM people_group_members
    WHERE group_id = ? AND (user_id = ? OR LOWER(email) = LOWER(?))
  `).get(groupId, req.user.id, userEmail);

  if (group.created_by !== req.user.id && (!myMembership || myMembership.status === 'rejected')) {
    return sendError(res, 'Access denied to this financial group', 403, 'FORBIDDEN');
  }

  const members = await db.prepare(`
    SELECT * FROM people_group_members
    WHERE group_id = ?
    ORDER BY CASE WHEN role = 'admin' THEN 1 WHEN role = 'manager' THEN 2 ELSE 3 END, created_at ASC
  `).all(groupId);

  const transactions = await db.prepare(`
    SELECT t.*, m.name as paid_by_name, m.email as paid_by_email
    FROM people_group_transactions t
    LEFT JOIN people_group_members m ON t.paid_by_member_id = m.id
    WHERE t.group_id = ?
    ORDER BY t.date DESC, t.created_at DESC, t.id DESC
  `).all(groupId);

  // Fetch splits for all transactions
  const splits = await db.prepare(`
    SELECT s.*, m.name as member_name, m.email as member_email
    FROM people_group_splits s
    JOIN people_group_transactions t ON s.transaction_id = t.id
    JOIN people_group_members m ON s.member_id = m.id
    WHERE t.group_id = ?
  `).all(groupId);

  // Calculate Member Financial Balances
  const balanceMap = {};
  members.forEach(m => {
    balanceMap[m.id] = {
      member_id: m.id,
      name: m.name,
      email: m.email,
      role: m.role,
      status: m.status,
      total_contributed: 0,
      total_paid: 0,
      total_owed: 0,
      net_balance: 0
    };
  });

  transactions.forEach(tx => {
    const amount = Number(tx.amount) || 0;
    if (tx.type === 'contribution') {
      if (balanceMap[tx.paid_by_member_id]) {
        balanceMap[tx.paid_by_member_id].total_contributed += amount;
      }
    } else if (tx.type === 'expense') {
      if (balanceMap[tx.paid_by_member_id]) {
        balanceMap[tx.paid_by_member_id].total_paid += amount;
      }
    }
  });

  splits.forEach(s => {
    const owed = Number(s.owed_amount) || 0;
    if (balanceMap[s.member_id]) {
      balanceMap[s.member_id].total_owed += owed;
    }
  });

  Object.values(balanceMap).forEach(b => {
    b.net_balance = (b.total_paid + b.total_contributed) - b.total_owed;
  });

  // Fetch private notes written by this user for members in this group (strictly only for req.user.id)
  let privateNotes = [];
  try {
    privateNotes = await db.prepare(`
      SELECT pn.*, m.name as member_name, m.email as member_email
      FROM people_group_private_notes pn
      JOIN people_group_members m ON pn.member_id = m.id
      WHERE pn.group_id = ? AND pn.user_id = ?
    `).all(groupId, req.user.id);
  } catch (err) {
    privateNotes = [];
  }

  const privateNotesMap = {};
  let totalPrivateCommitments = 0;
  (privateNotes || []).forEach(pn => {
    const amt = Number(pn.amount) || 0;
    totalPrivateCommitments += amt;
    privateNotesMap[pn.member_id] = {
      id: pn.id,
      amount: amt,
      notes: pn.notes || '',
      updated_at: pn.updated_at
    };
  });

  members.forEach(m => {
    m.private_note = privateNotesMap[m.id] || null;
  });

  Object.values(balanceMap).forEach(b => {
    b.private_note = privateNotesMap[b.member_id] || null;
  });

  const txSummary = await db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN type = 'contribution' THEN amount ELSE 0 END), 0) as total_contributed,
      COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) as total_expenses,
      COALESCE(SUM(CASE WHEN type = 'loan' THEN amount ELSE 0 END), 0) as total_loans
    FROM people_group_transactions
    WHERE group_id = ?
  `).get(groupId);

  return sendSuccess(res, {
    ...group,
    my_membership: myMembership || { role: group.created_by === req.user.id ? 'admin' : 'viewer', status: 'accepted' },
    members,
    transactions,
    splits,
    balances: Object.values(balanceMap),
    my_private_notes: privateNotes || [],
    summary: {
      total_contributed: Number(txSummary?.total_contributed || 0),
      total_expenses: Number(txSummary?.total_expenses || 0),
      total_loans: Number(txSummary?.total_loans || 0),
      target_amount: Number(group.target_amount || 0),
      total_private_commitments: totalPrivateCommitments
    }
  }, 'Group details fetched');
};

// ── PUT /api/people/groups/:id ───────────────────────────────────────────────
const updateGroup = async (req, res) => {
  await ensurePeopleGroupsSchema();
  const groupId = req.params.id;
  const group = await db.prepare('SELECT * FROM people_groups WHERE id = ?').get(groupId);
  if (!group) return sendError(res, 'Group not found', 404, 'NOT_FOUND');

  // Verify Admin or Manager permission
  const currentUser = await db.prepare('SELECT id, email FROM users WHERE id = ?').get(req.user.id);
  const userEmail = (currentUser?.email || req.user?.email || '').toLowerCase().trim();

  const myMembership = await db.prepare(`
    SELECT role FROM people_group_members
    WHERE group_id = ? AND (user_id = ? OR LOWER(email) = LOWER(?)) AND status = 'accepted'
  `).get(groupId, req.user.id, userEmail);

  if (group.created_by !== req.user.id && (!myMembership || !['admin', 'manager'].includes(myMembership.role))) {
    return sendError(res, 'Only Group Admins or Managers can edit this group', 403, 'FORBIDDEN');
  }

  const { name, description, group_type, currency, target_amount, status } = req.body;
  const updates = [];
  const params = [];

  if (name !== undefined) { updates.push('name = ?'); params.push(name.trim()); }
  if (description !== undefined) { updates.push('description = ?'); params.push(description ? description.trim() : null); }
  if (group_type !== undefined) { updates.push('group_type = ?'); params.push(group_type); }
  if (currency !== undefined) { updates.push('currency = ?'); params.push(currency); }
  if (target_amount !== undefined) { updates.push('target_amount = ?'); params.push(Number(target_amount) || 0); }
  if (status !== undefined) { updates.push('status = ?'); params.push(status); }

  if (updates.length > 0) {
    updates.push('updated_at = ?');
    params.push(new Date().toISOString());
    params.push(groupId);
    await db.prepare(`UPDATE people_groups SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  }

  const updatedGroup = await db.prepare('SELECT * FROM people_groups WHERE id = ?').get(groupId);
  return sendSuccess(res, updatedGroup, 'Financial group updated');
};

// ── DELETE /api/people/groups/:id ────────────────────────────────────────────
const deleteGroup = async (req, res) => {
  await ensurePeopleGroupsSchema();
  const groupId = req.params.id;
  const group = await db.prepare('SELECT * FROM people_groups WHERE id = ?').get(groupId);
  if (!group) return sendError(res, 'Group not found', 404, 'NOT_FOUND');

  if (group.created_by !== req.user.id) {
    return sendError(res, 'Only the group creator can delete this group', 403, 'FORBIDDEN');
  }

  // Cascade delete
  const txList = await db.prepare('SELECT id FROM people_group_transactions WHERE group_id = ?').all(groupId);
  for (const t of (txList || [])) {
    await db.prepare('DELETE FROM people_group_splits WHERE transaction_id = ?').run(t.id);
  }
  await db.prepare('DELETE FROM people_group_transactions WHERE group_id = ?').run(groupId);
  await db.prepare('DELETE FROM people_group_members WHERE group_id = ?').run(groupId);
  await db.prepare('DELETE FROM people_groups WHERE id = ?').run(groupId);

  return sendSuccess(res, { deleted: true }, 'Financial group deleted');
};

// ── POST /api/people/groups/:id/members (Invite Member) ───────────────────────
const inviteGroupMember = async (req, res) => {
  await ensurePeopleGroupsSchema();
  const groupId = req.params.id;
  const { name, email, role = 'member' } = req.body;

  const group = await db.prepare('SELECT * FROM people_groups WHERE id = ?').get(groupId);
  if (!group) return sendError(res, 'Group not found', 404, 'NOT_FOUND');

  // Permission check
  const currentUser = await db.prepare('SELECT id, email FROM users WHERE id = ?').get(req.user.id);
  const userEmail = (currentUser?.email || req.user?.email || '').toLowerCase().trim();

  const myMembership = await db.prepare(`
    SELECT role FROM people_group_members
    WHERE group_id = ? AND (user_id = ? OR LOWER(email) = LOWER(?)) AND status = 'accepted'
  `).get(groupId, req.user.id, userEmail);

  if (group.created_by !== req.user.id && (!myMembership || !['admin', 'manager'].includes(myMembership.role))) {
    return sendError(res, 'Only Group Admins or Managers can invite new members', 403, 'FORBIDDEN');
  }

  const cleanEmail = (email || '').trim().toLowerCase();
  if (!cleanEmail || !BNXMAIL_REGEX.test(cleanEmail)) {
    return sendError(res, 'Only valid @bnxmail.com domain addresses are accepted.', 400, 'BAD_REQUEST');
  }

  if (cleanEmail === userEmail) {
    return sendError(res, 'You cannot invite yourself to the group.', 400, 'BAD_REQUEST');
  }

  // Check duplicate member
  const existing = await db.prepare('SELECT id, status FROM people_group_members WHERE group_id = ? AND LOWER(email) = LOWER(?)').get(groupId, cleanEmail);
  if (existing) {
    if (existing.status === 'pending') {
      return sendError(res, 'An invitation to this member is already pending.', 409, 'CONFLICT');
    }
    if (existing.status === 'accepted') {
      return sendError(res, 'This member is already an active participant in this group.', 409, 'CONFLICT');
    }
    // If rejected previously, allow re-invitation by resetting to pending
    const now = new Date().toISOString();
    await db.prepare('UPDATE people_group_members SET status = ?, role = ?, updated_at = ? WHERE id = ?').run('pending', role, now, existing.id);
    const renewed = await db.prepare('SELECT * FROM people_group_members WHERE id = ?').get(existing.id);
    return sendSuccess(res, renewed, 'Invitation re-sent successfully');
  }

  const matchedUser = await db.prepare('SELECT id FROM users WHERE LOWER(email) = LOWER(?)').get(cleanEmail);
  const now = new Date().toISOString();
  const info = await db.prepare(`
    INSERT INTO people_group_members (group_id, user_id, email, name, role, status, invited_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)
  `).run(groupId, matchedUser ? matchedUser.id : null, cleanEmail, (name || cleanEmail.split('@')[0]).trim(), role, req.user.id, now, now);

  const newMember = await db.prepare('SELECT * FROM people_group_members WHERE id = ?').get(info.lastInsertRowid);
  return sendSuccess(res, newMember, 'Invitation sent to @bnxmail.com member', 201);
};

// ── DELETE /api/people/groups/:id/members/:memberId (Remove Member) ───────────
const removeGroupMember = async (req, res) => {
  await ensurePeopleGroupsSchema();
  const { id: groupId, memberId } = req.params;

  const group = await db.prepare('SELECT * FROM people_groups WHERE id = ?').get(groupId);
  if (!group) return sendError(res, 'Group not found', 404, 'NOT_FOUND');

  const currentUser = await db.prepare('SELECT id, email FROM users WHERE id = ?').get(req.user.id);
  const userEmail = (currentUser?.email || req.user?.email || '').toLowerCase().trim();

  const myMembership = await db.prepare(`
    SELECT role FROM people_group_members
    WHERE group_id = ? AND (user_id = ? OR LOWER(email) = LOWER(?)) AND status = 'accepted'
  `).get(groupId, req.user.id, userEmail);

  if (group.created_by !== req.user.id && (!myMembership || myMembership.role !== 'admin')) {
    return sendError(res, 'Only Group Admins can remove members', 403, 'FORBIDDEN');
  }

  await db.prepare('DELETE FROM people_group_members WHERE id = ? AND group_id = ?').run(memberId, groupId);
  return sendSuccess(res, { removed: true }, 'Member removed from group');
};

// ── GET /api/people/groups/requests/incoming ─────────────────────────────────
const getGroupIncomingRequests = async (req, res) => {
  await ensurePeopleGroupsSchema();
  const currentUser = await db.prepare('SELECT id, email FROM users WHERE id = ?').get(req.user.id);
  const userEmail = (currentUser?.email || req.user?.email || '').toLowerCase().trim();

  if (!userEmail) return sendSuccess(res, []);

  const requests = await db.prepare(`
    SELECT 
      m.id as membership_id,
      m.group_id,
      m.email as invited_email,
      m.name as invited_as_name,
      m.role as invited_role,
      m.created_at as invited_at,
      g.name as group_name,
      g.description as group_description,
      g.group_type,
      g.currency,
      g.target_amount,
      u.username as inviter_username,
      u.email as inviter_email,
      u.business_name as inviter_business_name
    FROM people_group_members m
    JOIN people_groups g ON m.group_id = g.id
    LEFT JOIN users u ON m.invited_by = u.id
    WHERE LOWER(m.email) = LOWER(?) AND m.status = 'pending'
    ORDER BY m.created_at DESC
  `).all(userEmail);

  return sendSuccess(res, requests || [], 'Incoming group invitations fetched');
};

// ── POST /api/people/groups/requests/:membershipId/respond ───────────────────
const respondToGroupRequest = async (req, res) => {
  await ensurePeopleGroupsSchema();
  const { membershipId } = req.params;
  const { action } = req.body;

  if (!action || !['accept', 'reject', 'accepted', 'rejected'].includes(action)) {
    return sendError(res, "Action must be 'accept' or 'reject'", 400, 'BAD_REQUEST');
  }

  const normalizedStatus = (action === 'accept' || action === 'accepted') ? 'accepted' : 'rejected';

  const membership = await db.prepare(`
    SELECT m.*, g.name as group_name
    FROM people_group_members m
    JOIN people_groups g ON m.group_id = g.id
    WHERE m.id = ?
  `).get(membershipId);

  if (!membership) {
    return sendError(res, 'Group invitation not found', 404, 'NOT_FOUND');
  }

  const currentUser = await db.prepare('SELECT id, email FROM users WHERE id = ?').get(req.user.id);
  const userEmail = (currentUser?.email || req.user?.email || '').toLowerCase().trim();

  if ((membership.email || '').toLowerCase().trim() !== userEmail) {
    return sendError(res, 'You are not authorized to respond to this invitation', 403, 'FORBIDDEN');
  }

  const now = new Date().toISOString();
  await db.prepare(`
    UPDATE people_group_members 
    SET status = ?, user_id = ?, updated_at = ? 
    WHERE id = ?
  `).run(normalizedStatus, req.user.id, now, membershipId);

  const updatedMembership = await db.prepare('SELECT * FROM people_group_members WHERE id = ?').get(membershipId);
  return sendSuccess(res, updatedMembership, `Group invitation ${normalizedStatus}`);
};

// ── POST /api/people/groups/:id/transactions (Add Transaction) ───────────────
const addGroupTransaction = async (req, res) => {
  await ensurePeopleGroupsSchema();
  const groupId = req.params.id;
  const { type, amount, title, category = 'General', notes, date, paid_by_member_id, splits = [] } = req.body;

  if (!title || !type || !amount) {
    return sendError(res, 'Title, type, and amount are required.', 400, 'BAD_REQUEST');
  }

  const numAmount = Number(amount);
  if (isNaN(numAmount) || numAmount <= 0) {
    return sendError(res, 'Amount must be greater than 0.', 400, 'BAD_REQUEST');
  }

  // Verify group & membership
  const group = await db.prepare('SELECT * FROM people_groups WHERE id = ?').get(groupId);
  if (!group) return sendError(res, 'Group not found', 404, 'NOT_FOUND');

  const currentUser = await db.prepare('SELECT id, email FROM users WHERE id = ?').get(req.user.id);
  const userEmail = (currentUser?.email || req.user?.email || '').toLowerCase().trim();

  const myMembership = await db.prepare(`
    SELECT id, role FROM people_group_members
    WHERE group_id = ? AND (user_id = ? OR LOWER(email) = LOWER(?)) AND status = 'accepted'
  `).get(groupId, req.user.id, userEmail);

  if (group.created_by !== req.user.id && (!myMembership || myMembership.role === 'auditor')) {
    return sendError(res, 'Auditors/viewers cannot log transactions.', 403, 'FORBIDDEN');
  }

  const resolvedPaidByMemberId = paid_by_member_id || (myMembership ? myMembership.id : null);
  const now = new Date().toISOString();
  const txDate = date || now.slice(0, 10);

  const txInfo = await db.prepare(`
    INSERT INTO people_group_transactions (group_id, created_by, paid_by_member_id, type, amount, title, category, notes, date, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(groupId, req.user.id, resolvedPaidByMemberId, type, numAmount, title.trim(), category, notes ? notes.trim() : null, txDate, now, now);

  const txId = txInfo.lastInsertRowid;

  // Handle splits for expenses or contributions
  if (type === 'expense') {
    // If custom splits provided, insert them
    if (Array.isArray(splits) && splits.length > 0) {
      for (const s of splits) {
        if (s.member_id && Number(s.owed_amount) > 0) {
          await db.prepare(`
            INSERT INTO people_group_splits (transaction_id, member_id, owed_amount)
            VALUES (?, ?, ?)
          `).run(txId, s.member_id, Number(s.owed_amount));
        }
      }
    } else {
      // Default: Split equally across all active accepted members
      const activeMembers = await db.prepare(`
        SELECT id FROM people_group_members WHERE group_id = ? AND status = 'accepted'
      `).all(groupId);

      if (activeMembers.length > 0) {
        const splitAmount = Math.round((numAmount / activeMembers.length) * 100) / 100;
        for (const m of activeMembers) {
          await db.prepare(`
            INSERT INTO people_group_splits (transaction_id, member_id, owed_amount)
            VALUES (?, ?, ?)
          `).run(txId, m.id, splitAmount);
        }
      }
    }
  }

  // Update group's updated_at
  await db.prepare('UPDATE people_groups SET updated_at = ? WHERE id = ?').run(now, groupId);

  const createdTx = await db.prepare('SELECT * FROM people_group_transactions WHERE id = ?').get(txId);
  return sendSuccess(res, createdTx, 'Transaction recorded successfully', 201);
};

// ── DELETE /api/people/groups/:id/transactions/:txId ─────────────────────────
const deleteGroupTransaction = async (req, res) => {
  await ensurePeopleGroupsSchema();
  const { id: groupId, txId } = req.params;

  const tx = await db.prepare('SELECT * FROM people_group_transactions WHERE id = ? AND group_id = ?').get(txId, groupId);
  if (!tx) return sendError(res, 'Transaction not found', 404, 'NOT_FOUND');

  const group = await db.prepare('SELECT created_by FROM people_groups WHERE id = ?').get(groupId);

  if (tx.created_by !== req.user.id && group.created_by !== req.user.id) {
    return sendError(res, 'You are not authorized to delete this transaction', 403, 'FORBIDDEN');
  }

  await db.prepare('DELETE FROM people_group_splits WHERE transaction_id = ?').run(txId);
  await db.prepare('DELETE FROM people_group_transactions WHERE id = ?').run(txId);

  return sendSuccess(res, { deleted: true }, 'Transaction removed');
};

// ── POST/PUT /api/people/groups/:id/members/:memberId/private-note ───────────
// Set or update a private commitment / note to give money to a specific group member
// Note: This is strictly private and ONLY returned to req.user.id
const setMemberPrivateNote = async (req, res) => {
  await ensurePeopleGroupsSchema();
  const { id: groupId, memberId } = req.params;
  const { amount, notes } = req.body;

  const group = await db.prepare('SELECT id, created_by FROM people_groups WHERE id = ?').get(groupId);
  if (!group) return sendError(res, 'Group not found', 404, 'NOT_FOUND');

  const member = await db.prepare('SELECT id, name, email FROM people_group_members WHERE id = ? AND group_id = ?').get(memberId, groupId);
  if (!member) return sendError(res, 'Member not found in this group', 404, 'NOT_FOUND');

  // Verify access
  const currentUser = await db.prepare('SELECT id, email FROM users WHERE id = ?').get(req.user.id);
  const userEmail = (currentUser?.email || req.user?.email || '').toLowerCase().trim();

  const myMembership = await db.prepare(`
    SELECT id FROM people_group_members
    WHERE group_id = ? AND (user_id = ? OR LOWER(email) = LOWER(?)) AND status = 'accepted'
  `).get(groupId, req.user.id, userEmail);

  if (group.created_by !== req.user.id && !myMembership) {
    return sendError(res, 'Access denied', 403, 'FORBIDDEN');
  }

  const existing = await db.prepare(`
    SELECT id FROM people_group_private_notes
    WHERE group_id = ? AND user_id = ? AND member_id = ?
  `).get(groupId, req.user.id, memberId);

  const numAmount = Number(amount) || 0;
  const noteText = notes ? notes.trim() : '';
  const now = new Date().toISOString();

  if (existing) {
    await db.prepare(`
      UPDATE people_group_private_notes
      SET amount = ?, notes = ?, updated_at = ?
      WHERE id = ?
    `).run(numAmount, noteText, now, existing.id);

    return sendSuccess(res, {
      id: existing.id,
      group_id: Number(groupId),
      member_id: Number(memberId),
      amount: numAmount,
      notes: noteText,
      updated_at: now
    }, 'Private note saved (only visible to you)');
  } else {
    const result = await db.prepare(`
      INSERT INTO people_group_private_notes (group_id, user_id, member_id, amount, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(groupId, req.user.id, memberId, numAmount, noteText, now, now);

    return sendSuccess(res, {
      id: result?.lastInsertRowid || result?.insertId,
      group_id: Number(groupId),
      member_id: Number(memberId),
      amount: numAmount,
      notes: noteText,
      created_at: now,
      updated_at: now
    }, 'Private note saved (only visible to you)', 201);
  }
};

// ── DELETE /api/people/groups/:id/members/:memberId/private-note ───────────
const deleteMemberPrivateNote = async (req, res) => {
  await ensurePeopleGroupsSchema();
  const { id: groupId, memberId } = req.params;

  await db.prepare(`
    DELETE FROM people_group_private_notes
    WHERE group_id = ? AND user_id = ? AND member_id = ?
  `).run(groupId, req.user.id, memberId);

  return sendSuccess(res, { deleted: true }, 'Private note removed');
};

module.exports = {
  getGroups,
  createGroup,
  getGroupDetails,
  updateGroup,
  deleteGroup,
  inviteGroupMember,
  removeGroupMember,
  getGroupIncomingRequests,
  respondToGroupRequest,
  addGroupTransaction,
  deleteGroupTransaction,
  setMemberPrivateNote,
  deleteMemberPrivateNote
};
