import { Router } from 'express';
import { db, must } from '../supabase.js';
import { auth, adminOnly } from '../middleware/auth.js';
import { DEFAULT_SETTINGS } from '../scoring.js';

const router = Router();
router.use(auth);

// ---------- Periods ----------
const COVERAGES = ['monthly', 'quarterly', 'semi_annual', 'annual'];

router.get('/periods', async (req, res, next) => {
  try {
    const periods = must(await db.from('periods').select('*').order('start_date', { ascending: false }));
    res.json({ periods });
  } catch (e) {
    next(e);
  }
});

router.post('/periods', adminOnly, async (req, res, next) => {
  try {
    const { name, start_date, end_date, coverage, is_active } = req.body || {};
    if (!name) return res.status(400).json({ error: 'Period name is required' });
    if (coverage && !COVERAGES.includes(coverage)) return res.status(400).json({ error: 'Invalid coverage' });
    if (is_active) must(await db.from('periods').update({ is_active: false }).eq('is_active', true).select());
    const rows = must(
      await db
        .from('periods')
        .insert({ name, start_date, end_date, coverage: coverage || 'semi_annual', is_active: !!is_active })
        .select()
    );
    res.json({ period: rows[0] });
  } catch (e) {
    next(e);
  }
});

router.put('/periods/:id', adminOnly, async (req, res, next) => {
  try {
    const { name, start_date, end_date, coverage, is_active } = req.body || {};
    if (coverage && !COVERAGES.includes(coverage)) return res.status(400).json({ error: 'Invalid coverage' });
    const patch = { name, start_date, end_date, is_active: !!is_active };
    if (coverage) patch.coverage = coverage;
    if (is_active) must(await db.from('periods').update({ is_active: false }).eq('is_active', true).select());
    const rows = must(await db.from('periods').update(patch).eq('id', req.params.id).select());
    res.json({ period: rows[0] });
  } catch (e) {
    next(e);
  }
});

router.delete('/periods/:id', adminOnly, async (req, res, next) => {
  try {
    must(await db.from('periods').delete().eq('id', req.params.id).select());
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// ---------- Critical factors (Part II) ----------
router.get('/factors', async (req, res, next) => {
  try {
    const factors = must(await db.from('factors').select('*').order('section').order('sort_order'));
    res.json({ factors });
  } catch (e) {
    next(e);
  }
});

router.post('/factors', adminOnly, async (req, res, next) => {
  try {
    const { section, label, supervisor_only, sort_order } = req.body || {};
    if (!section || !label) return res.status(400).json({ error: 'Section and label are required' });
    const rows = must(
      await db.from('factors').insert({ section, label, supervisor_only: !!supervisor_only, sort_order: sort_order ?? 0 }).select()
    );
    res.json({ factor: rows[0] });
  } catch (e) {
    next(e);
  }
});

router.put('/factors/:id', adminOnly, async (req, res, next) => {
  try {
    const { section, label, supervisor_only, sort_order, active } = req.body || {};
    const patch = {};
    if (section !== undefined) patch.section = section;
    if (label !== undefined) patch.label = label;
    if (supervisor_only !== undefined) patch.supervisor_only = !!supervisor_only;
    if (sort_order !== undefined) patch.sort_order = sort_order;
    if (active !== undefined) patch.active = !!active;
    const rows = must(await db.from('factors').update(patch).eq('id', req.params.id).select());
    res.json({ factor: rows[0] });
  } catch (e) {
    next(e);
  }
});

router.delete('/factors/:id', adminOnly, async (req, res, next) => {
  try {
    must(await db.from('factors').delete().eq('id', req.params.id).select());
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// ---------- Formula settings ----------
export async function loadSettings() {
  const rows = must(await db.from('settings').select('*'));
  const merged = { ...DEFAULT_SETTINGS };
  for (const row of rows) merged[row.key] = row.value;
  return merged;
}

router.get('/settings', async (req, res, next) => {
  try {
    res.json({ settings: await loadSettings() });
  } catch (e) {
    next(e);
  }
});

router.put('/settings', adminOnly, async (req, res, next) => {
  try {
    const allowed = ['part1_weight', 'part2_weight', 'rating_scale', 'bands', 'rater_weights', 'score_delay_days'];
    const entries = Object.entries(req.body || {}).filter(([k]) => allowed.includes(k));
    if (!entries.length) return res.status(400).json({ error: 'Nothing to update' });
    for (const [key, value] of entries) {
      must(await db.from('settings').upsert({ key, value }, { onConflict: 'key' }).select());
    }
    res.json({ settings: await loadSettings() });
  } catch (e) {
    next(e);
  }
});

export default router;
