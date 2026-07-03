import { Router } from 'express';
import { db, must } from '../supabase.js';
import { auth, adminOnly } from '../middleware/auth.js';
import { computeScores, computeFinal, RATER_TYPES, RATER_LABELS } from '../scoring.js';
import { loadSettings } from './config.js';

const router = Router();
router.use(auth);

const normalizeTask = (raterType) => (t) => {
  const { task_ratings, ...task } = t;
  const list = Array.isArray(task_ratings) ? task_ratings : task_ratings ? [task_ratings] : [];
  return { ...task, rating: list.find((r) => (r.rater_type || 'self') === raterType) || null };
};

const parseRaterType = (value) => {
  const raterType = value || 'self';
  return RATER_TYPES.includes(raterType) ? raterType : null;
};

async function getAppraisal(userId, periodId, raterType) {
  const rows = must(
    await db.from('appraisals').select('*').eq('user_id', userId).eq('period_id', periodId).eq('rater_type', raterType).limit(1)
  );
  return rows[0] || null;
}

// Who may enter ratings: admin always; the employee for their own 'self'
// rating; otherwise the user assigned as that rater type for the employee.
async function canRate(req, rateeId, raterType) {
  if (req.user.role === 'admin') return true;
  if (raterType === 'self') return req.user.id === rateeId;
  const rows = must(
    await db
      .from('rater_assignments')
      .select('id')
      .eq('ratee_id', rateeId)
      .eq('rater_type', raterType)
      .eq('rater_user_id', req.user.id)
      .limit(1)
  );
  return rows.length > 0;
}

async function requireRater(req, res, rateeId, raterType) {
  if (await canRate(req, rateeId, raterType)) return true;
  res.status(403).json({ error: 'You are not assigned to rate this employee' });
  return false;
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
    const raterType = parseRaterType(req.query.raterType);
    if (!periodId) return res.status(400).json({ error: 'periodId is required' });
    if (!raterType) return res.status(400).json({ error: 'Invalid rater type' });
    if (!(await requireRater(req, res, userId, raterType))) return;

    const tasks = must(
      await db
        .from('tasks')
        .select('*, task_ratings(*)')
        .eq('user_id', userId)
        .eq('period_id', periodId)
        .order('sort_order')
    );
    res.json({ tasks: tasks.map(normalizeTask(raterType)), appraisal: await getAppraisal(userId, periodId, raterType) });
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
    res.json({ task: normalizeTask('self')(rows[0]) });
  } catch (e) {
    next(e);
  }
});

router.put('/tasks/:id', adminOnly, async (req, res, next) => {
  try {
    const allowed = ['category', 'code', 'name', 'unit', 'qty_target', 'quality_target', 'time_target', 'weight', 'sort_order'];
    const patch = Object.fromEntries(Object.entries(req.body || {}).filter(([k]) => allowed.includes(k)));
    const rows = must(await db.from('tasks').update(patch).eq('id', req.params.id).select());
    res.json({ task: normalizeTask('self')(rows[0]) });
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

// ---------- Rating a task (any rater type) ----------
router.put('/ratings/task/:taskId', async (req, res, next) => {
  try {
    const raterType = parseRaterType(req.body?.raterType);
    if (!raterType) return res.status(400).json({ error: 'Invalid rater type' });

    const tasks = must(await db.from('tasks').select('*').eq('id', req.params.taskId).limit(1));
    const task = tasks[0];
    if (!task) return res.status(404).json({ error: 'Task not found' });
    if (!(await requireRater(req, res, task.user_id, raterType))) return;

    const appraisal = await getAppraisal(task.user_id, task.period_id, raterType);
    if (appraisal?.status === 'submitted' && req.user.role !== 'admin') {
      return res.status(400).json({ error: 'This rating was already submitted - ask the admin to reopen it' });
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
        .upsert(
          { task_id: task.id, rater_type: raterType, ...patch, updated_at: new Date().toISOString() },
          { onConflict: 'task_id,rater_type' }
        )
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
    const raterType = parseRaterType(req.query.raterType);
    if (!periodId) return res.status(400).json({ error: 'periodId is required' });
    if (!raterType) return res.status(400).json({ error: 'Invalid rater type' });
    if (!(await requireRater(req, res, userId, raterType))) return;
    const ratings = must(
      await db.from('factor_ratings').select('*').eq('user_id', userId).eq('period_id', periodId).eq('rater_type', raterType)
    );
    res.json({ ratings });
  } catch (e) {
    next(e);
  }
});

router.put('/factor-ratings', async (req, res, next) => {
  try {
    const { periodId, factorId, rating } = req.body || {};
    const userId = req.body.userId || req.user.id;
    const raterType = parseRaterType(req.body?.raterType);
    if (!periodId || !factorId) return res.status(400).json({ error: 'periodId and factorId are required' });
    if (!raterType) return res.status(400).json({ error: 'Invalid rater type' });
    if (!(await requireRater(req, res, userId, raterType))) return;

    const appraisal = await getAppraisal(userId, periodId, raterType);
    if (appraisal?.status === 'submitted' && req.user.role !== 'admin') {
      return res.status(400).json({ error: 'This rating was already submitted - ask the admin to reopen it' });
    }
    const value = rating === null || rating === '' ? null : Number(rating);
    if (value !== null && (Number.isNaN(value) || value < 0 || value > 10)) {
      return res.status(400).json({ error: 'Ratings must be between 0 and 10' });
    }
    const rows = must(
      await db
        .from('factor_ratings')
        .upsert(
          {
            user_id: userId,
            period_id: periodId,
            factor_id: factorId,
            rater_type: raterType,
            rating: value,
            updated_at: new Date().toISOString()
          },
          { onConflict: 'user_id,period_id,factor_id,rater_type' }
        )
        .select()
    );
    res.json({ rating: rows[0] });
  } catch (e) {
    next(e);
  }
});

// ---------- Rater assignments (admin) ----------
router.get('/assignments', async (req, res, next) => {
  try {
    // Admin can list all or per ratee; a normal user only their own assignments as rater
    let q = db.from('rater_assignments').select('*');
    if (req.user.role === 'admin') {
      if (req.query.rateeId) q = q.eq('ratee_id', req.query.rateeId);
    } else {
      q = q.eq('rater_user_id', req.user.id);
    }
    res.json({ assignments: must(await q) });
  } catch (e) {
    next(e);
  }
});

router.put('/assignments', adminOnly, async (req, res, next) => {
  try {
    const { rateeId, raterType, raterUserId } = req.body || {};
    if (!rateeId || !raterType) return res.status(400).json({ error: 'rateeId and raterType are required' });
    if (!RATER_TYPES.includes(raterType) || raterType === 'self') return res.status(400).json({ error: 'Invalid rater type' });

    if (!raterUserId) {
      // Clearing the assignment
      must(await db.from('rater_assignments').delete().eq('ratee_id', rateeId).eq('rater_type', raterType).select());
      return res.json({ assignment: null });
    }
    if (raterUserId === rateeId) return res.status(400).json({ error: 'An employee cannot be their own ' + raterType + ' rater' });
    const rows = must(
      await db
        .from('rater_assignments')
        .upsert({ ratee_id: rateeId, rater_type: raterType, rater_user_id: raterUserId }, { onConflict: 'ratee_id,rater_type' })
        .select()
    );
    res.json({ assignment: rows[0] });
  } catch (e) {
    next(e);
  }
});

// People the logged-in user rates (with per-ratee status for the period)
router.get('/my-ratees', async (req, res, next) => {
  try {
    const { periodId } = req.query;
    if (!periodId) return res.status(400).json({ error: 'periodId is required' });

    const assignments = must(await db.from('rater_assignments').select('*').eq('rater_user_id', req.user.id));
    if (!assignments.length) return res.json({ ratees: [] });

    const ids = [...new Set(assignments.map((a) => a.ratee_id))];
    const users = must(await db.from('users').select('id, full_name, position, department, avatar_url, is_supervisor').in('id', ids));
    const byId = new Map(users.map((u) => [u.id, u]));

    const ratees = [];
    for (const a of assignments) {
      const user = byId.get(a.ratee_id);
      if (!user) continue;
      const appraisal = await getAppraisal(a.ratee_id, periodId, a.rater_type);
      ratees.push({
        user,
        raterType: a.rater_type,
        raterLabel: RATER_LABELS[a.rater_type],
        status: appraisal?.status || 'draft',
        submitted_at: appraisal?.submitted_at || null
      });
    }
    res.json({ ratees });
  } catch (e) {
    next(e);
  }
});

// ---------- Submit / reopen ----------
async function scoreForUser(user, periodId, factors, settings, raterType) {
  const tasks = must(
    await db.from('tasks').select('*, task_ratings(*)').eq('user_id', user.id).eq('period_id', periodId).order('sort_order')
  ).map(normalizeTask(raterType));
  const factorRatings = must(
    await db.from('factor_ratings').select('*').eq('user_id', user.id).eq('period_id', periodId).eq('rater_type', raterType)
  );
  return computeScores({ tasks, factors, factorRatings, settings, isSupervisor: user.is_supervisor });
}

router.post('/appraisals/submit', async (req, res, next) => {
  try {
    const { periodId, comments } = req.body || {};
    const userId = req.body?.userId || req.user.id;
    const raterType = parseRaterType(req.body?.raterType);
    if (!periodId) return res.status(400).json({ error: 'periodId is required' });
    if (!raterType) return res.status(400).json({ error: 'Invalid rater type' });
    if (!(await requireRater(req, res, userId, raterType))) return;

    const users = must(await db.from('users').select('*').eq('id', userId).limit(1));
    if (!users[0]) return res.status(404).json({ error: 'User not found' });
    const factors = must(await db.from('factors').select('*').eq('active', true));
    const settings = await loadSettings();
    const score = await scoreForUser(users[0], periodId, factors, settings, raterType);

    const missingTasks = score.progress.tasksTotal - score.progress.tasksRated;
    const missingFactors = score.progress.factorsTotal - score.progress.factorsRated;
    if (score.progress.tasksTotal === 0) return res.status(400).json({ error: 'No tasks assigned yet - ask the admin to set up the tasks' });
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
            user_id: userId,
            period_id: periodId,
            rater_type: raterType,
            status: 'submitted',
            comments: comments || '',
            submitted_at: new Date().toISOString()
          },
          { onConflict: 'user_id,period_id,rater_type' }
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

// ---------- Live score for one rater's form ----------
router.get('/score', async (req, res, next) => {
  try {
    const userId = req.query.userId || req.user.id;
    const { periodId } = req.query;
    const raterType = parseRaterType(req.query.raterType);
    if (!periodId) return res.status(400).json({ error: 'periodId is required' });
    if (!raterType) return res.status(400).json({ error: 'Invalid rater type' });
    if (!(await requireRater(req, res, userId, raterType))) return;

    const users = must(await db.from('users').select('*').eq('id', userId).limit(1));
    if (!users[0]) return res.status(404).json({ error: 'User not found' });
    const factors = must(await db.from('factors').select('*').eq('active', true));
    const settings = await loadSettings();
    const score = await scoreForUser(users[0], periodId, factors, settings, raterType);
    res.json({ score, appraisal: await getAppraisal(userId, periodId, raterType) });
  } catch (e) {
    next(e);
  }
});

// ---------- Final rating (Page 3 new): all raters combined ----------
async function finalForUser(user, periodId, factors, settings, appraisals) {
  const raterScores = {};
  for (const a of appraisals) {
    // Only submitted ratings count toward the final score
    if (a.status !== 'submitted') continue;
    raterScores[a.rater_type] = await scoreForUser(user, periodId, factors, settings, a.rater_type);
  }
  const final = computeFinal(raterScores, settings);
  const statusByType = new Map(appraisals.map((a) => [a.rater_type, a]));
  for (const row of final.rows) {
    const a = statusByType.get(row.type);
    row.status = a?.status || 'pending';
    row.submitted_at = a?.submitted_at || null;
  }
  return final;
}

router.get('/final-score', async (req, res, next) => {
  try {
    const userId = req.query.userId || req.user.id;
    const { periodId } = req.query;
    if (!periodId) return res.status(400).json({ error: 'periodId is required' });
    if (!requireSelfOrAdmin(req, res, userId)) return;

    const users = must(await db.from('users').select('*').eq('id', userId).limit(1));
    if (!users[0]) return res.status(404).json({ error: 'User not found' });
    const factors = must(await db.from('factors').select('*').eq('active', true));
    const settings = await loadSettings();
    const appraisals = must(await db.from('appraisals').select('*').eq('user_id', userId).eq('period_id', periodId));
    res.json({ final: await finalForUser(users[0], periodId, factors, settings, appraisals) });
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

    const rows = [];
    for (const user of users) {
      const userAppraisals = appraisals.filter((a) => a.user_id === user.id);
      const final = await finalForUser(user, periodId, factors, settings, userAppraisals);
      const self = userAppraisals.find((a) => a.rater_type === 'self') || null;
      const selfScore = await scoreForUser(user, periodId, factors, settings, 'self');
      rows.push({
        user: { id: user.id, full_name: user.full_name, position: user.position, department: user.department, avatar_url: user.avatar_url },
        final,
        score: selfScore,
        status: self?.status || 'draft',
        submitted_at: self?.submitted_at || null,
        comments: self?.comments || '',
        appraisal_id: self?.id || null,
        appraisals: userAppraisals.map((a) => ({ id: a.id, rater_type: a.rater_type, status: a.status, submitted_at: a.submitted_at }))
      });
    }
    res.json({ rows });
  } catch (e) {
    next(e);
  }
});

export default router;
