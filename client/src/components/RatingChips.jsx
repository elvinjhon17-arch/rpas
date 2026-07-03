// Tap-to-rate chips: one tap sets the score, tap again to clear.
export default function RatingChips({ value, onChange, scale = [10, 8, 6, 4, 2], disabled }) {
  const current = value === null || value === undefined || value === '' ? null : Number(value);
  return (
    <div className="chips">
      {scale.map((v) => (
        <button
          key={v}
          type="button"
          disabled={disabled}
          className={`chip ${current === v ? 'chip-on' : ''}`}
          onClick={() => onChange(current === v ? null : v)}
        >
          {v}
        </button>
      ))}
    </div>
  );
}
