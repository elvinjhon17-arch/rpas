// RPAS scoring engine - mirrors the Excel form formulas:
//   APS  = average(QN, QL, T)            per task
//   EPS  = APS x task weight             per task
//   TEPS = sum of all EPS
//   WAS1 = TEPS x Part I weight (70%)
//   APS2 = sum(factor ratings) / number of applicable factors (15, or 18 for supervisors)
//   WAS2 = APS2 x Part II weight (30%)
//   Per-rater overall = WAS1 + WAS2
//   Final (Page 3 new) = sum over raters of (overall x rater weight) -> adjectival band

// Raters that make up the final rating. 'self' remains a valid view type for
// the employee's read-only targets page but no longer counts toward the final.
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
  // Days an employee must wait after their supervisor submits before their
  // score becomes visible to them (0 = immediately).
  score_delay_days: 0,
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

export function taskScore(task) {
  const r = task.rating || {};
  const qn = num(r.rate_qn);
  const ql = num(r.rate_ql);
  const t = num(r.rate_t);
  const rated = [qn, ql, t].filter((v) => v !== null);
  const complete = rated.length === 3;
  const aps = rated.length ? rated.reduce((a, b) => a + b, 0) / 3 : 0;
  const eps = aps * Number(task.weight || 0);
  return { qn, ql, t, aps, eps, complete };
}

export function computeScores({ tasks = [], factors = [], factorRatings = [], settings = {}, isSupervisor = false }) {
  const cfg = { ...DEFAULT_SETTINGS, ...settings };

  // Part I
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

  // Part II
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
    progress: {
      tasksRated: ratedTasks,
      tasksTotal: tasks.length,
      factorsRated: ratedFactors,
      factorsTotal: applicable.length
    }
  };
}

// Page 3 (new): combine the per-rater scores into the final rating.
// raterScores = { self: <computeScores result>, supervisor: ..., ... } (missing raters count as 0)
export function computeFinal(raterScores, settings = {}) {
  const cfg = { ...DEFAULT_SETTINGS, ...settings };
  const weights = { ...DEFAULT_SETTINGS.rater_weights, ...(cfg.rater_weights || {}) };

  const rows = RATER_TYPES.map((type) => {
    const score = raterScores[type] || null;
    const overall = score ? score.overall : 0;
    const weight = Number(weights[type] || 0);
    return { type, label: RATER_LABELS[type], score, weight, weighted: round2(overall * weight) };
  });

  const final = round2(rows.reduce((sum, r) => sum + r.weighted, 0));
  const band = cfg.bands.find((b) => final >= b.min) || cfg.bands[cfg.bands.length - 1];
  return { rows, final, band };
}

const round2 = (v) => Math.round(v * 100) / 100;
