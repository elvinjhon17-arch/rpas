import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { coverageLabel } from '../coverage.js';
import { pickPeriod, setSavedPeriod } from '../period.js';
import { useAuth } from '../auth.jsx';
import { bandColor } from '../scoring.js';
import Avatar from '../components/Avatar.jsx';
import ScoreRing from '../components/ScoreRing.jsx';
import { Skeleton, SkeletonCards } from '../components/Skeleton.jsx';

export default function Dashboard() {
  const { user } = useAuth();
  const [periods, setPeriods] = useState([]);
  const [periodId, setPeriodId] = useState('');
  const [score, setScore] = useState(null);
  const [appraisal, setAppraisal] = useState(null);
  const [finalScore, setFinalScore] = useState(null);
  const [ratees, setRatees] = useState([]);
  const [error, setError] = useState('');

  const period = periods.find((p) => p.id === periodId) || null;

  const loadFinal = async (pid) => {
    const [{ final }, { ratees: mine }] = await Promise.all([
      api(`/final-score?periodId=${pid}`),
      api(`/my-ratees?periodId=${pid}`)
    ]);
    setFinalScore(final);
    setRatees(mine);
  };

  // Load the list of periods once, then pick the remembered/active one
  useEffect(() => {
    api('/periods')
      .then(({ periods }) => {
        if (!periods.length) return setError('No appraisal period has been set up yet. Please contact the admin.');
        setPeriods(periods);
        setPeriodId(pickPeriod(periods));
      })
      .catch((e) => setError(e.message));
  }, []);

  // Reload everything whenever the selected period changes
  useEffect(() => {
    if (!periodId) return;
    setScore(null);
    setFinalScore(null);
    (async () => {
      try {
        const data = await api(`/score?periodId=${periodId}`);
        setScore(data.score);
        setAppraisal(data.appraisal);
        await loadFinal(periodId);
        setError('');
      } catch (e) {
        setError(e.message);
      }
    })();
  }, [periodId]);

  const changePeriod = (id) => {
    setSavedPeriod(id);
    setPeriodId(id);
  };

  // Page 3: HR / Internal Audit rater enters one overall score for a ratee
  const ratePage3 = async (r) => {
    const value = window.prompt(`${r.raterLabel} for ${r.user.full_name} — enter the overall score (0-10):`);
    if (value === null || value === '') return;
    try {
      await api('/appraisals/submit', {
        method: 'POST',
        body: { periodId, raterType: r.raterType, userId: r.user.id, score: value }
      });
      await loadFinal(periodId);
      setError('');
    } catch (e) {
      setError(e.message);
    }
  };

  if (error) return <div className="alert alert-error">{error}</div>;

  const progress = score?.progress;
  const total = progress ? progress.tasksTotal + progress.factorsTotal : 0;
  const done = progress ? progress.tasksRated + progress.factorsRated : 0;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const submitted = appraisal?.status === 'submitted';

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Hello, {user.full_name.split(' ')[0]}!</h1>
          <p className="muted">
            {period ? `${coverageLabel(period.coverage)} coverage` : 'Select an appraisal period'}
          </p>
        </div>
        <div className="page-head-right">
          <select value={periodId} onChange={(e) => changePeriod(e.target.value)}>
            {periods.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button
            className="btn"
            disabled={!periodId}
            onClick={() => window.open(`/my-report?periodId=${periodId}`, '_blank')}
          >
            Download PDF
          </button>
          {finalScore && finalScore.rows.every((r) => r.status === 'submitted') ? (
            <span className="badge badge-green">All ratings in ✓</span>
          ) : (
            <span className="badge badge-amber">Ratings in progress</span>
          )}
        </div>
      </div>

      {!score ? (
        <SkeletonCards count={2} />
      ) : (
        <>

      <div className="grid-2">
        <div className="card card-center">
          <h3>My Final Rating</h3>
          {finalScore ? (
            <>
              <ScoreRing score={finalScore.final} band={finalScore.band} />
              <p className="muted">{finalScore.band.label} — combined from all raters below</p>
            </>
          ) : (
            <>
              <Skeleton w={120} h={120} r={999} style={{ margin: '8px auto' }} />
              <Skeleton w="60%" h={12} style={{ margin: '4px auto' }} />
            </>
          )}
        </div>

        <div className="card">
          <h3>How I am rated</h3>
          <p className="muted small">
            Your Part I and II are rated by your assigned Supervisor (50%). HR (20%) and Internal Audit (30%) each add one
            overall score. The combined result is your final rating.
          </p>
          {progress.tasksTotal > 0 ? (
            <Link to="/appraisal" className="btn btn-block" style={{ marginTop: 12 }}>
              View my supervisor's rating
            </Link>
          ) : (
            <div className="alert alert-info">Your tasks have not been set up yet. Please contact the admin.</div>
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
          <p className="muted small">Raters that have not submitted yet count as 0 — the final rating is complete once all three have submitted.</p>
        </div>
      )}
        </>
      )}
    </div>
  );
}
