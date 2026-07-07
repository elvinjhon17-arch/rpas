import { useEffect, useState } from 'react';
import { api } from '../../api.js';
import Modal from '../../components/Modal.jsx';
import { COVERAGE_OPTIONS, coverageLabel, coverageEndDate, coverageName } from '../../coverage.js';

const EMPTY = { name: '', start_date: '', end_date: '', coverage: 'semi_annual', is_active: false };

export default function Periods() {
  const [periods, setPeriods] = useState([]);
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState('');

  const load = () => api('/periods').then(({ periods }) => setPeriods(periods)).catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);

  // Changing coverage or start date recalculates the end date and suggested
  // name; both stay editable afterwards.
  const applyCoverage = (patch) => {
    const next = { ...editing, ...patch };
    if (next.start_date) {
      next.end_date = coverageEndDate(next.start_date, next.coverage);
      next.name = coverageName(next.start_date, next.end_date);
    }
    setEditing(next);
  };

  const save = async (e) => {
    e.preventDefault();
    try {
      if (editing.id) await api(`/periods/${editing.id}`, { method: 'PUT', body: editing });
      else await api('/periods', { method: 'POST', body: editing });
      setEditing(null);
      setError('');
      load();
    } catch (e2) {
      setError(e2.message);
    }
  };

  const remove = async (p) => {
    if (!window.confirm(`Delete period "${p.name}"? All tasks and ratings in it will be removed.`)) return;
    try {
      await api(`/periods/${p.id}`, { method: 'DELETE' });
      load();
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <div>
      <div className="page-head">
        <h1>Appraisal Periods</h1>
        <button className="btn btn-primary" onClick={() => setEditing({ ...EMPTY })}>
          + Add period
        </button>
      </div>
      {error && <div className="alert alert-error">{error}</div>}
      <div className="card">
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Coverage</th>
              <th>Start</th>
              <th>End</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {periods.map((p) => (
              <tr key={p.id}>
                <td>{p.name}</td>
                <td>{coverageLabel(p.coverage)}</td>
                <td>{p.start_date || '—'}</td>
                <td>{p.end_date || '—'}</td>
                <td>{p.is_active ? <span className="badge badge-green">active</span> : <span className="badge badge-slate">closed</span>}</td>
                <td className="cell-actions">
                  <button className="btn btn-small" onClick={() => setEditing(p)}>
                    Edit
                  </button>
                  <button className="btn btn-small btn-danger" onClick={() => remove(p)}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <Modal title={editing.id ? 'Edit period' : 'Add period'} onClose={() => setEditing(null)}>
          <form onSubmit={save} className="form-grid">
            <label>
              Coverage
              <select value={editing.coverage || 'semi_annual'} onChange={(e) => applyCoverage({ coverage: e.target.value })}>
                {COVERAGE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Start date (end date and name auto-fill from coverage)
              <input type="date" value={editing.start_date || ''} onChange={(e) => applyCoverage({ start_date: e.target.value })} />
            </label>
            <label>
              End date
              <input type="date" value={editing.end_date || ''} onChange={(e) => setEditing({ ...editing, end_date: e.target.value })} />
            </label>
            <label>
              Name (e.g. "January - June 2027")
              <input required value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            </label>
            <label className="check-label">
              <input type="checkbox" checked={!!editing.is_active} onChange={(e) => setEditing({ ...editing, is_active: e.target.checked })} />
              Active period — the default one everybody sees when they log in (only one period can be active; older periods stay
              viewable from the dropdowns)
            </label>
            <button className="btn btn-primary btn-block">Save</button>
          </form>
        </Modal>
      )}
    </div>
  );
}
