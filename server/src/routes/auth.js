import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { db, must } from '../supabase.js';
import { auth, signToken } from '../middleware/auth.js';

const router = Router();

const publicUser = ({ password_hash, ...u }) => u;

router.post('/login', async (req, res, next) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

    const users = must(await db.from('users').select('*').ilike('username', username.trim()).limit(1));
    const user = users[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: 'Wrong username or password' });
    }
    res.json({ token: signToken(user), user: publicUser(user) });
  } catch (e) {
    next(e);
  }
});

router.get('/me', auth, async (req, res, next) => {
  try {
    const users = must(await db.from('users').select('*').eq('id', req.user.id).limit(1));
    if (!users[0]) return res.status(401).json({ error: 'Account no longer exists' });
    res.json({ user: publicUser(users[0]) });
  } catch (e) {
    next(e);
  }
});

router.put('/password', auth, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters' });
    }
    const users = must(await db.from('users').select('*').eq('id', req.user.id).limit(1));
    if (!users[0] || !(await bcrypt.compare(currentPassword || '', users[0].password_hash))) {
      return res.status(401).json({ error: 'Current password is wrong' });
    }
    const password_hash = await bcrypt.hash(newPassword, 10);
    must(await db.from('users').update({ password_hash }).eq('id', req.user.id).select());
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

export default router;
