import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { coverageLabel } from '../coverage.js';
import { useAuth } from '../auth.jsx';
import { bandColor } from '../scoring.js';
import Avatar from '../components/Avatar.jsx';
import ScoreRing from '../components/ScoreRing.jsx';

export default function Dashboard() {
  const { user } = useAuth();
  const [period, setPeriod] = useState(null);
  const [score, setScore] = useState(null);
  const [appraisal, setAppraisal] = useState(null);
  const [finalScore, setFinalScore] = useState(null);
  const [ratees, setRatees] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const { periods } = await api('/periods');
        const active = periods.find((p) => p.is_active) || periods[0];
        if (!active) return setError('No appraisal period has been set up yet. Please contact the admin.');
        setPeriod(active);
        const data = await api(`/score?periodId=${active.id}`);
        setScore(data.score);
        setAppraisal(data.appraisal);
        const [{ final }, { ratees: mine }] = await Promise.all([
          api(`/final-score?periodId=${active.id}`),
          api(`/my-ratees?periodId=${active.id}`)
        ]);
        setFinalScore(final);
        setRatees(mine);
      } catch (e) {
        setError(e.message);
      }
    })();
  }, []);

  if (error) return <div className="alert alert-error">{error}</div>;
  if (!score) return <div className="center-page">Loading…</div>;

  const { progress } = score;
  const total = progress.tasksTotal + progress.factorsTotal;
  const done = progress.tasksRated + progress.factorsRated;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const submitted = appraisal?.status === 'submitted';

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Hello, {user.full_name.split(' ')[0]}! 👋</h1>
          <p className="muted">
            Appraisal period: {period.name} ({coverageLabel(period.coverage)})
          </p>
        </div>
        <span className={`badge ${submitted ? 'badge-green' : 'badge-amber'}`}>{submitted ? 'Submitted ✓' : 'Draft'}</span>
      </div>

      <div className="grid-2">
        <div className="card card-center">
          <h3>My Self-Rating Score</h3>
          <ScoreRing score={score.overall} band={score.band} />
          <p className="muted">
            {score.band.label} — Part I {score.was1.toFixed(2)} + Part II {score.was2.toFixed(2)}
          </p>
        </div>

        <div className="card">
          <h3>Progress</h3>
          <div className="progress-row">
            <span>Overall</span>
            <span>
              <strong>{pct}%</strong>
            </span>
          </div>
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: `${pct}%` }} />
          </div>
          <div className="progress-row">
            <span>Part I — Performance tasks</span>
            <span>
              {progress.tasksRated} / {progress.tasksTotal}
            </span>
          </div>
          <div className="progress-row">
            <span>Part II — Critical factors</span>
            <span>
              {progress.factorsRated} / {progress.factorsTotal}
            </span>
          </div>
          {progress.tasksTotal === 0 ? (
            <div className="alert alert-info">Your tasks have not been set up yet. Please contact the admin.</div>
          ) : (
            <Link to="/appraisal" className="btn btn-primary btn-block" style={{ marginTop: 16 }}>
              {submitted ? 'View my appraisal' : done === 0 ? 'Start my self-rating' : 'Continue my self-rating'}
            </Link>
          )}
        </div>
      </div>

      {ratees.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <h3>People I rate</h3>
          <table className="table">
            <thead>
              <tr>
                <th>Employee</th>
                <th>My role</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {ratees.map((r) => (
                <tr key={`${r.user.id}-${r.raterType}`}>
                  <td>
                    <div className="cell-user">
                      <Avatar user={r.user} size={32} />
                      <div>
                        <div>{r.user.full_name}</div>
                        <div className="muted small">{r.user.department}</div>
                      </div>
                    </div>
                  </td>
                  <td>{r.raterLabel}</td>
                  <td>
                    {r.status === 'submitted' ? (
                      <span className="badge badge-green">submitted</span>
                    ) : (
                      <span className="badge badge-amber">draft</span>
                    )}
                  </td>
                  <td className="cell-actions">
                    <Link to={`/rate/${r.raterType}/${r.user.id}`} state={{ ratee: r.user }} className="btn btn-small">
                      {r.status === 'submitted' ? 'View' : 'Rate'}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {finalScore && (
        <div className="card" style={{ marginTop: 16 }}>
          <h3>My Final Rating (all raters)</h3>
          <table className="table table-compact">
            <thead>
              <tr>
                <th>Rater</th>
                <th>Score</th>
                <th>Weight</th>
                <th>Weighted</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {finalScore.rows.map((row) => (
                <tr key={row.type}>
                  <td>{row.label}</td>
                  <td>{row.score ? row.score.overall.toFixed(2) : '—'}</td>
                  <td>{Math.round(row.weight * 100)}%</td>
                  <td>{row.weighted.toFixed(2)}</td>
                  <td>
                    {row.status === 'submitted' ? (
                      <span className="badge badge-green">submitted</span>
                    ) : (
                      <span className="badge badge-slate">pending</span>
                    )}
                  </td>
                </tr>
              ))}
              <tr>
                <td>
                  <strong>Final Numerical Performance Rating</strong>
                </td>
                <td></td>
                <td></td>
                <td>
                  <strong>{finalScore.final.toFixed(2)}</strong>
                </td>
                <td>
                  <span
                    className="badge"
                    style={{ background: `${bandColor(finalScore.band.code)}22`, color: bandColor(finalScore.band.code) }}
                  >
                    {finalScore.band.label}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
          <p className="muted small">Raters that have not submitted yet count as 0 — the final rating is complete once all five have submitted.</p>
        </div>
      )}
    </div>
  );
}
