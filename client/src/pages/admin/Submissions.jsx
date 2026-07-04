import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api.js';
import Avatar from '../../components/Avatar.jsx';
import Icon from '../../components/Icon.jsx';
import { bandColor, RATER_TYPES, RATER_LABELS } from '../../scoring.js';

const SHORT = { self: 'Self', supervisor: 'Sup', peer: 'Peer', hr: 'HR', audit: 'Audit' };

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

  const reopen = async (row, appraisal) => {
    if (!window.confirm(`Reopen the ${RATER_LABELS[appraisal.rater_type]} of ${row.user.full_name} for editing?`)) return;
    try {
      await api(`/appraisals/${appraisal.id}/reopen`, { method: 'POST' });
      load();
    } catch (e) {
      setError(e.message);
    }
  };

  // Admin encodes a Page 3 score (self/hr/peer/audit) e.g. from a paper form
  const encodeScore = async (row, type) => {
    const value = window.prompt(`${RATER_LABELS[type]} for ${row.user.full_name} — overall score (0-10):`);
    if (value === null || value === '') return;
    try {
      await api('/appraisals/submit', { method: 'POST', body: { periodId, raterType: type, userId: row.user.id, score: value } });
      load();
    } catch (e) {
      setError(e.message);
    }
  };

  const exportCsv = () => {
    const period = periods.find((p) => p.id === periodId);
    const head = [
      'Employee',
      'Position',
      'Department',
      ...RATER_TYPES.map((t) => RATER_LABELS[t]),
      'Final Rating',
      'Adjectival',
      'Comments'
    ];
    const lines = [head.join(',')];
    for (const r of rows) {
      const perRater = r.final.rows.map((row) => (row.score ? row.score.overall : ''));
      lines.push(
        [r.user.full_name, r.user.position, r.user.department, ...perRater, r.final.final, r.final.band.label, r.comments]
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
            <Icon name="download" size={16} /> Export CSV
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
                {RATER_TYPES.map((t) => (
                  <th key={t} title={RATER_LABELS[t]}>
                    {SHORT[t]}
                  </th>
                ))}
                <th>Final</th>
                <th>Rating</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
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
                  {r.final.rows.map((cell) => {
                    const appraisal = r.appraisals.find((a) => a.rater_type === cell.type);
                    const label = cell.score ? cell.score.overall.toFixed(2) : cell.status === 'submitted' ? '✓' : '—';
                    const badgeClass = `badge ${cell.status === 'submitted' ? 'badge-green' : 'badge-slate'}`;
                    return (
                      <td key={cell.type}>
                        {cell.type === 'supervisor' ? (
                          <Link
                            to={`/rate/supervisor/${r.user.id}`}
                            state={{ ratee: r.user }}
                            className={badgeClass}
                            title={`${RATER_LABELS[cell.type]}: ${cell.status} — click to open the form`}
                          >
                            {label}
                          </Link>
                        ) : (
                          <button
                            className={badgeClass}
                            style={{ border: 'none', cursor: 'pointer' }}
                            title={`${RATER_LABELS[cell.type]}: ${cell.status} — click to enter/update the Page 3 score`}
                            onClick={() => encodeScore(r, cell.type)}
                          >
                            {label}
                          </button>
                        )}
                        {appraisal?.status === 'submitted' && (
                          <button className="btn btn-small" style={{ marginLeft: 4 }} title="Reopen for editing" onClick={() => reopen(r, appraisal)}>
                            ↺
                          </button>
                        )}
                      </td>
                    );
                  })}
                  <td>
                    <strong>{r.final.final.toFixed(2)}</strong>
                  </td>
                  <td>
                    <span className="badge" style={{ background: `${bandColor(r.final.band.code)}22`, color: bandColor(r.final.band.code) }}>
                      {r.final.band.label}
                    </span>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="muted" style={{ textAlign: 'center', padding: 24 }}>
                    No employees yet. Add them in the Employees page.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <p className="muted small" style={{ padding: '0 12px 12px' }}>
            Each cell shows that rater's submitted score (— = not submitted; scores only count toward the final once submitted).
            Click a cell to open that rater's form; ↺ reopens a submitted rating.
          </p>
        </div>
      )}
    </div>
  );
}
