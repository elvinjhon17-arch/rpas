// Remembers the admin's chosen appraisal period (date coverage) across pages
// so it does not reset every time they navigate.
const KEY = 'rpas_period';

export const getSavedPeriod = () => localStorage.getItem(KEY) || '';
export const setSavedPeriod = (id) => {
  if (id) localStorage.setItem(KEY, id);
};

// Pick the period to show: the saved one if it still exists, else the active
// period, else the first.
export function pickPeriod(periods = []) {
  const saved = getSavedPeriod();
  if (saved && periods.some((p) => p.id === saved)) return saved;
  return (periods.find((p) => p.is_active) || periods[0])?.id || '';
}
