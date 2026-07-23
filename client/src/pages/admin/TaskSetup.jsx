import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api.js';
import Modal from '../../components/Modal.jsx';
import { pickPeriod, setSavedPeriod } from '../../period.js';
import SearchSelect from '../../components/SearchSelect.jsx';

// Admin editor for each employee's Part I task rows (name, targets, weights).
export default function TaskSetup() {
  const [users, setUsers] = useState([]);
  const [periods, setPeriods] = useState([]);
  const [userId, setUserId] = useState('');
  const [periodId, setPeriodId] = useState('');
  const [tasks, setTasks] = useState([]);
  const [error, setError] = useState('');
  const [copying, setCopying] = useState(null); // {fromUserId, fromPeriodId}
  const [selected, setSelected] = useState(new Set()); // task ids ticked for bulk delete
  const [dragIdx, setDragIdx] = useState(null); // row index being dragged

  useEffect(() => {
    Promise.all([api('/users'), api('/periods')])
      .then(([u, p]) => {
        const employees = u.users.filter((x) => x.role === 'employee');
        setUsers(employees);
        setPeriods(p.periods);
        if (employees[0]) setUserId(employees[0].id);
        const pid = pickPeriod(p.periods);
        if (pid) setPeriodId(pid);
      })
      .catch((e) => setError(e.message));
  }, []);

  const changePeriod = (id) => {
    setSavedPeriod(id);
    setPeriodId(id);
  };

  const load = () => {
    if (!userId || !periodId) return;
    api(`/tasks?userId=${userId}&periodId=${periodId}`)
      .then(({ tasks }) => {
        setTasks(tasks);
        setSelected(new Set());
      })
      .catch((e) => setError(e.message));
  };
  useEffect(load, [userId, periodId]);

  // ----- drag to reorder -----
  const moveTask = (from, to) => {
    if (from === null || from === to || from === undefined) return;
    const next = [...tasks];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setTasks(next);
    api('/tasks/reorder', { method: 'PUT', body: { ids: next.map((t) => t.id) } }).catch((e) => setError(e.message));
  };

  // ----- multi-select delete -----
  const toggleSelect = (id) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleSelectAll = () => setSelected((prev) => (prev.size === tasks.length ? new Set() : new Set(tasks.map((t) => t.id))));

  const bulkDelete = async () => {
    if (!selected.size) return;
    if (!window.confirm(`Delete ${selected.size} task(s)? Their ratings will be removed too.`)) return;
    try {
      await api('/tasks/bulk-delete', { method: 'POST', body: { ids: [...selected] } });
      setError('');
      load();
    } catch (e) {
      setError(e.message);
    }
  };

  const totalWeight = useMemo(() => tasks.reduce((sum, t) => sum + Number(t.weight || 0), 0), [tasks]);
  const weightOk = Math.abs(totalWeight - 1) < 0.001;
  const pendingCount = useMemo(() => tasks.filter((t) => !t.approved).length, [tasks]);

  const approveTasks = async (ids) => {
    if (!ids.length) return;
    try {
      await api('/tasks/approve', { method: 'POST', body: { ids } });
      setTasks((prev) => prev.map((t) => (ids.includes(t.id) ? { ...t, approved: true } : t)));
      setError('');
    } catch (e) {
      setError(e.message);
    }
  };

  const patchLocal = (id, patch) => setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));

  const saveField = async (task, field, value) => {
    if (String(task[field] ?? '') === String(value)) return;
    patchLocal(task.id, { [field]: value });
    try {
      await api(`/tasks/${task.id}`, { method: 'PUT', body: { [field]: field === 'weight' ? Number(value) || 0 : value } });
      setError('');
    } catch (e) {
      setError(e.message);
    }
  };

  const addTask = async () => {
    try {
      const { task } = await api('/tasks', {
        method: 'POST',
        body: {
          user_id: userId,
          period_id: periodId,
          name: 'New task',
          category: tasks.length ? tasks[tasks.length - 1].category : '1. Reports',
          sort_order: tasks.length
        }
      });
      setTasks((prev) => [...prev, task]);
    } catch (e) {
      setError(e.message);
    }
  };

  const removeTask = async (task) => {
    if (!window.confirm(`Delete task "${task.name}"? Its ratings will be removed too.`)) return;
    try {
      await api(`/tasks/${task.id}`, { method: 'DELETE' });
      setTasks((prev) => prev.filter((t) => t.id !== task.id));
    } catch (e) {
      setError(e.message);
    }
  };

  const doCopy = async (e) => {
    e.preventDefault();
    try {
      const { copied } = await api('/tasks/copy', {
        method: 'POST',
        body: { fromUserId: copying.fromUserId, fromPeriodId: copying.fromPeriodId, toUserId: userId, toPeriodId: periodId }
      });
      setCopying(null);
      setError('');
      window.alert(`Copied ${copied} tasks.`);
      load();
    } catch (e2) {
      setError(e2.message);
    }
  };

  const selectedUser = users.find((u) => u.id === userId);

  return (
    <div>
      <div className="page-head">
        <h1>Task Setup</h1>
        <div className="page-head-right">
          <SearchSelect
            options={users.map((u) => ({ value: u.id, label: u.full_name, hint: u.department }))}
            value={userId}
            onChange={setUserId}
            placeholder="Search employee…"
            width={260}
          />
          <select value={periodId} onChange={(e) => changePeriod(e.target.value)}>
            {periods.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button className="btn" onClick={() => setCopying({ fromUserId: users[0]?.id || '', fromPeriodId: periods[0]?.id || '' })}>
            Copy from…
          </button>
          {selected.size > 0 && (
            <button className="btn btn-danger" onClick={bulkDelete}>
              Delete selected ({selected.size})
            </button>
          )}
          {pendingCount > 0 && (
            <button className="btn btn-primary" onClick={() => approveTasks(tasks.filter((t) => !t.approved).map((t) => t.id))}>
              Approve all pending ({pendingCount})
            </button>
          )}
          <button className="btn btn-primary" onClick={addTask} disabled={!userId || !periodId}>
            + Add task
          </button>
        </div>
      </div>
      {error && <div className="alert alert-error">{error}</div>}

      <div className={`alert ${weightOk ? 'alert-success' : 'alert-error'}`}>
        Total weight: <strong>{totalWeight.toFixed(2)}</strong> {weightOk ? '✓ perfect (1.00)' : '— must add up to 1.00'}
      </div>

      <div className="card">
        <table className="table table-edit">
          <thead>
            <tr>
              <th style={{ width: 30 }}></th>
              <th style={{ width: 34 }}>
                <input
                  type="checkbox"
                  checked={tasks.length > 0 && selected.size === tasks.length}
                  onChange={toggleSelectAll}
                  title="Select all"
                />
              </th>
              <th style={{ width: 60 }}>Code</th>
              <th style={{ width: 170 }}>Category</th>
              <th>Work / Activity</th>
              <th style={{ width: 150 }}>Unit of measure</th>
              <th style={{ width: 80 }}>Qty target</th>
              <th
                style={{ width: 110 }}
                title="Higher is better: more accomplished = higher quality (e.g. loans, sales, reductions achieved). Lower is better: less is better, at or below target = 100% (e.g. overages, shortages, past-due count)."
              >
                Better when
              </th>
              <th style={{ width: 70 }} title="Quality target - enter 1 for 100% (fraction, like the paper form). Shown to users as a percentage.">
                Quality (1 = 100%)
              </th>
              <th style={{ width: 75 }}>Time</th>
              <th style={{ width: 75 }}>Weight</th>
              <th style={{ width: 110 }}>Status</th>
              <th style={{ width: 40 }}></th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((t, i) => (
              <tr
                key={t.id}
                className={dragIdx === i ? 'row-dragging' : ''}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  moveTask(dragIdx, i);
                  setDragIdx(null);
                }}
              >
                <td>
                  <span
                    className="drag-handle"
                    title="Drag to reorder"
                    draggable
                    onDragStart={() => setDragIdx(i)}
                    onDragEnd={() => setDragIdx(null)}
                  >
                    ⠿
                  </span>
                </td>
                <td>
                  <input type="checkbox" checked={selected.has(t.id)} onChange={() => toggleSelect(t.id)} />
                </td>
                <td>
                  <input defaultValue={t.code || ''} onBlur={(e) => saveField(t, 'code', e.target.value)} />
                </td>
                <td>
                  <input defaultValue={t.category || ''} onBlur={(e) => saveField(t, 'category', e.target.value)} />
                </td>
                <td>
                  <input defaultValue={t.name} onBlur={(e) => saveField(t, 'name', e.target.value)} />
                </td>
                <td>
                  <input defaultValue={t.unit || ''} onBlur={(e) => saveField(t, 'unit', e.target.value)} />
                </td>
                <td>
                  <input defaultValue={t.qty_target || ''} onBlur={(e) => saveField(t, 'qty_target', e.target.value)} />
                </td>
                <td>
                  <select value={t.direction || 'higher'} onChange={(e) => saveField(t, 'direction', e.target.value)}>
                    <option value="higher">Higher is better</option>
                    <option value="lower">Lower is better</option>
                  </select>
                </td>
                <td>
                  <input
                    placeholder="1"
                    title="1 = 100%"
                    defaultValue={t.quality_target || ''}
                    onBlur={(e) => saveField(t, 'quality_target', e.target.value)}
                  />
                </td>
                <td>
                  <select value={t.time_target || 'EOM'} onChange={(e) => saveField(t, 'time_target', e.target.value)}>
                    {['EOD', 'EOW', 'EOM', 'EOQ', 'EOS', 'EOY', 'ATC'].map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max="1"
                    defaultValue={t.weight}
                    onBlur={(e) => saveField(t, 'weight', e.target.value)}
                  />
                </td>
                <td>
                  {t.approved ? (
                    <span className="badge badge-green">approved</span>
                  ) : (
                    <button className="btn btn-small btn-primary" onClick={() => approveTasks([t.id])}>
                      Approve
                    </button>
                  )}
                </td>
                <td>
                  <button className="btn btn-small btn-danger" onClick={() => removeTask(t)}>
                    ✕
                  </button>
                </td>
              </tr>
            ))}
            {tasks.length === 0 && (
              <tr>
                <td colSpan={12} className="muted" style={{ textAlign: 'center', padding: 24 }}>
                  No tasks yet for {selectedUser?.full_name || 'this employee'}. Add tasks or copy from another employee/period.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {copying && (
        <Modal title="Copy tasks from…" onClose={() => setCopying(null)}>
          <form onSubmit={doCopy} className="form-grid">
            <label>
              Source employee
              <SearchSelect
                options={users.map((u) => ({ value: u.id, label: u.full_name, hint: u.department }))}
                value={copying.fromUserId}
                onChange={(v) => setCopying({ ...copying, fromUserId: v })}
                placeholder="Search employee…"
              />
            </label>
            <label>
              Source period
              <select value={copying.fromPeriodId} onChange={(e) => setCopying({ ...copying, fromPeriodId: e.target.value })}>
                {periods.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <p className="muted small">
              Tasks will be added to <strong>{selectedUser?.full_name}</strong> for the selected period above. Ratings are not copied.
            </p>
            <button className="btn btn-primary btn-block">Copy tasks</button>
          </form>
        </Modal>
      )}
    </div>
  );
}
