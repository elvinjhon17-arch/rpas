import { bandColor } from '../scoring.js';

// Circular gauge showing a 0-10 score with the adjectival band.
export default function ScoreRing({ score = 0, band, size = 140 }) {
  const r = (size - 14) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(1, score / 10));
  const color = band ? bandColor(band.code) : '#1d4ed8';

  return (
    <div className="score-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e2e8f0" strokeWidth="10" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: 'stroke-dashoffset .6s ease, stroke .3s ease' }}
        />
      </svg>
      <div className="score-ring-label">
        <strong>{score.toFixed(2)}</strong>
        {band && <span style={{ color }}>{band.code}</span>}
      </div>
    </div>
  );
}
