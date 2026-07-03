// Appraisal period coverage - RBLI normally appraises semi-annually
export const COVERAGE_OPTIONS = [
  { value: 'semi_annual', label: 'Semi-annual', months: 6 },
  { value: 'monthly', label: 'Monthly', months: 1 },
  { value: 'quarterly', label: 'Quarterly', months: 3 },
  { value: 'annual', label: 'Annual', months: 12 }
];

export const coverageLabel = (value) =>
  COVERAGE_OPTIONS.find((o) => o.value === value)?.label || 'Semi-annual';

// Last day of the month `months - 1` after the start date, e.g.
// 2026-07-01 + semi_annual -> 2026-12-31
export function coverageEndDate(startDate, coverage) {
  const months = COVERAGE_OPTIONS.find((o) => o.value === coverage)?.months || 6;
  const [y, m] = startDate.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + months, 0)).toISOString().slice(0, 10);
}

// "July - December 2026", or "July 2026 - June 2027" across years
export function coverageName(startDate, endDate) {
  const month = (d) => d.toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });
  const s = new Date(`${startDate}T00:00:00Z`);
  const e = new Date(`${endDate}T00:00:00Z`);
  if (s.getUTCFullYear() === e.getUTCFullYear()) return `${month(s)} - ${month(e)} ${s.getUTCFullYear()}`;
  return `${month(s)} ${s.getUTCFullYear()} - ${month(e)} ${e.getUTCFullYear()}`;
}
