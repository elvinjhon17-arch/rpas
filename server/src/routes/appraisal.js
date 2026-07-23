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

// Quality accomplished is never typed - always derived from the quantity:
// numeric target -> accomplished / target as a percentage; ATC-style
// (non-numeric) target -> 100% once anything is accomplished; empty -> blank.
// A zero quantity (0 accomplished, or a 0 target) means there was nothing
// to get wrong, so quality still counts as 100%.
// Quantities may be typed with thousands separators or other symbols
// ("1,500", "P1,500.00", "12 docs") on either side - keep only the digits
// before parsing so the ratio still computes when the formats differ.
const parseQty = (v) => parseFloat(String(v ?? '').replace(/[^0-9.-]/g, ''));

// direction 'higher' (default, more is better) or 'lower' (less is better).
// Higher: quality = accomplished / target, so achieving nothing (0) is 0%.
// Lower: at or below the target is perfect (100%); exceeding it scales down
// by target / accomplished, so 0 bad things is 100%.
function computedQualityAccomp(qtyAccomp, qtyTarget, direction = 'higher') {
  const accomp = String(qtyAccomp ?? '').trim();
  if (!accomp) return '';
  const a = parseQty(accomp);
  const t = parseQty(qtyTarget);
  if (Number.isNaN(a)) return Number.isNaN(t) ? '100%' : '';
  if (Number.isNaN(t)) return '100%'; // ATC-style target: any accomplishment counts as met
  const pct = (ratio) => `${Math.round(ratio * 1000) / 10}%`;
  if (direction === 'lower') {
    if (a <= t) return '100%';
    return pct(t / a); // over the ceiling: a > t >= 0, so a > 0
  }
  if (t === 0) return '100%'; // nothing was required
  if (a === 0) return '0%'; // achieved nothing
  return pct(a / t);
}

const DIRECTIONS = ['higher', 'lower'];

async function getAppraisal(userId, periodId, raterType) {
  const rows = must(
    await db.from('appraisals').select('*').eq('user_id', userId).eq('period_id', periodId).eq('rater_type', raterType).limit(1)
  );
  return rows[0] || null;
}

// Who may enter ratings: when raters are assigned for the slot, ONLY those
// people may rate it (not even the admin - they can reopen or reassign
// instead). When the slot is unassigned, only the admin may encode a score
// (e.g. transcribing a paper form). The supervisor slot may hold several
// people, each optionally scoped to specific tasks.
async function slotAssignments(rateeId, raterType) {
  return must(
    await db
      .from('rater_assignments')
      .select('id, rater_user_id, task_ids, rates_part2')
      .eq('ratee_id', rateeId)
      .eq('rater_type', raterType)
  );
}

async function canRate(req, rateeId, raterType) {
  const rows = await slotAssignments(rateeId, raterType);
  if (rows.length) return rows.some((r) => r.rater_user_id === req.user.id);
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

// An employee may see their own scores only after their supervisor has
// submitted, plus the admin-set delay (settings.score_delay_days). Applies
// only when the requester is viewing their OWN appraisal. Returns
// { locked, availableOn } - availableOn is null while the supervisor has not
// submitted yet (so we cannot compute a date).
async function scoreLockInfo(req, rateeId, periodId) {
  if (req.user.id !== rateeId || req.user.role === 'admin') return { locked: false, availableOn: null };
  const settings = await loadSettings();
  const delay = Number(settings.score_delay_days || 0);
  if (!(delay > 0)) return { locked: false, availableOn: null };
  const sup = must(
    await db
      .from('appraisals')
      .select('status, submitted_at')
      .eq('user_id', rateeId)
      .eq('period_id', periodId)
      .eq('rater_type', 'supervisor')
      .limit(1)
  )[0];
  if (!sup || sup.status !== 'submitted' || !sup.submitted_at) return { locked: true, availableOn: null };
  const availableOn = new Date(new Date(sup.submitted_at).getTime() + delay * 86400000);
  if (Date.now() < availableOn.getTime()) return { locked: true, availableOn: availableOn.toISOString() };
  return { locked: false, availableOn: null };
}

// Only accounts flagged is_approver may approve/release tasks - this is
// deliberately separate from the admin who creates them (an admin can approve
// only if their own account is also flagged as an approver).
async function isApprover(req) {
  const u = must(await db.from('users').select('is_approver').eq('id', req.user.id).limit(1))[0];
  return !!u?.is_approver;
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

    // Only approved tasks are active - non-admins never see pending tasks
    let query = db.from('tasks').select('*, task_ratings(*)').eq('user_id', userId).eq('period_id', periodId).order('sort_order');
    if (req.user.role !== 'admin') query = query.eq('approved', true);
    const tasks = must(await query);

    let hiddenPending = 0;
    if (req.user.role !== 'admin') {
      hiddenPending = must(
        await db.from('tasks').select('id').eq('user_id', userId).eq('period_id', periodId).eq('approved', false)
      ).length;
    }

    // Tell a scoped supervisor which tasks are theirs (null = all)
    let myTaskScope = null;
    let ratesPart2 = true; // admin encoding / unassigned slot may fill Part II
    if (raterType === 'supervisor' && req.user.role !== 'admin') {
      const supers = await slotAssignments(userId, 'supervisor');
      const mine = supers.find((a) => a.rater_user_id === req.user.id);
      if (mine && Array.isArray(mine.task_ids) && mine.task_ids.length) myTaskScope = mine.task_ids;
      // Part II belongs to exactly one designated supervisor
      if (supers.length > 0) ratesPart2 = !!mine?.rates_part2;
    }

    // Hide the rating scores from the employee until the release delay passes
    const lock = await scoreLockInfo(req, userId, periodId);
    let outTasks = tasks.map(normalizeTask(raterType));
    if (lock.locked) outTasks = outTasks.map((t) => ({ ...t, rating: null }));

    res.json({
      tasks: outTasks,
      appraisal: await getAppraisal(userId, periodId, raterType),
      myTaskScope,
      ratesPart2,
      hiddenPending,
      scoreLocked: lock.locked,
      availableOn: lock.availableOn
    });
  } catch (e) {
    next(e);
  }
});

router.post('/tasks', adminOnly, async (req, res, next) => {
  try {
    const { user_id, period_id, category, code, name, unit, qty_target, quality_target, time_target, weight, sort_order, direction } =
      req.body || {};
    if (!user_id || !period_id || !name) return res.status(400).json({ error: 'Employee, period and task name are required' });
    if (direction !== undefined && !DIRECTIONS.includes(direction)) return res.status(400).json({ error: 'Invalid direction' });
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
          sort_order: sort_order ?? 0,
          direction: direction || 'higher',
          approved: false // must be approved before it becomes active
        })
        .select()
    );
    res.json({ task: normalizeTask('self')(rows[0]) });
  } catch (e) {
    next(e);
  }
});

// Reorder tasks: body { ids: [taskId, ...] } in the desired order
router.put('/tasks/reorder', adminOnly, async (req, res, next) => {
  try {
    const { ids } = req.body || {};
    if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'ids array is required' });
    for (let i = 0; i < ids.length; i++) {
      must(await db.from('tasks').update({ sort_order: i }).eq('id', ids[i]).select());
    }
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// Delete several tasks at once: body { ids: [taskId, ...] }
router.post('/tasks/bulk-delete', adminOnly, async (req, res, next) => {
  try {
    const { ids } = req.body || {};
    if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'ids array is required' });
    const rows = must(await db.from('tasks').delete().in('id', ids).select());
    res.json({ deleted: rows.length });
  } catch (e) {
    next(e);
  }
});

// ---------- Task approval (admin or any is_approver account) ----------
router.get('/tasks/pending', async (req, res, next) => {
  try {
    if (!(await isApprover(req))) return res.status(403).json({ error: 'You are not an approver' });
    const tasks = must(await db.from('tasks').select('*').eq('approved', false).order('user_id').order('sort_order'));
    if (!tasks.length) return res.json({ tasks: [] });
    const userIds = [...new Set(tasks.map((t) => t.user_id))];
    const periodIds = [...new Set(tasks.map((t) => t.period_id))];
    const users = must(await db.from('users').select('id, full_name, department').in('id', userIds));
    const periods = must(await db.from('periods').select('id, name').in('id', periodIds));
    const uById = new Map(users.map((u) => [u.id, u]));
    const pById = new Map(periods.map((p) => [p.id, p]));
    res.json({
      tasks: tasks.map((t) => ({
        ...t,
        employee: uById.get(t.user_id) || null,
        period: pById.get(t.period_id)?.name || ''
      }))
    });
  } catch (e) {
    next(e);
  }
});

router.post('/tasks/approve', async (req, res, next) => {
  try {
    if (!(await isApprover(req))) return res.status(403).json({ error: 'You are not an approver' });
    const { ids } = req.body || {};
    if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'ids array is required' });
    const rows = must(
      await db
        .from('tasks')
        .update({ approved: true, approved_by: req.user.id, approved_at: new Date().toISOString() })
        .in('id', ids)
        .select()
    );
    res.json({ approved: rows.length });
  } catch (e) {
    next(e);
  }
});

router.put('/tasks/:id', adminOnly, async (req, res, next) => {
  try {
    const allowed = ['category', 'code', 'name', 'unit', 'qty_target', 'quality_target', 'time_target', 'weight', 'sort_order', 'direction'];
    const patch = Object.fromEntries(Object.entries(req.body || {}).filter(([k]) => allowed.includes(k)));
    if (patch.direction !== undefined && !DIRECTIONS.includes(patch.direction)) {
      return res.status(400).json({ error: 'Invalid direction' });
    }

    // Changing the quantity target or the direction changes the ratio, so
    // recompute the employee's quality percentage from their existing
    // accomplishment - they should not have to re-enter the quantity.
    if (patch.qty_target !== undefined || patch.direction !== undefined) {
      const current = must(await db.from('tasks').select('qty_accomp, qty_target, direction').eq('id', req.params.id).limit(1));
      if (!current[0]) return res.status(404).json({ error: 'Task not found' });
      const target = patch.qty_target !== undefined ? patch.qty_target : current[0].qty_target;
      const direction = patch.direction !== undefined ? patch.direction : current[0].direction;
      patch.quality_accomp = computedQualityAccomp(current[0].qty_accomp, target, direction);
    }

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
    // Copied tasks start pending approval, without ratings/accomplishments
    const clones = source.map(({ id, user_id, period_id, approved, approved_by, approved_at, ...t }) => ({
      ...t,
      user_id: toUserId,
      period_id: toPeriodId,
      approved: false,
      approved_by: null,
      approved_at: null
    }));
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

    const allowed = ['qty_accomp', 'time_status'];
    const patch = Object.fromEntries(Object.entries(req.body || {}).filter(([k]) => allowed.includes(k)));
    if (patch.time_status !== undefined && !['', 'COMPLETE', 'DELAYED', 'NOT DONE'].includes(patch.time_status)) {
      return res.status(400).json({ error: 'Invalid time status' });
    }
    if (!Object.keys(patch).length) return res.status(400).json({ error: 'Nothing to update' });

    // Quality is not editable: always derived from the quantity and direction
    if (patch.qty_accomp !== undefined) {
      patch.quality_accomp = computedQualityAccomp(patch.qty_accomp, task.qty_target, task.direction);
    }
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

    // A supervisor scoped to specific tasks may only rate those tasks
    if (raterType === 'supervisor') {
      const mine = (await slotAssignments(task.user_id, 'supervisor')).find((a) => a.rater_user_id === req.user.id);
      if (mine && Array.isArray(mine.task_ids) && mine.task_ids.length && !mine.task_ids.includes(task.id)) {
        return res.status(403).json({ error: 'This task is assigned to another supervisor - you can only rate your own tasks' });
      }
      // No rating before the employee records what was accomplished
      if (!String(task.qty_accomp || '').trim() && !String(task.time_status || '').trim()) {
        return res.status(400).json({
          error: 'The employee has not entered their accomplishment for this task yet - it can be rated once they record it.'
        });
      }
    }

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
          { task_id: task.id, rater_type: raterType, rater_user_id: req.user.id, ...patch, updated_at: new Date().toISOString() },
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
    // Hide the factor ratings from the employee until results are released
    const lock = await scoreLockInfo(req, userId, periodId);
    if (lock.locked) return res.json({ ratings: [], scoreLocked: true, availableOn: lock.availableOn });
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

    // With multiple supervisors, exactly ONE (the designated one) rates Part II
    if (raterType === 'supervisor' && req.user.role !== 'admin') {
      const supers = await slotAssignments(userId, 'supervisor');
      const mine = supers.find((a) => a.rater_user_id === req.user.id);
      if (supers.length > 0 && !mine?.rates_part2) {
        return res.status(403).json({
          error: 'Part II critical factors are rated by the designated supervisor only. The admin can change who that is in Employees > Raters.'
        });
      }
    }

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

// Validates the account may hold the given rater slot; returns the user row or
// sends the error response and returns null.
async function checkRaterEligible(res, raterUserId, raterType) {
  const raters = must(await db.from('users').select('id, full_name, rater_privilege').eq('id', raterUserId).limit(1));
  if (!raters[0]) {
    res.status(404).json({ error: 'Rater account not found' });
    return null;
  }
  const privilege = raters[0].rater_privilege || 'none';
  if (raterType === 'supervisor' && privilege !== 'full') {
    res.status(400).json({
      error: `${raters[0].full_name} cannot be a Supervisor rater - set their rating privilege to "All pages (officer/head)" first`
    });
    return null;
  }
  if (raterType !== 'supervisor' && privilege === 'none') {
    res.status(400).json({ error: `${raters[0].full_name} has no rating privilege - set it to at least "Page 3 rater" first` });
    return null;
  }
  return raters[0];
}

// Single-person slots (HR / Internal Audit)
router.put('/assignments', adminOnly, async (req, res, next) => {
  try {
    const { rateeId, raterType, raterUserId } = req.body || {};
    if (!rateeId || !raterType) return res.status(400).json({ error: 'rateeId and raterType are required' });
    if (!RATER_TYPES.includes(raterType) || raterType === 'supervisor') {
      return res.status(400).json({ error: 'Invalid rater type - supervisors are managed via /assignments/supervisors' });
    }

    if (!raterUserId) {
      // Clearing the assignment
      must(await db.from('rater_assignments').delete().eq('ratee_id', rateeId).eq('rater_type', raterType).select());
      return res.json({ assignment: null });
    }
    if (raterUserId === rateeId) return res.status(400).json({ error: 'An employee cannot be their own ' + raterType + ' rater' });
    if (!(await checkRaterEligible(res, raterUserId, raterType))) return;

    // Replace whatever held the slot (uniqueness enforced here, not by the DB)
    must(await db.from('rater_assignments').delete().eq('ratee_id', rateeId).eq('rater_type', raterType).select());
    const rows = must(
      await db.from('rater_assignments').insert({ ratee_id: rateeId, rater_type: raterType, rater_user_id: raterUserId }).select()
    );
    res.json({ assignment: rows[0] });
  } catch (e) {
    next(e);
  }
});

// ---------- Supervisor assignments (multiple per employee, task-scoped) ----------
// Add a supervisor; taskIds null/empty = rates all tasks
router.post('/assignments/supervisors', adminOnly, async (req, res, next) => {
  try {
    const { rateeId, raterUserId, taskIds } = req.body || {};
    if (!rateeId || !raterUserId) return res.status(400).json({ error: 'rateeId and raterUserId are required' });
    if (raterUserId === rateeId) return res.status(400).json({ error: 'An employee cannot be their own supervisor rater' });
    if (!(await checkRaterEligible(res, raterUserId, 'supervisor'))) return;

    const existing = await slotAssignments(rateeId, 'supervisor');
    if (existing.some((a) => a.rater_user_id === raterUserId)) {
      return res.status(400).json({ error: 'Already assigned as a supervisor rater for this employee' });
    }

    // The first supervisor automatically becomes the Part II rater
    const rows = must(
      await db
        .from('rater_assignments')
        .insert({
          ratee_id: rateeId,
          rater_type: 'supervisor',
          rater_user_id: raterUserId,
          task_ids: Array.isArray(taskIds) && taskIds.length ? taskIds : null,
          rates_part2: existing.length === 0
        })
        .select()
    );
    res.json({ assignment: rows[0] });
  } catch (e) {
    next(e);
  }
});

// Update a supervisor's task scope
router.put('/assignments/supervisors/:id', adminOnly, async (req, res, next) => {
  try {
    const { taskIds } = req.body || {};
    const rows = must(
      await db
        .from('rater_assignments')
        .update({ task_ids: Array.isArray(taskIds) && taskIds.length ? taskIds : null })
        .eq('id', req.params.id)
        .eq('rater_type', 'supervisor')
        .select()
    );
    if (!rows[0]) return res.status(404).json({ error: 'Assignment not found' });
    res.json({ assignment: rows[0] });
  } catch (e) {
    next(e);
  }
});

// Designate which supervisor rates Part II (exactly one per employee)
router.put('/assignments/supervisors/:id/part2', adminOnly, async (req, res, next) => {
  try {
    const rows = must(await db.from('rater_assignments').select('*').eq('id', req.params.id).eq('rater_type', 'supervisor').limit(1));
    if (!rows[0]) return res.status(404).json({ error: 'Assignment not found' });
    must(
      await db
        .from('rater_assignments')
        .update({ rates_part2: false })
        .eq('ratee_id', rows[0].ratee_id)
        .eq('rater_type', 'supervisor')
        .select()
    );
    const updated = must(await db.from('rater_assignments').update({ rates_part2: true }).eq('id', req.params.id).select());
    res.json({ assignment: updated[0] });
  } catch (e) {
    next(e);
  }
});

// Remove a supervisor; if they were the Part II rater, promote another so the
// employee is never left without one
router.delete('/assignments/supervisors/:id', adminOnly, async (req, res, next) => {
  try {
    const removed = must(await db.from('rater_assignments').delete().eq('id', req.params.id).eq('rater_type', 'supervisor').select());
    if (removed[0]?.rates_part2) {
      const rest = await slotAssignments(removed[0].ratee_id, 'supervisor');
      if (rest.length && !rest.some((a) => a.rates_part2)) {
        must(await db.from('rater_assignments').update({ rates_part2: true }).eq('id', rest[0].id).select());
      }
    }
    res.json({ ok: true });
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

// ---------- Notifications: detailed progress for the side panel ----------
const hasAccompEntry = (t) => !!(String(t.qty_accomp || '').trim() || String(t.time_status || '').trim());
const ratingComplete = (r) => r && r.rate_qn !== null && r.rate_ql !== null && r.rate_t !== null;

router.get('/notifications', async (req, res, next) => {
  try {
    const { periodId } = req.query;
    if (!periodId) return res.status(400).json({ error: 'periodId is required' });
    const factors = must(await db.from('factors').select('*').eq('active', true));
    const applicableFactors = (isSup) => factors.filter((f) => isSup || !f.supervisor_only).length;

    // --- my own appraisal (as the ratee) ---
    let mine = null;
    if (req.user.role !== 'admin') {
      const myTasks = must(
        await db.from('tasks').select('*, task_ratings(*)').eq('user_id', req.user.id).eq('period_id', periodId).order('sort_order')
      );
      if (myTasks.length) {
        const me = must(await db.from('users').select('is_supervisor').eq('id', req.user.id).limit(1))[0] || {};
        const supRated = myTasks.filter((t) =>
          ratingComplete((t.task_ratings || []).find((r) => r.rater_type === 'supervisor'))
        ).length;
        const myFactorRatings = must(
          await db
            .from('factor_ratings')
            .select('rating')
            .eq('user_id', req.user.id)
            .eq('period_id', periodId)
            .eq('rater_type', 'supervisor')
            .not('rating', 'is', null)
        );
        const myAppraisals = must(await db.from('appraisals').select('*').eq('user_id', req.user.id).eq('period_id', periodId));
        mine = {
          tasksTotal: myTasks.length,
          accompDone: myTasks.filter(hasAccompEntry).length,
          supervisorRated: supRated,
          factorsRated: myFactorRatings.length,
          factorsTotal: applicableFactors(!!me.is_supervisor),
          raters: RATER_TYPES.map((type) => {
            const a = myAppraisals.find((x) => x.rater_type === type);
            return { type, label: RATER_LABELS[type], status: a?.status || 'pending', submitted_at: a?.submitted_at || null };
          })
        };
      }
    }

    // --- my ratees (as a rater) ---
    const assignments = must(await db.from('rater_assignments').select('*').eq('rater_user_id', req.user.id)).filter((a) =>
      RATER_TYPES.includes(a.rater_type)
    );
    const ratees = [];
    if (assignments.length) {
      const ids = [...new Set(assignments.map((a) => a.ratee_id))];
      const users = must(await db.from('users').select('id, full_name, department, is_supervisor').in('id', ids));
      const byId = new Map(users.map((u) => [u.id, u]));
      for (const a of assignments) {
        const ratee = byId.get(a.ratee_id);
        if (!ratee) continue;
        const appraisal = await getAppraisal(a.ratee_id, periodId, a.rater_type);
        const entry = {
          user: { id: ratee.id, full_name: ratee.full_name, department: ratee.department },
          raterType: a.rater_type,
          raterLabel: RATER_LABELS[a.rater_type],
          status: appraisal?.status || 'draft'
        };
        if (a.rater_type === 'supervisor') {
          const tTasks = must(
            await db.from('tasks').select('*, task_ratings(*)').eq('user_id', a.ratee_id).eq('period_id', periodId)
          );
          const scope =
            Array.isArray(a.task_ids) && a.task_ids.length ? tTasks.filter((t) => a.task_ids.includes(t.id)) : tTasks;
          entry.tasksTotal = tTasks.length;
          entry.myScope = scope.length;
          entry.accompDone = tTasks.filter(hasAccompEntry).length;
          entry.accompDoneInScope = scope.filter(hasAccompEntry).length;
          entry.myRated = scope.filter((t) =>
            ratingComplete((t.task_ratings || []).find((r) => r.rater_type === 'supervisor'))
          ).length;
          entry.ratesPart2 = !!a.rates_part2;
          if (a.rates_part2) {
            const fr = must(
              await db
                .from('factor_ratings')
                .select('rating')
                .eq('user_id', a.ratee_id)
                .eq('period_id', periodId)
                .eq('rater_type', 'supervisor')
                .not('rating', 'is', null)
            );
            entry.factorsRated = fr.length;
            entry.factorsTotal = applicableFactors(!!ratee.is_supervisor);
          }
        }
        ratees.push(entry);
      }
    }

    // Approver: how many tasks are waiting for approval
    let pendingApprovals = 0;
    if (await isApprover(req)) {
      pendingApprovals = must(await db.from('tasks').select('id').eq('approved', false)).length;
    }

    res.json({ mine, ratees, pendingApprovals });
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

    // The employee cannot see their combined score until the release delay
    const lock = await scoreLockInfo(req, userId, periodId);
    if (lock.locked) return res.json({ final: null, scoreLocked: true, availableOn: lock.availableOn });

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
    // All assigned supervisors (multi-supervisor: names joined for the report)
    const supNames = assignments
      .filter((a) => a.ratee_id === user.id)
      .map((a) => supervisorById.get(a.rater_user_id)?.full_name)
      .filter(Boolean);
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
      supervisor: supNames.length ? { full_name: supNames.join(' / ') } : null,
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
    const lock = await scoreLockInfo(req, req.user.id, periodId);
    if (lock.locked) {
      return res.status(403).json({
        error: lock.availableOn
          ? `Your results are not available yet. They will be ready on ${new Date(lock.availableOn).toLocaleDateString()}.`
          : 'Your results are not available yet - your supervisor has not submitted your rating.'
      });
    }
    const users = must(await db.from('users').select('*').eq('id', req.user.id).limit(1));
    if (!users[0]) return res.status(404).json({ error: 'User not found' });
    res.json(await buildDetailReport(users, periodId));
  } catch (e) {
    next(e);
  }
});

export default router;
