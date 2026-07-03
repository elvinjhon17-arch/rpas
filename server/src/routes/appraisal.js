import { Router } from 'express';
import { db, must } from '../supabase.js';
import { auth, adminOnly } from '../middleware/auth.js';
import { computeScores } from '../scoring.js';
import { loadSettings } from './config.js';

const router = Router();
router.use(auth);

const normalizeTask = (t) => {
  const { task_ratings, ...task } = t;
  return { ...task, rating: Array.isArray(task_ratings) ? task_ratings[0] || null : task_ratings || null };
};

async function getAppraisal(userId, periodId) {
  const rows = must(await db.from('appraisals').select('*').eq('user_id', userId).eq('period_id', periodId).limit(1));
  return rows[0] || null;
}

function requireSelfOrAdmin(req, res, userId) {
  if (req.user.role !== 'admin' && req.user.id !== userId) {
    res.status(403).json({ error: 'Not allowed' });
    return false;
  }
  return true;
}

// ---------- Tasks (Part I rows) ----------
router.get('/tasks', async (req, res, next) => {
  try {
    const userId = req.query.userId || req.user.id;
    const { periodId } = req.query;
    if (!periodId) return res.status(400).json({ error: 'periodId is required' });
    if (!requireSelfOrAdmin(req, res, userId)) return;

    const tasks = must(
      await db
        .from('tasks')
        .select('*, task_ratings(*)')
        .eq('user_id', userId)
        .eq('period_id', periodId)
        .order('sort_order')
    );
    res.json({ tasks: tasks.map(normalizeTask), appraisal: await getAppraisal(userId, periodId) });
  } catch (e) {
    next(e);
  }
});

router.post('/tasks', adminOnly, async (req, res, next) => {
  try {
    const { user_id, period_id, category, code, name, unit, qty_target, quality_target, time_target, weight, sort_order } =
      req.body || {};
    if (!user_id || !period_id || !name) return res.status(400).json({ error: 'Employee, period and task name are required' });
    const rows = must(
      await db
        .from('tasks')
        .insert({
          user_id,
          period_id,
          category: category || 'Duties and Responsibilities',
          code: code || '',
          name,
          unit: unit || '',
          qty_target: qty_target || '',
          quality_target: quality_target || '1',
          time_target: time_target || 'EOM',
          weight: weight ?? 0.05,
          sort_order: sort_order ?? 0
        })
        .select()
    );
    res.json({ task: normalizeTask(rows[0]) });
  } catch (e) {
    next(e);
  }
});

router.put('/tasks/:id', adminOnly, async (req, res, next) => {
  try {
    const allowed = ['category', 'code', 'name', 'unit', 'qty_target', 'quality_target', 'time_target', 'weight', 'sort_order'];
    const patch = Object.fromEntries(Object.entries(req.body || {}).filter(([k]) => allowed.includes(k)));
    const rows = must(await db.from('tasks').update(patch).eq('id', req.params.id).select());
    res.json({ task: normalizeTask(rows[0]) });
  } catch (e) {
    next(e);
  }
});

router.delete('/tasks/:id', adminOnly, async (req, res, next) => {
  try {
    must(await db.from('tasks').delete().eq('id', req.params.id).select());
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// Copy all tasks from one employee/period to another (targets and weights only, no ratings)
router.post('/tasks/copy', adminOnly, async (req, res, next) => {
  try {
    const { fromUserId, fromPeriodId, toUserId, toPeriodId } = req.body || {};
    if (!fromUserId || !fromPeriodId || !toUserId || !toPeriodId) {
      return res.status(400).json({ error: 'Source and target employee/period are required' });
    }
    const source = must(await db.from('tasks').select('*').eq('user_id', fromUserId).eq('period_id', fromPeriodId).order('sort_order'));
    if (!source.length) return res.status(400).json({ error: 'Source has no tasks to copy' });
    const clones = source.map(({ id, user_id, period_id, ...t }) => ({ ...t, user_id: toUserId, period_id: toPeriodId }));
    const rows = must(await db.from('tasks').insert(clones).select());
    res.json({ copied: rows.length });
  } catch (e) {
    next(e);
  }
});

// ---------- Self-rating a task ----------
router.put('/ratings/task/:taskId', async (req, res, next) => {
  try {
    const tasks = must(await db.from('tasks').select('*').eq('id', req.params.taskId).limit(1));
    const task = tasks[0];
    if (!task) return res.status(404).json({ error: 'Task not found' });
    if (!requireSelfOrAdmin(req, res, task.user_id)) return;

    const appraisal = await getAppraisal(task.user_id, task.period_id);
    if (appraisal?.status === 'submitted' && req.user.role !== 'admin') {
      return res.status(400).json({ error: 'Appraisal already submitted - ask the admin to reopen it' });
    }

    const allowed = ['qty_accomp', 'quality_accomp', 'time_status', 'rate_qn', 'rate_ql', 'rate_t', 'remarks'];
    const patch = Object.fromEntries(Object.entries(req.body || {}).filter(([k]) => allowed.includes(k)));
    for (const k of ['rate_qn', 'rate_ql', 'rate_t']) {
      if (patch[k] !== undefined && patch[k] !== null && patch[k] !== '') {
        const v = Number(patch[k]);
        if (Number.isNaN(v) || v < 0 || v > 10) return res.status(400).json({ error: 'Ratings must be between 0 and 10' });
        patch[k] = v;
      } else if (patch[k] === '') {
        patch[k] = null;
      }
    }
    const rows = must(
      await db
        .from('task_ratings')
        .upsert({ task_id: task.id, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'task_id' })
        .select()
    );
    res.json({ rating: rows[0] });
  } catch (e) {
    next(e);
  }
});

// ---------- Factor ratings (Part II) ----------
router.get('/factor-ratings', async (req, res, next) => {
  try {
    const userId = req.query.userId || req.user.id;
    const { periodId } = req.query;
    if (!periodId) return res.status(400).json({ error: 'periodId is required' });
    if (!requireSelfOrAdmin(req, res, userId)) return;
    const ratings = must(await db.from('factor_ratings').select('*').eq('user_id', userId).eq('period_id', periodId));
    res.json({ ratings });
  } catch (e) {
    next(e);
  }
});

router.put('/factor-ratings', async (req, res, next) => {
  try {
    const { periodId, factorId, rating } = req.body || {};
    const userId = req.body.userId || req.user.id;
    if (!periodId || !factorId) return res.status(400).json({ error: 'periodId and factorId are required' });
    if (!requireSelfOrAdmin(req, res, userId)) return;

    const appraisal = await getAppraisal(userId, periodId);
    if (appraisal?.status === 'submitted' && req.user.role !== 'admin') {
      return res.status(400).json({ error: 'Appraisal already submitted - ask the admin to reopen it' });
    }
    const value = rating === null || rating === '' ? null : Number(rating);
    if (value !== null && (Number.isNaN(value) || value < 0 || value > 10)) {
      return res.status(400).json({ error: 'Ratings must be between 0 and 10' });
    }
    const rows = must(
      await db
        .from('factor_ratings')
        .upsert(
          { user_id: userId, period_id: periodId, factor_id: factorId, rating: value, updated_at: new Date().toISOString() },
          { onConflict: 'user_id,period_id,factor_id' }
        )
        .select()
    );
    res.json({ rating: rows[0] });
  } catch (e) {
    next(e);
  }
});

// ---------- Submit / reopen ----------
async function scoreForUser(user, periodId, factors, settings) {
  const tasks = must(
    await db.from('tasks').select('*, task_ratings(*)').eq('user_id', user.id).eq('period_id', periodId).order('sort_order')
  ).map(normalizeTask);
  const factorRatings = must(await db.from('factor_ratings').select('*').eq('user_id', user.id).eq('period_id', periodId));
  return computeScores({ tasks, factors, factorRatings, settings, isSupervisor: user.is_supervisor });
}

router.post('/appraisals/submit', async (req, res, next) => {
  try {
    const { periodId, comments } = req.body || {};
    if (!periodId) return res.status(400).json({ error: 'periodId is required' });

    const users = must(await db.from('users').select('*').eq('id', req.user.id).limit(1));
    const factors = must(await db.from('factors').select('*').eq('active', true));
    const settings = await loadSettings();
    const score = await scoreForUser(users[0], periodId, factors, settings);

    const missingTasks = score.progress.tasksTotal - score.progress.tasksRated;
    const missingFactors = score.progress.factorsTotal - score.progress.factorsRated;
    if (score.progress.tasksTotal === 0) return res.status(400).json({ error: 'No tasks assigned yet - ask the admin to set up your tasks' });
    if (missingTasks > 0 || missingFactors > 0) {
      return res.status(400).json({
        error: `Not finished yet: ${missingTasks} task(s) and ${missingFactors} factor(s) still need ratings`
      });
    }

    const rows = must(
      await db
        .from('appraisals')
        .upsert(
          {
            user_id: req.user.id,
            period_id: periodId,
            status: 'submitted',
            comments: comments || '',
            submitted_at: new Date().toISOString()
          },
          { onConflict: 'user_id,period_id' }
        )
        .select()
    );
    res.json({ appraisal: rows[0], score });
  } catch (e) {
    next(e);
  }
});

router.post('/appraisals/:id/reopen', adminOnly, async (req, res, next) => {
  try {
    const rows = must(await db.from('appraisals').update({ status: 'draft', submitted_at: null }).eq('id', req.params.id).select());
    res.json({ appraisal: rows[0] });
  } catch (e) {
    next(e);
  }
});

// ---------- Live score for the logged-in user (or any user, for admin) ----------
router.get('/score', async (req, res, next) => {
  try {
    const userId = req.query.userId || req.user.id;
    const { periodId } = req.query;
    if (!periodId) return res.status(400).json({ error: 'periodId is required' });
    if (!requireSelfOrAdmin(req, res, userId)) return;

    const users = must(await db.from('users').select('*').eq('id', userId).limit(1));
    if (!users[0]) return res.status(404).json({ error: 'User not found' });
    const factors = must(await db.from('factors').select('*').eq('active', true));
    const settings = await loadSettings();
    const score = await scoreForUser(users[0], periodId, factors, settings);
    res.json({ score, appraisal: await getAppraisal(userId, periodId) });
  } catch (e) {
    next(e);
  }
});

// ---------- Admin summary report ----------
router.get('/reports/summary', adminOnly, async (req, res, next) => {
  try {
    const { periodId } = req.query;
    if (!periodId) return res.status(400).json({ error: 'periodId is required' });

    const users = must(await db.from('users').select('*').eq('role', 'employee').order('full_name'));
    const factors = must(await db.from('factors').select('*').eq('active', true));
    const settings = await loadSettings();
    const appraisals = must(await db.from('appraisals').select('*').eq('period_id', periodId));
    const byUser = new Map(appraisals.map((a) => [a.user_id, a]));

    const rows = [];
    for (const user of users) {
      const score = await scoreForUser(user, periodId, factors, settings);
      const appraisal = byUser.get(user.id) || null;
      rows.push({
        user: { id: user.id, full_name: user.full_name, position: user.position, department: user.department, avatar_url: user.avatar_url },
        score,
        status: appraisal?.status || 'draft',
        submitted_at: appraisal?.submitted_at || null,
        comments: appraisal?.comments || '',
        appraisal_id: appraisal?.id || null
      });
    }
    res.json({ rows });
  } catch (e) {
    next(e);
  }
});

export default router;
