import { useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useLocation, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { computeScores, taskScore, DEFAULT_SETTINGS, RATER_LABELS } from '../scoring.js';
import RatingChips from '../components/RatingChips.jsx';
import ScoreRing from '../components/ScoreRing.jsx';

const TIME_AUTO = { COMPLETE: 10, DELAYED: 4, 'NOT DONE': 2 };

// Renders the supervisor's rating form (/rate/supervisor/:userId) and the
// employee's read-only view of their own targets (/appraisal). Self/HR/Peer/
// Audit rate with a single Page 3 score on the Dashboard instead.
export default function Appraisal() {
  const { user } = useAuth();
  const params = useParams();
  const location = useLocation();
  const raterType = params.raterType || 'self';
  const rateeId = params.userId || user.id;
  const isSelf = raterType === 'self' && rateeId === user.id;
  // Only the supervisor fills this form for someone else
  const readOnly = isSelf;
  const [ratee, setRatee] = useState(location.state?.ratee || (isSelf ? user : null));
  const [step, setStep] = useState(1);
  const [periods, setPeriods] = useState([]);
  const [periodId, setPeriodId] = useState('');
  const [tasks, setTasks] = useState([]);
  const [factors, setFactors] = useState([]);
  const [factorRatings, setFactorRatings] = useState([]);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [appraisal, setAppraisal] = useState(null);
  const [comments, setComments] = useState('');
  const [error, setError] = useState('');
  const [saveState, setSaveState] = useState('');
  const [loading, setLoading] = useState(true);
  const saveTimer = useRef(null);

  useEffect(() => {
    api('/periods')
      .then(({ periods }) => {
        setPeriods(periods);
        const active = periods.find((p) => p.is_active) || periods[0];
        if (active) setPeriodId(active.id);
        else {
          setError('No appraisal period set up yet. Please contact the admin.');
          setLoading(false);
        }
      })
      .catch((e) => {
        setError(e.message);
        setLoading(false);
      });
  }, []);

  // In rater mode, resolve the ratee's name/details from the rater's list
  useEffect(() => {
    if (isSelf || ratee || !periodId) return;
    api(`/my-ratees?periodId=${periodId}`)
      .then(({ ratees }) => {
        const hit = ratees.find((r) => r.user.id === rateeId && r.raterType === raterType);
        if (hit) setRatee(hit.user);
      })
      .catch(() => {});
  }, [isSelf, ratee, periodId, rateeId, raterType]);

  useEffect(() => {
    if (!periodId) return;
    setLoading(true);
    const who = `periodId=${periodId}&userId=${rateeId}&raterType=${raterType}`;
    Promise.all([
      api(`/tasks?${who}`),
      api('/factors'),
      api(`/factor-ratings?${who}`),
      api('/settings')
    ])
      .then(([t, f, fr, s]) => {
        setTasks(t.tasks);
        setAppraisal(t.appraisal);
        setComments(t.appraisal?.comments || '');
        setFactors(f.factors);
        setFactorRatings(fr.ratings);
        setSettings(s.settings);
        setError('');
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [periodId, rateeId, raterType]);

  const locked = readOnly || appraisal?.status === 'submitted';
  const scale = settings.rating_scale || DEFAULT_SETTINGS.rating_scale;
  // The "supervisor only" factors depend on the RATEE's supervisor flag
  const rateeIsSupervisor = !!(ratee?.is_supervisor ?? (isSelf && user.is_supervisor));
  const myFactors = useMemo(
    () => factors.filter((f) => f.active !== false && (rateeIsSupervisor || !f.supervisor_only)),
    [factors, rateeIsSupervisor]
  );
  const score = useMemo(
    () => computeScores({ tasks, factors, factorRatings, settings, isSupervisor: rateeIsSupervisor }),
    [tasks, factors, factorRatings, settings, rateeIsSupervisor]
  );

  const flashSaved = () => {
    setSaveState('Saving…');
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => setSaveState('All changes saved ✓'), 500);
  };

  const saveTask = (task, patch) => {
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, rating: { ...(t.rating || {}), ...patch } } : t)));
    flashSaved();
    api(`/ratings/task/${task.id}`, { method: 'PUT', body: { ...patch, raterType } }).catch((e) => setError(e.message));
  };

  const saveFactor = (factorId, rating) => {
    setFactorRatings((prev) => {
      const rest = prev.filter((r) => r.factor_id !== factorId);
      return [...rest, { factor_id: factorId, rating }];
    });
    flashSaved();
    api('/factor-ratings', { method: 'PUT', body: { periodId, factorId, rating, userId: rateeId, raterType } }).catch((e) =>
      setError(e.message)
    );
  };

  const submit = async () => {
    const what = isSelf ? 'your self-rating' : `your ${RATER_LABELS[raterType]} for ${ratee?.full_name || 'this employee'}`;
    if (!window.confirm(`Submit ${what}? You will not be able to edit it afterwards.`)) return;
    try {
      const { appraisal: a } = await api('/appraisals/submit', {
        method: 'POST',
        body: { periodId, comments, userId: rateeId, raterType }
      });
      setAppraisal(a);
      setError('');
    } catch (e) {
      setError(e.message);
    }
  };

  if (!isSelf && raterType !== 'supervisor') return <Navigate to="/" replace />;
  if (loading) return <div className="center-page">Loading…</div>;

  const groups = [];
  for (const task of tasks) {
    const g = groups.find((x) => x.category === task.category);
    if (g) g.tasks.push(task);
    else groups.push({ category: task.category, tasks: [task] });
  }

  const sections = { A: 'A. Personal Attributes', B: 'B. Observance of Work Station Conduct', C: 'C. Service Excellence Condition', D: 'D. Judgment and Decision Making' };
  const factorSections = [];
  for (const f of myFactors) {
    const g = factorSections.find((x) => x.section === f.section);
    if (g) g.factors.push(f);
    else factorSections.push({ section: f.section, factors: [f] });
  }
  const factorValue = (id) => factorRatings.find((r) => r.factor_id === id)?.rating ?? null;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>{isSelf ? 'My Targets & Ratings' : `${RATER_LABELS[raterType]} — ${ratee?.full_name || 'Employee'}`}</h1>
          <p className="muted">
            {isSelf
              ? `${user.position ? `${user.position} · ` : ''}${user.department || ''}`
              : `${ratee?.position ? `${ratee.position} · ` : ''}${ratee?.department || ''}`}
          </p>
        </div>
        <div className="page-head-right">
          <select value={periodId} onChange={(e) => setPeriodId(e.target.value)}>
            {periods.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <span className="muted save-state">{saveState}</span>
        </div>
      </div>

      {readOnly && (
        <div className="alert alert-info">
          This is a read-only view of your Part I targets. Your supervisor rates Pages 1-2; you rate yourself with one overall
          score on your Dashboard (Page 3).
        </div>
      )}
      {!readOnly && locked && <div className="alert alert-success">This appraisal was submitted on {new Date(appraisal.submitted_at).toLocaleString()}. Ask the admin to reopen it if you need changes.</div>}
      {error && <div className="alert alert-error">{error}</div>}

      <div className="steps">
        {[
          [1, `Part I — Performance (${Math.round((settings.part1_weight ?? 0.7) * 100)}%)`],
          [2, `Part II — Critical Factors (${Math.round((settings.part2_weight ?? 0.3) * 100)}%)`],
          [3, 'Review & Submit']
        ].map(([n, label]) => (
          <button key={n} className={`step ${step === n ? 'step-on' : ''}`} onClick={() => setStep(n)}>
            <span className="step-num">{n}</span> {label}
          </button>
        ))}
      </div>

      <div className="sticky-score">
        <span>
          Live score: <strong>{score.overall.toFixed(2)}</strong> ({score.band.label})
        </span>
        <span className="muted">
          Tasks {score.progress.tasksRated}/{score.progress.tasksTotal} · Factors {score.progress.factorsRated}/{score.progress.factorsTotal}
        </span>
      </div>

      {step === 1 && (
        <div>
          {tasks.length === 0 && <div className="alert alert-info">No tasks assigned yet for this period. Please contact the admin.</div>}
          {groups.map((group) => (
            <div key={group.category} className="task-group">
              <h2>{group.category}</h2>
              {group.tasks.map((task) => {
                const r = task.rating || {};
                const s = taskScore(task);
                return (
                  <div key={task.id} className={`card task-card ${s.complete ? 'task-done' : ''}`}>
                    <div className="task-head">
                      <div>
                        <strong>
                          {task.code && `${task.code} `}
                          {task.name}
                        </strong>
                        <div className="muted small">{task.unit}</div>
                      </div>
                      <div className="task-head-right">
                        <span className="badge badge-slate">weight {Number(task.weight).toFixed(2)}</span>
                        {s.complete && (
                          <span className="badge badge-green">
                            APS {s.aps.toFixed(2)} → EPS {s.eps.toFixed(3)}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="task-grid">
                      <div className="task-cell">
                        <label className="small">Quantity — target: <strong>{task.qty_target || '—'}</strong></label>
                        <input
                          placeholder="Accomplished (e.g. 6 or ATC)"
                          defaultValue={r.qty_accomp || ''}
                          disabled={locked}
                          onBlur={(e) => e.target.value !== (r.qty_accomp || '') && saveTask(task, { qty_accomp: e.target.value })}
                        />
                        <RatingChips value={r.rate_qn} scale={scale} disabled={locked} onChange={(v) => saveTask(task, { rate_qn: v })} />
                      </div>
                      <div className="task-cell">
                        <label className="small">Quality — target: <strong>{task.quality_target || '—'}</strong></label>
                        <input
                          placeholder="Accomplished (e.g. 1 or 125/150)"
                          defaultValue={r.quality_accomp || ''}
                          disabled={locked}
                          onBlur={(e) => e.target.value !== (r.quality_accomp || '') && saveTask(task, { quality_accomp: e.target.value })}
                        />
                        <RatingChips value={r.rate_ql} scale={scale} disabled={locked} onChange={(v) => saveTask(task, { rate_ql: v })} />
                      </div>
                      <div className="task-cell">
                        <label className="small">Time — target: <strong>{task.time_target || '—'}</strong></label>
                        <select
                          value={r.time_status || ''}
                          disabled={locked}
                          onChange={(e) => {
                            const v = e.target.value;
                            saveTask(task, { time_status: v, rate_t: v ? TIME_AUTO[v] : null });
                          }}
                        >
                          <option value="">— status —</option>
                          <option value="COMPLETE">On time / complete (10)</option>
                          <option value="DELAYED">Delayed (4)</option>
                          <option value="NOT DONE">Not done (2)</option>
                        </select>
                        <RatingChips value={r.rate_t} scale={scale} disabled={locked} onChange={(v) => saveTask(task, { rate_t: v })} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
          <div className="wizard-nav">
            <span className="muted">
              TEPS {score.teps.toFixed(2)} × {Math.round((settings.part1_weight ?? 0.7) * 100)}% = <strong>WAS {score.was1.toFixed(2)}</strong>
            </span>
            <button className="btn btn-primary" onClick={() => setStep(2)}>
              Next: Critical Factors →
            </button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div>
          {factorSections.map((group) => (
            <div key={group.section} className="card">
              <h3>{sections[group.section] || group.section}</h3>
              {group.factors.map((f) => (
                <div key={f.id} className="factor-row">
                  <span>{f.label}</span>
                  <RatingChips value={factorValue(f.id)} scale={scale} disabled={locked} onChange={(v) => saveFactor(f.id, v)} />
                </div>
              ))}
            </div>
          ))}
          <div className="wizard-nav">
            <button className="btn" onClick={() => setStep(1)}>
              ← Back
            </button>
            <span className="muted">
              Avg {score.aps2.toFixed(2)} × {Math.round((settings.part2_weight ?? 0.3) * 100)}% = <strong>WAS {score.was2.toFixed(2)}</strong>
            </span>
            <button className="btn btn-primary" onClick={() => setStep(3)}>
              Next: Review →
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="grid-2">
          <div className="card card-center">
            <h3>{isSelf ? 'Final Self-Rating' : `${RATER_LABELS[raterType]} Result`}</h3>
            <ScoreRing score={score.overall} band={score.band} size={160} />
            <p>
              <strong>{score.band.label}</strong>
            </p>
            <table className="table table-compact">
              <tbody>
                <tr>
                  <td>Part I — TEPS</td>
                  <td>{score.teps.toFixed(2)}</td>
                </tr>
                <tr>
                  <td>Part I — Weighted ({Math.round((settings.part1_weight ?? 0.7) * 100)}%)</td>
                  <td>{score.was1.toFixed(2)}</td>
                </tr>
                <tr>
                  <td>Part II — Average</td>
                  <td>{score.aps2.toFixed(2)}</td>
                </tr>
                <tr>
                  <td>Part II — Weighted ({Math.round((settings.part2_weight ?? 0.3) * 100)}%)</td>
                  <td>{score.was2.toFixed(2)}</td>
                </tr>
                <tr>
                  <td>
                    <strong>Overall</strong>
                  </td>
                  <td>
                    <strong>{score.overall.toFixed(2)}</strong>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="card">
            <h3>{readOnly ? 'About this appraisal' : 'Submit'}</h3>
            {readOnly && (
              <p className="muted small">
                Your supervisor submits this form. Your own input is the single overall self rate on your Dashboard.
              </p>
            )}
            {score.progress.tasksRated < score.progress.tasksTotal && (
              <div className="alert alert-info">{score.progress.tasksTotal - score.progress.tasksRated} task(s) still need all three ratings (QN, QL, T).</div>
            )}
            {score.progress.factorsRated < score.progress.factorsTotal && (
              <div className="alert alert-info">{score.progress.factorsTotal - score.progress.factorsRated} critical factor(s) still unrated.</div>
            )}
            <label>
              Comments / remarks (optional)
              <textarea rows={4} value={comments} disabled={locked} onChange={(e) => setComments(e.target.value)} />
            </label>
            {!readOnly && (
              <>
                <button className="btn btn-primary btn-block" disabled={locked} onClick={submit}>
                  {locked ? 'Already submitted ✓' : `Submit ${RATER_LABELS[raterType]}`}
                </button>
                <p className="muted small">After submitting, your answers are locked. The admin can reopen the appraisal if needed.</p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
