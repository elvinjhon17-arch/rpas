import { useEffect, useState } from 'react';
import { api } from '../../api.js';

const SECTIONS = {
  A: 'A. Personal Attributes',
  B: 'B. Observance of Work Station Conduct',
  C: 'C. Service Excellence Condition',
  D: 'D. Judgment and Decision Making'
};

export default function Factors() {
  const [factors, setFactors] = useState([]);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState({ section: 'A', label: '' });

  const load = () => api('/factors').then(({ factors }) => setFactors(factors)).catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);

  const save = async (f, patch) => {
    try {
      await api(`/factors/${f.id}`, { method: 'PUT', body: patch });
      setFactors((prev) => prev.map((x) => (x.id === f.id ? { ...x, ...patch } : x)));
      setError('');
    } catch (e) {
      setError(e.message);
    }
  };

  const add = async (e) => {
    e.preventDefault();
    if (!draft.label.trim()) return;
    try {
      const sectionItems = factors.filter((f) => f.section === draft.section);
      await api('/factors', {
        method: 'POST',
        body: { ...draft, supervisor_only: draft.section === 'D', sort_order: sectionItems.length }
      });
      setDraft({ ...draft, label: '' });
      load();
    } catch (e2) {
      setError(e2.message);
    }
  };

  const remove = async (f) => {
    if (!window.confirm(`Delete "${f.label}"? Existing ratings for it will be removed.`)) return;
    try {
      await api(`/factors/${f.id}`, { method: 'DELETE' });
      load();
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <div>
      <div className="page-head">
        <h1>Part II — Critical Factors</h1>
      </div>
      {error && <div className="alert alert-error">{error}</div>}
      <div className="alert alert-info">
        Part II is always rated by the employee's assigned <strong>Supervisor rater</strong> (department officer/head). The
        "asked only of supervisory employees" checkbox controls something different: checked factors (Section D) only appear
        when the employee <em>being appraised</em> holds a supervisory position — regular employees are scored on 15 factors,
        supervisory employees on 18.
      </div>

      <form className="card add-row" onSubmit={add}>
        <select value={draft.section} onChange={(e) => setDraft({ ...draft, section: e.target.value })}>
          {Object.entries(SECTIONS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <input placeholder="New factor description…" value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} />
        <button className="btn btn-primary">+ Add</button>
      </form>

      {Object.entries(SECTIONS).map(([key, title]) => {
        const items = factors.filter((f) => f.section === key);
        if (!items.length) return null;
        return (
          <div key={key} className="card">
            <h3>{title}</h3>
            {items.map((f) => (
              <div key={f.id} className={`factor-row ${f.active === false ? 'row-muted' : ''}`}>
                <input className="factor-input" defaultValue={f.label} onBlur={(e) => e.target.value !== f.label && save(f, { label: e.target.value })} />
                <label className="check-label small" title="When checked, this factor is only asked when the employee being appraised holds a supervisory position (Section D of the paper form)">
                  <input type="checkbox" checked={!!f.supervisor_only} onChange={(e) => save(f, { supervisor_only: e.target.checked })} />
                  asked only of supervisory employees
                </label>
                <label className="check-label small">
                  <input type="checkbox" checked={f.active !== false} onChange={(e) => save(f, { active: e.target.checked })} />
                  active
                </label>
                <button className="btn btn-small btn-danger" onClick={() => remove(f)}>
                  ✕
                </button>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
