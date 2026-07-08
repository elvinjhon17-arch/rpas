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

// 'self' stays a valid view type (employee's read-only targets page) even
// though it is no longer one of the raters in RATER_TYPES.
const VIEW_TYPES = [...RATER_TYPES, 'self'];

const parseRaterType = (value) => {
  const raterType = value || 'self';
  return VIEW_TYPES.includes(raterType) ? raterType : null;
};

async function getAppraisal(userId, periodId, raterType) {
  const rows = must(
    await db.from('appraisals').select('*').eq('user_id', userId).eq('period_id', periodId).eq('rater_type', raterType).limit(1)
  );
  return rows[0] || null;
}

// Who may enter ratings: when a rater is assigned for the slot, ONLY that
// person may rate it (not even the admin - they can reopen or reassign
// instead). When the slot is unassigned, only the admin may encode a score
// (e.g. transcribing a paper form).
async function canRate(req, rateeId, raterType) {
  const rows = must(
    await db.from('rater_assignments').select('rater_user_id').eq('ratee_id', rateeId).eq('rater_type', raterType).limit(1)
  );
  const assignedTo = rows[0]?.rater_user_id || null;
  if (assignedTo) return assignedTo === req.user.id;
  return req.user.role === 'admin';
}

async function requireRater(req, res, rateeId, raterType) {
  if (await canRate(req, rateeId, raterType)) return true;
  res.status(403).json({
    error: 'Only the assigned rater can enter this rating. The admin can change the assignment in Employees > Raters.'
  });
  return false;
}

// Read access: admins, the employee themselves (they may see how they were
// rated), and anyone assigned as one of their raters.
async function requireViewer(req, res, rateeId) {
  if (req.user.role === 'admin' || req.user.id === rateeId) return true;
  const rows = must(
    await db.from('rater_assignments').select('id').eq('ratee_id', rateeId).eq('rater_user_id', req.user.id).limit(1)
  );
  if (rows.length) return true;
  res.status(403).json({ error: 'Not allowed' });
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
    if (!(await requireViewer(req, res, userId))) return;

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

// ---------- Task accomplishments (entered by the RATEE) ----------
// Quantity/Quality accomplished and Time status are facts the employee
// records about their own work; raters only score them.
router.put('/tasks/:id/accomplishment', async (req, res, next) => {
  try {
    const tasks = must(await db.from('tasks').select('*').eq('id', req.params.id).limit(1));
    const task = tasks[0];
    if (!task) return res.status(404).json({ error: 'Task not found' });
    if (req.user.role !== 'admin' && req.user.id !== task.user_id) {
      return res.status(403).json({ error: 'Only the employee enters their accomplishments - raters only enter the scores' });
    }

    // Once the supervisor has submitted, the facts under their rating are locked
    const supAppraisal = await getAppraisal(task.user_id, task.period_id, 'supervisor');
    if (supAppraisal?.status === 'submitted' && req.user.role !== 'admin') {
      return res.status(400).json({ error: 'Your supervisor already submitted the rating - ask the admin to reopen it first' });
    }

    const allowed = ['qty_accomp', 'quality_accomp', 'time_status'];
    const patch = Object.fromEntries(Object.entries(req.body || {}).filter(([k]) => allowed.includes(k)));
    if (patch.time_status !== undefined && !['', 'COMPLETE', 'DELAYED', 'NOT DONE'].includes(patch.time_status)) {
      return res.status(400).json({ error: 'Invalid time status' });
    }
    if (!Object.keys(patch).length) return res.status(400).json({ error: 'Nothing to update' });
    const rows = must(await db.from('tasks').update(patch).eq('id', task.id).select());
    res.json({ task: normalizeTask('self')(rows[0]) });
  } catch (e) {
    next(e);
  }
});

// ---------- Rating a task (Part I - supervisor only) ----------
// Self/HR/Peer/Audit rate only on Page 3 (one overall score via submit).
router.put('/ratings/task/:taskId', async (req, res, next) => {
  try {
    const raterType = parseRaterType(req.body?.raterType);
    if (!raterType) return res.status(400).json({ error: 'Invalid rater type' });
    if (raterType !== 'supervisor' && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Only the supervisor rates Part I - other raters enter one overall score on Page 3' });
    }

    const tasks = must(await db.from('tasks').select('*').eq('id', req.params.taskId).limit(1));
    const task = tasks[0];
    if (!task) return res.status(404).json({ error: 'Task not found' });
    if (!(await requireRater(req, res, task.user_id, raterType))) return;

    const appraisal = await getAppraisal(task.user_id, task.period_id, raterType);
    if (appraisal?.status === 'submitted' && req.user.role !== 'admin') {
      return res.status(400).json({ error: 'This rating was already submitted - ask the admin to reopen it' });
    }

    // Accomplishment facts are entered by the ratee via /tasks/:id/accomplishment
    const allowed = ['rate_qn', 'rate_ql', 'rate_t', 'remarks'];
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
    if (!(await requireViewer(req, res, userId))) return;
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
    if (raterType !== 'supervisor' && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Only the supervisor rates Part II - other raters enter one overall score on Page 3' });
    }
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

    // The account must hold the right privilege for the pages this rater type touches
    const raters = must(await db.from('users').select('id, full_name, rater_privilege').eq('id', raterUserId).limit(1));
    if (!raters[0]) return res.status(404).json({ error: 'Rater account not found' });
    const privilege = raters[0].rater_privilege || 'none';
    if (raterType === 'supervisor' && privilege !== 'full') {
      return res.status(400).json({
        error: `${raters[0].full_name} cannot be a Supervisor rater - set their rating privilege to "All pages (officer/head)" first`
      });
    }
    if (raterType !== 'supervisor' && privilege === 'none') {
      return res.status(400).json({
        error: `${raters[0].full_name} has no rating privilege - set it to at least "Page 3 rater" first`
      });
    }

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

    const assignments = must(await db.from('rater_assignments').select('*').eq('rater_user_id', req.user.id)).filter((a) =>
      RATER_TYPES.includes(a.rater_type)
    );
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
    if (!raterType || !RATER_TYPES.includes(raterType)) {
      return res.status(400).json({ error: 'Invalid rater type - the final rating combines Supervisor, HR and Internal Audit' });
    }
    if (!(await requireRater(req, res, userId, raterType))) return;

    const record = {
      user_id: userId,
      period_id: periodId,
      rater_type: raterType,
      status: 'submitted',
      comments: comments || '',
      submitted_at: new Date().toISOString()
    };

    let score = null;
    if (raterType === 'supervisor') {
      // Supervisor fills Pages 1-2; their score is computed from the form
      const users = must(await db.from('users').select('*').eq('id', userId).limit(1));
      if (!users[0]) return res.status(404).json({ error: 'User not found' });
      const factors = must(await db.from('factors').select('*').eq('active', true));
      const settings = await loadSettings();
      score = await scoreForUser(users[0], periodId, factors, settings, raterType);

      const missingTasks = score.progress.tasksTotal - score.progress.tasksRated;
      const missingFactors = score.progress.factorsTotal - score.progress.factorsRated;
      if (score.progress.tasksTotal === 0) return res.status(400).json({ error: 'No tasks assigned yet - ask the admin to set up the tasks' });
      if (Math.abs(score.totalWeight - 1) > 0.001) {
        return res.status(400).json({
          error: `Task weights add up to ${score.totalWeight.toFixed(2)} but must equal exactly 1.00 - ask the admin to fix the weights in Task Setup`
        });
      }
      if (missingTasks > 0 || missingFactors > 0) {
        return res.status(400).json({
          error: `Not finished yet: ${missingTasks} task(s) and ${missingFactors} factor(s) still need ratings`
        });
      }
      record.overall_score = score.overall;
    } else if (req.body?.detail && typeof req.body.detail === 'object' && !Array.isArray(req.body.detail)) {
      // Checklist rater (HR Rating Sheet): per-criterion picks, score = average
      const values = Object.values(req.body.detail).map(Number);
      if (!values.length || values.some((v) => Number.isNaN(v) || v < 0 || v > 10)) {
        return res.status(400).json({ error: 'Every checklist item needs a rating between 0 and 10' });
      }
      record.detail = req.body.detail;
      record.overall_score = Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100;
    } else {
      // Internal Audit (or paper encoding) enters one overall score directly
      const value = Number(req.body?.score);
      if (req.body?.score === undefined || req.body?.score === null || req.body?.score === '' || Number.isNaN(value) || value < 0 || value > 10) {
        return res.status(400).json({ error: 'Enter an overall score between 0 and 10' });
      }
      record.overall_score = value;
    }

    const rows = must(
      await db.from('appraisals').upsert(record, { onConflict: 'user_id,period_id,rater_type' }).select()
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
    if (!(await requireViewer(req, res, userId))) return;

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
    // Only submitted ratings from current rater types count toward the final
    if (a.status !== 'submitted' || !RATER_TYPES.includes(a.rater_type)) continue;
    if (a.rater_type === 'supervisor') {
      raterScores[a.rater_type] = await scoreForUser(user, periodId, factors, settings, a.rater_type);
    } else if (a.overall_score !== null && a.overall_score !== undefined) {
      // Page 3 direct score (self/hr/peer/audit)
      raterScores[a.rater_type] = { overall: Number(a.overall_score) };
    }
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
    if (!(await requireViewer(req, res, userId))) return;

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

// ---------- Detailed report (print / export) ----------
// Full scoring detail for the given users: Part I tasks with the supervisor's
// ratings, Part II factor ratings, per-rater totals and final. Shared by the
// admin report (all/selected employees) and the employee's own report.
async function buildDetailReport(users, periodId) {
  const periods = must(await db.from('periods').select('*').eq('id', periodId).limit(1));
  if (!periods[0]) {
    const err = new Error('Period not found');
    err.status = 404;
    throw err;
  }
  const factors = must(await db.from('factors').select('*').eq('active', true).order('section').order('sort_order'));
  const settings = await loadSettings();
  const appraisals = must(await db.from('appraisals').select('*').eq('period_id', periodId));
  const assignments = must(await db.from('rater_assignments').select('*').eq('rater_type', 'supervisor'));
  const supervisorIds = [...new Set(assignments.map((a) => a.rater_user_id))];
  const supervisors = supervisorIds.length
    ? must(await db.from('users').select('id, full_name, position').in('id', supervisorIds))
    : [];
  const supervisorById = new Map(supervisors.map((u) => [u.id, u]));

  const rows = [];
  for (const user of users) {
    const tasks = must(
      await db.from('tasks').select('*, task_ratings(*)').eq('user_id', user.id).eq('period_id', periodId).order('sort_order')
    ).map(normalizeTask('supervisor'));
    const factorRatings = must(
      await db.from('factor_ratings').select('*').eq('user_id', user.id).eq('period_id', periodId).eq('rater_type', 'supervisor')
    );
    const score = computeScores({ tasks, factors, factorRatings, settings, isSupervisor: user.is_supervisor });
    const userAppraisals = appraisals.filter((a) => a.user_id === user.id);
    const final = await finalForUser(user, periodId, factors, settings, userAppraisals);
    const supAssignment = assignments.find((a) => a.ratee_id === user.id);
    const supAppraisal = userAppraisals.find((a) => a.rater_type === 'supervisor');
    rows.push({
      user: {
        id: user.id,
        full_name: user.full_name,
        position: user.position,
        department: user.department,
        is_supervisor: user.is_supervisor
      },
      tasks,
      factorRatings,
      score,
      final,
      supervisor: supAssignment ? supervisorById.get(supAssignment.rater_user_id) || null : null,
      rated_at: supAppraisal?.submitted_at || null
    });
  }
  return { period: periods[0], factors, settings, rows };
}

// Admin: all or selected employees
router.get('/reports/detail', adminOnly, async (req, res, next) => {
  try {
    const { periodId, userIds } = req.query;
    if (!periodId) return res.status(400).json({ error: 'periodId is required' });
    const wanted = userIds ? String(userIds).split(',').filter(Boolean) : null;
    let q = db.from('users').select('*').eq('role', 'employee').order('full_name');
    if (wanted) q = q.in('id', wanted);
    const users = must(await q);
    res.json(await buildDetailReport(users, periodId));
  } catch (e) {
    next(e);
  }
});

// Employee: their own report only
router.get('/reports/my-detail', async (req, res, next) => {
  try {
    const { periodId } = req.query;
    if (!periodId) return res.status(400).json({ error: 'periodId is required' });
    const users = must(await db.from('users').select('*').eq('id', req.user.id).limit(1));
    if (!users[0]) return res.status(404).json({ error: 'User not found' });
    res.json(await buildDetailReport(users, periodId));
  } catch (e) {
    next(e);
  }
});

export default router;
