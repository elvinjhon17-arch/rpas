import { useEffect, useState } from 'react';
import { api } from '../../api.js';
import { RATER_LABELS } from '../../scoring.js';
import Avatar from '../../components/Avatar.jsx';
import Modal from '../../components/Modal.jsx';

const EMPTY = {
  username: '',
  password: '',
  full_name: '',
  position: '',
  department: '',
  role: 'employee',
  is_supervisor: false,
  rater_privilege: 'none'
};
const ASSIGNABLE = ['supervisor', 'hr', 'audit'];
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
      const { assignments } = await api(`/assignments?rateeId=${u.id}`);
      const map = {};
      for (const a of assignments) map[a.rater_type] = a.rater_user_id;
      setAssigning({ user: u, assignments: map });
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
            {ASSIGNABLE.map((type) => (
              <label key={type}>
                {RATER_LABELS[type]}
                {type === 'supervisor' ? ' — fills Pages 1-3' : ' — enters one Page 3 score'}
                <select value={assigning.assignments[type] || ''} onChange={(e) => saveRater(type, e.target.value)}>
                  <option value="">— not assigned —</option>
                  {users
                    .filter((u) => u.id !== assigning.user.id && eligible(type, u))
                    .map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.full_name}
                      </option>
                    ))}
                </select>
              </label>
            ))}
            <p className="muted small">
              Only accounts with the right rating privilege appear here — set it when creating or editing the account.
            </p>
          </div>
          <p className="muted small">Changes save immediately.</p>
        </Modal>
      )}
    </div>
  );
}
