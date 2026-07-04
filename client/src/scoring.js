// Client-side mirror of the server scoring engine (server/src/scoring.js).
// Used for live score preview while the employee fills the form;
// the server recomputes everything on submit.

// Raters that make up the final rating ('self' is only the employee's
// read-only view of their own targets, not a rater).
export const RATER_TYPES = ['supervisor', 'hr', 'audit'];

export const RATER_LABELS = {
  supervisor: 'Supervisor Rate',
  hr: 'HR Rate',
  audit: 'Internal Audit Rate',
  self: 'Self Rate'
};

export const DEFAULT_SETTINGS = {
  part1_weight: 0.7,
  part2_weight: 0.3,
  rating_scale: [10, 8, 6, 4, 2],
  // Page 3 rater weights
  rater_weights: { supervisor: 0.5, hr: 0.2, audit: 0.3 },
  bands: [
    { min: 9.5, code: 'O', label: 'Outstanding' },
    { min: 7.51, code: 'VS', label: 'Very Satisfactory' },
    { min: 4.01, code: 'S', label: 'Satisfactory' },
    { min: 2.01, code: 'US', label: 'Unsatisfactory' },
    { min: 0, code: 'P', label: 'Poor' }
  ]
};

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const round2 = (v) => Math.round(v * 100) / 100;

export function taskScore(task) {
  const r = task.rating || {};
  const qn = num(r.rate_qn);
  const ql = num(r.rate_ql);
  const t = num(r.rate_t);
  const rated = [qn, ql, t].filter((v) => v !== null);
  const complete = rated.length === 3;
  const aps = rated.length ? rated.reduce((a, b) => a + b, 0) / 3 : 0;
  const eps = aps * Number(task.weight || 0);
  return { qn, ql, t, aps: round2(aps), eps: round2(eps), complete };
}

export function computeScores({ tasks = [], factors = [], factorRatings = [], settings = {}, isSupervisor = false }) {
  const cfg = { ...DEFAULT_SETTINGS, ...settings };

  let teps = 0;
  let ratedTasks = 0;
  let totalWeight = 0;
  for (const task of tasks) {
    const s = taskScore(task);
    teps += s.eps;
    totalWeight += Number(task.weight || 0);
    if (s.complete) ratedTasks += 1;
  }
  const was1 = teps * cfg.part1_weight;

  const applicable = factors.filter((f) => f.active !== false && (isSupervisor || !f.supervisor_only));
  const ratingByFactor = new Map(factorRatings.map((r) => [r.factor_id, num(r.rating)]));
  let factorSum = 0;
  let ratedFactors = 0;
  for (const f of applicable) {
    const v = ratingByFactor.get(f.id);
    if (v !== null && v !== undefined) {
      factorSum += v;
      ratedFactors += 1;
    }
  }
  const divisor = applicable.length || 1;
  const aps2 = factorSum / divisor;
  const was2 = aps2 * cfg.part2_weight;

  const overall = was1 + was2;
  const band = cfg.bands.find((b) => overall >= b.min) || cfg.bands[cfg.bands.length - 1];

  return {
    teps: round2(teps),
    was1: round2(was1),
    aps2: round2(aps2),
    was2: round2(was2),
    overall: round2(overall),
    band,
    totalWeight: round2(totalWeight),
    progress: { tasksRated: ratedTasks, tasksTotal: tasks.length, factorsRated: ratedFactors, factorsTotal: applicable.length }
  };
}

export const bandColor = (code) =>
  ({ O: '#16a34a', VS: '#1d4ed8', S: '#d97706', US: '#dc2626', P: '#991b1b' })[code] || '#64748b';
