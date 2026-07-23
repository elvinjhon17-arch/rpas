import { Router } from 'express';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import { db, must } from '../supabase.js';
import { auth, adminOnly } from '../middleware/auth.js';

const router = Router();
router.use(auth);

const publicUser = ({ password_hash, ...u }) => u;

router.get('/', adminOnly, async (req, res, next) => {
  try {
    const users = must(await db.from('users').select('*').order('full_name'));
    res.json({ users: users.map(publicUser) });
  } catch (e) {
    next(e);
  }
});

router.post('/', adminOnly, async (req, res, next) => {
  try {
    const { username, password, full_name, position, department, role, is_supervisor, rater_privilege, is_approver } =
      req.body || {};
    if (!username || !password || !full_name) {
      return res.status(400).json({ error: 'Username, password and full name are required' });
    }
    if (rater_privilege && !['none', 'page3', 'full'].includes(rater_privilege)) {
      return res.status(400).json({ error: 'Invalid rater privilege' });
    }
    const password_hash = await bcrypt.hash(password, 10);
    const rows = must(
      await db
        .from('users')
        .insert({
          username: username.trim().toLowerCase(),
          password_hash,
          full_name,
          position: position || '',
          department: department || '',
          role: role === 'admin' ? 'admin' : 'employee',
          is_supervisor: !!is_supervisor,
          rater_privilege: rater_privilege || 'none',
          is_approver: !!is_approver
        })
        .select()
    );
    res.json({ user: publicUser(rows[0]) });
  } catch (e) {
    next(e);
  }
});

router.put('/:id', adminOnly, async (req, res, next) => {
  try {
    const { full_name, position, department, role, is_supervisor, username, rater_privilege, is_approver } = req.body || {};
    const patch = {};
    if (username) patch.username = username.trim().toLowerCase();
    if (full_name !== undefined) patch.full_name = full_name;
    if (position !== undefined) patch.position = position;
    if (department !== undefined) patch.department = department;
    if (role) patch.role = role === 'admin' ? 'admin' : 'employee';
    if (is_supervisor !== undefined) patch.is_supervisor = !!is_supervisor;
    if (rater_privilege !== undefined) {
      if (!['none', 'page3', 'full'].includes(rater_privilege)) return res.status(400).json({ error: 'Invalid rater privilege' });
      patch.rater_privilege = rater_privilege;
    }
    if (is_approver !== undefined) patch.is_approver = !!is_approver;
    const rows = must(await db.from('users').update(patch).eq('id', req.params.id).select());
    res.json({ user: publicUser(rows[0]) });
  } catch (e) {
    next(e);
  }
});

router.post('/:id/reset-password', adminOnly, async (req, res, next) => {
  try {
    const { password } = req.body || {};
    if (!password || password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    const password_hash = await bcrypt.hash(password, 10);
    must(await db.from('users').update({ password_hash }).eq('id', req.params.id).select());
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

router.delete('/:id', adminOnly, async (req, res, next) => {
  try {
    if (req.params.id === req.user.id) return res.status(400).json({ error: 'You cannot delete your own account' });
    must(await db.from('users').delete().eq('id', req.params.id).select());
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// Avatar upload - self or admin, stored in the Supabase "avatars" bucket
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /^image\//.test(file.mimetype))
});

router.post('/:id/avatar', upload.single('avatar'), async (req, res, next) => {
  try {
    const targetId = req.params.id;
    if (req.user.role !== 'admin' && req.user.id !== targetId) {
      return res.status(403).json({ error: 'You can only change your own avatar' });
    }
    if (!req.file) return res.status(400).json({ error: 'Please choose an image file (max 3 MB)' });

    const ext = (req.file.mimetype.split('/')[1] || 'png').replace('jpeg', 'jpg');
    const path = `${targetId}.${ext}`;
    const { error: upErr } = await db.storage
      .from('avatars')
      .upload(path, req.file.buffer, { contentType: req.file.mimetype, upsert: true });
    if (upErr) return res.status(400).json({ error: `Upload failed: ${upErr.message}` });

    const { data } = db.storage.from('avatars').getPublicUrl(path);
    const avatar_url = `${data.publicUrl}?t=${Date.now()}`;
    const rows = must(await db.from('users').update({ avatar_url }).eq('id', targetId).select());
    res.json({ user: publicUser(rows[0]) });
  } catch (e) {
    next(e);
  }
});

export default router;
