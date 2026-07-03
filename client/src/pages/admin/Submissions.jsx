import { useEffect, useState } from 'react';
import { api } from '../../api.js';
import Avatar from '../../components/Avatar.jsx';
import { bandColor } from '../../scoring.js';

export default function Submissions() {
  const [periods, setPeriods] = useState([]);
  const [periodId, setPeriodId] = useState('');
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api('/periods')
      .then(({ periods }) => {
        setPeriods(periods);
        const active = periods.find((p) => p.is_active) || periods[0];
        if (active) setPeriodId(active.id);
      })
      .catch((e) => setError(e.message));
  }, []);

  const load = () => {
    if (!periodId) return;
    setRows(null);
    api(`/reports/summary?periodId=${periodId}`)
      .then(({ rows }) => setRows(rows))
      .catch((e) => setError(e.message));
  };
  useEffect(load, [periodId]);

  const reopen = async (row) => {
    if (!window.confirm(`Reopen ${row.user.full_name}'s appraisal for editing?`)) return;
    try {
      await api(`/appraisals/${row.appraisal_id}/reopen`, { method: 'POST' });
      load();
    } catch (e) {
      setError(e.message);
    }
  };

  const exportCsv = () => {
    const period = periods.find((p) => p.id === periodId);
    const head = ['Employee', 'Position', 'Department', 'Part I WAS', 'Part II WAS', 'Overall', 'Rating', 'Status', 'Submitted', 'Comments'];
    const lines = [head.join(',')];
    for (const r of rows) {
      lines.push(
        [
          r.user.full_name,
          r.user.position,
          r.user.department,
          r.score.was1,
          r.score.was2,
          r.score.overall,
          r.score.band.label,
          r.status,
          r.submitted_at ? new Date(r.submitted_at).toLocaleString() : '',
          r.comments
        ]
          .map((v) => `"${String(v ?? '').replaceAll('"', '""')}"`)
          .join(',')
      );
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `RPAS ${period?.name || 'summary'}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div>
      <div className="page-head">
        <h1>Submissions</h1>
        <div className="page-head-right">
          <select value={periodId} onChange={(e) => setPeriodId(e.target.value)}>
            {periods.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button className="btn" onClick={exportCsv} disabled={!rows?.length}>
            ⬇ Export CSV
          </button>
        </div>
      </div>
      {error && <div className="alert alert-error">{error}</div>}
      {!rows ? (
        <div className="center-page">Loading…</div>
      ) : (
        <div className="card">
          <table className="table">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Progress</th>
                <th>Part I</th>
                <th>Part II</th>
                <th>Overall</th>
                <th>Rating</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const p = r.score.progress;
                const total = p.tasksTotal + p.factorsTotal;
                const done = p.tasksRated + p.factorsRated;
                return (
                  <tr key={r.user.id}>
                    <td>
                      <div className="cell-user">
                        <Avatar user={r.user} size={32} />
                        <div>
                          <div>{r.user.full_name}</div>
                          <div className="muted small">{r.user.department}</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <div className="progress-bar progress-mini">
                        <div className="progress-fill" style={{ width: total ? `${(done / total) * 100}%` : 0 }} />
                      </div>
                      <span className="muted small">
                        {done}/{total}
                      </span>
                    </td>
                    <td>{r.score.was1.toFixed(2)}</td>
                    <td>{r.score.was2.toFixed(2)}</td>
                    <td>
                      <strong>{r.score.overall.toFixed(2)}</strong>
                    </td>
                    <td>
                      <span className="badge" style={{ background: `${bandColor(r.score.band.code)}22`, color: bandColor(r.score.band.code) }}>
                        {r.score.band.label}
                      </span>
                    </td>
                    <td>
                      {r.status === 'submitted' ? (
                        <span className="badge badge-green" title={r.submitted_at && new Date(r.submitted_at).toLocaleString()}>
                          submitted
                        </span>
                      ) : (
                        <span className="badge badge-amber">draft</span>
                      )}
                    </td>
                    <td>
                      {r.status === 'submitted' && (
                        <button className="btn btn-small" onClick={() => reopen(r)}>
                          Reopen
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="muted" style={{ textAlign: 'center', padding: 24 }}>
                    No employees yet. Add them in the Employees page.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
