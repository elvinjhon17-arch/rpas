import { useEffect, useState } from 'react';
import { api } from '../../api.js';
import { RATER_LABELS } from '../../scoring.js';
import { pickPeriod } from '../../period.js';
import Avatar from '../../components/Avatar.jsx';
import Modal from '../../components/Modal.jsx';
import SearchSelect from '../../components/SearchSelect.jsx';

const EMPTY = {
  username: '',
  password: '',
  full_name: '',
  position: '',
  department: '',
  role: 'employee',
  is_supervisor: false,
  rater_privilege: 'none',
  is_approver: false
};
const PRIVILEGES = {
  none: 'Regular employee (does not rate anyone)',
  page3: 'Page 3 rater (can be HR / Internal Audit rater)',
  full: 'All pages — officer/head (can be Supervisor rater)'
};
// Which privileges may hold each rater slot
const eligible = (type, u) => (type === 'supervisor' ? u.rater_privilege === 'full' : ['page3', 'full'].includes(u.rater_privilege));

export default function Employees() {
  const [users, setUsers] = useState([]);
  const [editing, setEditing] = useState(null); // null | {id?, ...form}
  const [assigning, setAssigning] = useState(null); // null | { user, assignments: {type: raterUserId} }
  const [error, setError] = useState('');

  const load = () => api('/users').then(({ users }) => setUsers(users)).catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);

  const openRaters = async (u) => {
    try {
      const [{ assignments }, { periods }] = await Promise.all([api(`/assignments?rateeId=${u.id}`), api('/periods')]);
      const pid = pickPeriod(periods);
      const { tasks } = pid ? await api(`/tasks?userId=${u.id}&periodId=${pid}`) : { tasks: [] };
      const map = {};
      for (const a of assignments) if (a.rater_type !== 'supervisor') map[a.rater_type] = a.rater_user_id;
      setAssigning({
        user: u,
        assignments: map,
        supervisors: assignments.filter((a) => a.rater_type === 'supervisor'),
        tasks,
        periodName: periods.find((p) => p.id === pid)?.name || '',
        scopeEditing: null // assignment id whose task scope is open
      });
    } catch (e) {
      setError(e.message);
    }
  };

  const saveRater = async (raterType, raterUserId) => {
    try {
      await api('/assignments', { method: 'PUT', body: { rateeId: assigning.user.id, raterType, raterUserId: raterUserId || null } });
      setAssigning((prev) => ({ ...prev, assignments: { ...prev.assignments, [raterType]: raterUserId } }));
      setError('');
    } catch (e) {
      setError(e.message);
    }
  };

  const addSupervisor = async (raterUserId) => {
    if (!raterUserId) return;
    try {
      const { assignment } = await api('/assignments/supervisors', {
        method: 'POST',
        body: { rateeId: assigning.user.id, raterUserId }
      });
      setAssigning((prev) => ({ ...prev, supervisors: [...prev.supervisors, assignment] }));
      setError('');
    } catch (e) {
      setError(e.message);
    }
  };

  const reloadSupervisors = async (rateeId) => {
    const { assignments } = await api(`/assignments?rateeId=${rateeId}`);
    setAssigning((prev) => ({ ...prev, supervisors: assignments.filter((a) => a.rater_type === 'supervisor') }));
  };

  const removeSupervisor = async (a) => {
    const name = users.find((u) => u.id === a.rater_user_id)?.full_name || 'this supervisor';
    if (!window.confirm(`Remove ${name} as a supervisor rater?`)) return;
    try {
      await api(`/assignments/supervisors/${a.id}`, { method: 'DELETE' });
      // reload: the server may promote another supervisor to Part II rater
      await reloadSupervisors(assigning.user.id);
      setError('');
    } catch (e) {
      setError(e.message);
    }
  };

  // Exactly one supervisor rates the Part II critical factors
  const designatePart2 = async (a) => {
    try {
      await api(`/assignments/supervisors/${a.id}/part2`, { method: 'PUT' });
      await reloadSupervisors(assigning.user.id);
      setError('');
    } catch (e) {
      setError(e.message);
    }
  };

  // Toggle one task inside a supervisor's scope and save (empty scope = all tasks)
  const toggleScopeTask = async (a, taskId) => {
    const current = Array.isArray(a.task_ids) && a.task_ids.length ? a.task_ids : [];
    const next = current.includes(taskId) ? current.filter((t) => t !== taskId) : [...current, taskId];
    try {
      const { assignment } = await api(`/assignments/supervisors/${a.id}`, { method: 'PUT', body: { taskIds: next } });
      setAssigning((prev) => ({
        ...prev,
        supervisors: prev.supervisors.map((x) => (x.id === a.id ? assignment : x))
      }));
      setError('');
    } catch (e) {
      setError(e.message);
    }
  };

  const clearScope = async (a) => {
    try {
      const { assignment } = await api(`/assignments/supervisors/${a.id}`, { method: 'PUT', body: { taskIds: null } });
      setAssigning((prev) => ({
        ...prev,
        supervisors: prev.supervisors.map((x) => (x.id === a.id ? assignment : x))
      }));
      setError('');
    } catch (e) {
      setError(e.message);
    }
  };

  const save = async (e) => {
    e.preventDefault();
    try {
      if (editing.id) await api(`/users/${editing.id}`, { method: 'PUT', body: editing });
      else await api('/users', { method: 'POST', body: editing });
      setEditing(null);
      setError('');
      load();
    } catch (e2) {
      setError(e2.message);
    }
  };

  const resetPassword = async (u) => {
    const password = window.prompt(`New password for ${u.full_name}:`);
    if (!password) return;
    try {
      await api(`/users/${u.id}/reset-password`, { method: 'POST', body: { password } });
      window.alert(`Password for ${u.full_name} reset.`);
    } catch (e) {
      setError(e.message);
    }
  };

  const remove = async (u) => {
    if (!window.confirm(`Delete ${u.full_name}? This removes all their tasks and ratings.`)) return;
    try {
      await api(`/users/${u.id}`, { method: 'DELETE' });
      load();
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <div>
      <div className="page-head">
        <h1>Employees</h1>
        <button className="btn btn-primary" onClick={() => setEditing({ ...EMPTY })}>
          + Add employee
        </button>
      </div>
      {error && <div className="alert alert-error">{error}</div>}
      <div className="card">
        <table className="table">
          <thead>
            <tr>
              <th>Employee</th>
              <th>Username</th>
              <th>Position</th>
              <th>Department</th>
              <th>Role</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>
                  <div className="cell-user">
                    <Avatar user={u} size={32} />
                    <span>
                      {u.full_name}
                      {u.is_supervisor && <span className="badge badge-slate" style={{ marginLeft: 6 }}>supervisor</span>}
                    </span>
                  </div>
                </td>
                <td>{u.username}</td>
                <td>{u.position}</td>
                <td>{u.department}</td>
                <td>
                  <span className={`badge ${u.role === 'admin' ? 'badge-amber' : 'badge-slate'}`}>{u.role}</span>
                </td>
                <td className="cell-actions">
                  <button className="btn btn-small" onClick={() => setEditing({ ...u, password: '' })}>
                    Edit
                  </button>
                  {u.role !== 'admin' && (
                    <button className="btn btn-small" onClick={() => openRaters(u)}>
                      Raters
                    </button>
                  )}
                  <button className="btn btn-small" onClick={() => resetPassword(u)}>
                    Reset PW
                  </button>
                  <button className="btn btn-small btn-danger" onClick={() => remove(u)}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <Modal title={editing.id ? `Edit ${editing.full_name}` : 'Add employee'} onClose={() => setEditing(null)}>
          <form onSubmit={save} className="form-grid">
            <label>
              Full name
              <input required value={editing.full_name} onChange={(e) => setEditing({ ...editing, full_name: e.target.value })} />
            </label>
            <label>
              Username
              <input required value={editing.username} onChange={(e) => setEditing({ ...editing, username: e.target.value })} />
            </label>
            {!editing.id && (
              <label>
                Password
                <input required type="text" value={editing.password} onChange={(e) => setEditing({ ...editing, password: e.target.value })} />
              </label>
            )}
            <label>
              Position
              <input value={editing.position || ''} onChange={(e) => setEditing({ ...editing, position: e.target.value })} />
            </label>
            <label>
              Department
              <input value={editing.department || ''} onChange={(e) => setEditing({ ...editing, department: e.target.value })} />
            </label>
            <label>
              Role
              <select value={editing.role} onChange={(e) => setEditing({ ...editing, role: e.target.value })}>
                <option value="employee">Employee</option>
                <option value="admin">Admin</option>
              </select>
            </label>
            <label>
              Rating privilege — what this account may rate for others
              <select value={editing.rater_privilege || 'none'} onChange={(e) => setEditing({ ...editing, rater_privilege: e.target.value })}>
                {Object.entries(PRIVILEGES).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="check-label">
              <input
                type="checkbox"
                checked={!!editing.is_supervisor}
                onChange={(e) => setEditing({ ...editing, is_supervisor: e.target.checked })}
              />
              Officer / Supervisor position — when this employee is rated, Section D "Judgment and Decision Making" is included
              (18 factors); leave unchecked for rank-and-file staff (15 factors, Section D hidden)
            </label>
            <label className="check-label">
              <input
                type="checkbox"
                checked={!!editing.is_approver}
                onChange={(e) => setEditing({ ...editing, is_approver: e.target.checked })}
              />
              Approver — can approve newly created tasks (a "Task Approvals" page appears for this account)
            </label>
            <button className="btn btn-primary btn-block">{editing.id ? 'Save changes' : 'Create account'}</button>
          </form>
        </Modal>
      )}

      {assigning && (
        <Modal title={`Raters for ${assigning.user.full_name}`} onClose={() => setAssigning(null)}>
          <p className="muted small">
            The Supervisor fills the Part I / Part II form; HR and Internal Audit each enter one overall score. The final rating
            combines them using the weights in Formula Settings (default 50% / 20% / 30%).
          </p>
          <div className="form-grid">
            <div className="sup-list">
              <strong className="small">Supervisor Raters — fill Pages 1-3 (each can be limited to specific tasks)</strong>
              {assigning.supervisors.map((a) => {
                const person = users.find((u) => u.id === a.rater_user_id);
                const scoped = Array.isArray(a.task_ids) && a.task_ids.length > 0;
                const open = assigning.scopeEditing === a.id;
                return (
                  <div key={a.id} className="sup-row">
                    <div className="sup-row-head">
                      <span>
                        <strong>{person?.full_name || 'Unknown'}</strong>{' '}
                        <span className="muted small">
                          {scoped ? `${a.task_ids.length} of ${assigning.tasks.length} tasks` : 'all tasks'}
                        </span>{' '}
                        {a.rates_part2 && <span className="badge badge-green">rates Part II</span>}
                      </span>
                      <span className="cell-actions">
                        {!a.rates_part2 && (
                          <button
                            type="button"
                            className="btn btn-small"
                            title="Make this supervisor the one who rates the Part II critical factors"
                            onClick={() => designatePart2(a)}
                          >
                            Set Part II rater
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn btn-small"
                          onClick={() => setAssigning((prev) => ({ ...prev, scopeEditing: open ? null : a.id }))}
                        >
                          {open ? 'Done' : 'Select tasks'}
                        </button>
                        <button type="button" className="btn btn-small btn-danger" onClick={() => removeSupervisor(a)}>
                          Remove
                        </button>
                      </span>
                    </div>
                    {open && (
                      <div className="sup-scope">
                        <p className="muted small" style={{ margin: '4px 0' }}>
                          Tick the tasks this supervisor rates ({assigning.periodName}). No ticks = all tasks.{' '}
                          {scoped && (
                            <button type="button" className="btn btn-small" onClick={() => clearScope(a)}>
                              Reset to all tasks
                            </button>
                          )}
                        </p>
                        {assigning.tasks.map((t) => (
                          <label key={t.id} className="check-label small sup-task">
                            <input
                              type="checkbox"
                              checked={scoped && a.task_ids.includes(t.id)}
                              onChange={() => toggleScopeTask(a, t.id)}
                            />
                            <span>
                              {t.code && `${t.code} `}
                              {t.name}
                            </span>
                          </label>
                        ))}
                        {!assigning.tasks.length && <p className="muted small">No tasks set up for this period yet.</p>}
                      </div>
                    )}
                  </div>
                );
              })}
              <SearchSelect
                options={users
                  .filter(
                    (u) =>
                      u.id !== assigning.user.id &&
                      eligible('supervisor', u) &&
                      !assigning.supervisors.some((a) => a.rater_user_id === u.id)
                  )
                  .map((u) => ({ value: u.id, label: u.full_name, hint: u.department }))}
                value=""
                onChange={addSupervisor}
                placeholder="+ Add supervisor rater…"
              />
            </div>

            {['hr', 'audit'].map((type) => (
              <label key={type}>
                {RATER_LABELS[type]} — enters one Page 3 score
                <SearchSelect
                  options={[
                    { value: '', label: '— not assigned —' },
                    ...users
                      .filter((u) => u.id !== assigning.user.id && eligible(type, u))
                      .map((u) => ({ value: u.id, label: u.full_name, hint: u.department }))
                  ]}
                  value={assigning.assignments[type] || ''}
                  onChange={(v) => saveRater(type, v)}
                  placeholder="Search employee…"
                />
              </label>
            ))}
            <p className="muted small">
              Only accounts with the right rating privilege appear here — set it when creating or editing the account. The
              supervisors' Part I ratings combine into one Supervisor score; a task can only be rated by the supervisor it is
              assigned to.
            </p>
          </div>
          <p className="muted small">Changes save immediately.</p>
        </Modal>
      )}
    </div>
  );
}
