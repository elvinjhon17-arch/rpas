// Tap-to-rate chips: one tap sets the score, tap again to clear.
// Shows the adjectival meaning of the selected value so the numeric
// equivalent is always clear to the rater.
export const RATING_MEANINGS = {
  10: 'Outstanding',
  8: 'Very Satisfactory',
  6: 'Satisfactory',
  4: 'Unsatisfactory',
  2: 'Poor'
};

export default function RatingChips({ value, onChange, scale = [10, 8, 6, 4, 2], disabled, onBlocked }) {
  const current = value === null || value === undefined || value === '' ? null : Number(value);
  // When a reason handler is given, locked chips stay clickable so tapping
  // them pops the explanation instead of silently doing nothing.
  const explainWhenLocked = disabled && typeof onBlocked === 'function';
  return (
    <div>
      <div className="chips">
        {scale.map((v) => (
          <button
            key={v}
            type="button"
            disabled={disabled && !explainWhenLocked}
            aria-disabled={disabled || undefined}
            title={RATING_MEANINGS[v] ? `${v} — ${RATING_MEANINGS[v]}` : String(v)}
            className={`chip ${current === v ? 'chip-on' : ''} ${disabled ? 'chip-locked' : ''}`}
            onClick={() => (disabled ? onBlocked?.() : onChange(current === v ? null : v))}
          >
            {v}
          </button>
        ))}
      </div>
      <div className={`chip-meaning small ${current === null ? 'muted' : ''}`}>
        {current === null ? 'Tap a score' : `${current} = ${RATING_MEANINGS[current] || 'Custom score'}`}
      </div>
    </div>
  );
}
