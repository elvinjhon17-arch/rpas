import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import ScoreRing from '../components/ScoreRing.jsx';

export default function Dashboard() {
  const { user } = useAuth();
  const [period, setPeriod] = useState(null);
  const [score, setScore] = useState(null);
  const [appraisal, setAppraisal] = useState(null);
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
          <p className="muted">Appraisal period: {period.name}</p>
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
    </div>
  );
}
