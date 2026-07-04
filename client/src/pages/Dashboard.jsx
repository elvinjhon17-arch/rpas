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
  const [selfScore, setSelfScore] = useState('');
  const [error, setError] = useState('');

  const loadFinal = async (periodId) => {
    const [{ final }, { ratees: mine }] = await Promise.all([
      api(`/final-score?periodId=${periodId}`),
      api(`/my-ratees?periodId=${periodId}`)
    ]);
    setFinalScore(final);
    setRatees(mine);
  };

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
        await loadFinal(active.id);
      } catch (e) {
        setError(e.message);
      }
    })();
  }, []);

  // Page 3: submit my own single overall self score
  const submitSelf = async () => {
    if (!window.confirm(`Submit your self rate of ${selfScore}? You will not be able to change it afterwards.`)) return;
    try {
      await api('/appraisals/submit', { method: 'POST', body: { periodId: period.id, raterType: 'self', score: selfScore } });
      await loadFinal(period.id);
      setError('');
    } catch (e) {
      setError(e.message);
    }
  };

  // Page 3: HR/Peer/Audit rater enters one overall score for a ratee
  const ratePage3 = async (r) => {
    const value = window.prompt(`${r.raterLabel} for ${r.user.full_name} — enter the overall score (0-10):`);
    if (value === null || value === '') return;
    try {
      await api('/appraisals/submit', {
        method: 'POST',
        body: { periodId: period.id, raterType: r.raterType, userId: r.user.id, score: value }
      });
      await loadFinal(period.id);
      setError('');
    } catch (e) {
      setError(e.message);
    }
  };

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
          <h1>Hello, {user.full_name.split(' ')[0]}!</h1>
          <p className="muted">
            Appraisal period: {period.name} ({coverageLabel(period.coverage)})
          </p>
        </div>
        <span className={`badge ${submitted ? 'badge-green' : 'badge-amber'}`}>{submitted ? 'Submitted ✓' : 'Draft'}</span>
      </div>

      <div className="grid-2">
        <div className="card card-center">
          <h3>My Final Rating</h3>
          {finalScore ? (
            <>
              <ScoreRing score={finalScore.final} band={finalScore.band} />
              <p className="muted">{finalScore.band.label} — combined from all raters below</p>
            </>
          ) : (
            <p className="muted">Loading…</p>
          )}
        </div>

        <div className="card">
          <h3>My Self Rate (Page 3 —
            {finalScore ? ` ${Math.round((finalScore.rows.find((r) => r.type === 'self')?.weight ?? 0.1) * 100)}%` : ' 10%'})
          </h3>
          {(() => {
            const selfRow = finalScore?.rows.find((r) => r.type === 'self');
            if (selfRow?.status === 'submitted') {
              return (
                <div className="alert alert-success">
                  You rated yourself <strong>{selfRow.score ? selfRow.score.overall.toFixed(2) : '—'}</strong>. Ask the admin to
                  reopen it if you need a change.
                </div>
              );
            }
            return (
              <>
                <p className="muted small">
                  Your Part I and II are rated by your supervisor. You give yourself one overall score (0-10) here.
                </p>
                <label>
                  My overall self rate (0-10)
                  <input type="number" min="0" max="10" step="0.1" value={selfScore} onChange={(e) => setSelfScore(e.target.value)} />
                </label>
                <button className="btn btn-primary btn-block" style={{ marginTop: 8 }} disabled={selfScore === ''} onClick={submitSelf}>
                  Submit my self rate
                </button>
              </>
            );
          })()}
          {progress.tasksTotal > 0 && (
            <Link to="/appraisal" className="btn btn-block" style={{ marginTop: 12 }}>
              View my targets (Part I)
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
                    {r.raterType === 'supervisor' ? (
                      <Link to={`/rate/${r.raterType}/${r.user.id}`} state={{ ratee: r.user }} className="btn btn-small">
                        {r.status === 'submitted' ? 'View' : 'Rate (Pages 1-3)'}
                      </Link>
                    ) : r.status === 'submitted' ? (
                      <span className="muted small">done</span>
                    ) : (
                      <button className="btn btn-small" onClick={() => ratePage3(r)}>
                        Enter score
                      </button>
                    )}
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
