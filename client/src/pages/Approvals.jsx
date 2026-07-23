import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { SkeletonTable } from '../components/Skeleton.jsx';

// Task approvals for accounts flagged as Approver (and admins). Lists every
// pending task grouped by employee; approve individually or per employee.
export default function Approvals() {
  const [tasks, setTasks] = useState(null);
  const [error, setError] = useState('');

  const load = () => {
    api('/tasks/pending')
      .then(({ tasks }) => setTasks(tasks))
      .catch((e) => setError(e.message));
  };
  useEffect(load, []);

  const approve = async (ids) => {
    if (!ids.length) return;
    try {
      await api('/tasks/approve', { method: 'POST', body: { ids } });
      setTasks((prev) => prev.filter((t) => !ids.includes(t.id)));
      setError('');
    } catch (e) {
      setError(e.message);
    }
  };

  if (error) return <div className="alert alert-error">{error}</div>;

  // group by employee
  const groups = [];
  for (const t of tasks || []) {
    const key = t.employee?.id || 'unknown';
    let g = groups.find((x) => x.key === key);
    if (!g) {
      g = { key, employee: t.employee, period: t.period, tasks: [] };
      groups.push(g);
    }
    g.tasks.push(t);
  }

  return (
    <div>
      <div className="page-head">
        <h1>Task Approvals</h1>
        {tasks && tasks.length > 0 && (
          <button className="btn btn-primary" onClick={() => approve(tasks.map((t) => t.id))}>
            Approve all ({tasks.length})
          </button>
        )}
      </div>

      {!tasks ? (
        <SkeletonTable rows={4} cols={3} />
      ) : tasks.length === 0 ? (
        <div className="card">
          <p className="muted" style={{ textAlign: 'center', padding: 20 }}>
            No tasks are waiting for approval. You are all caught up.
          </p>
        </div>
      ) : (
        groups.map((g) => (
          <div key={g.key} className="card">
            <div className="page-head" style={{ marginBottom: 10 }}>
              <div>
                <h3 style={{ margin: 0 }}>{g.employee?.full_name || 'Unknown employee'}</h3>
                <p className="muted small" style={{ margin: 0 }}>
                  {g.employee?.department} · {g.period}
                </p>
              </div>
              <button className="btn btn-small btn-primary" onClick={() => approve(g.tasks.map((t) => t.id))}>
                Approve all ({g.tasks.length})
              </button>
            </div>
            <table className="table">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Work / Activity</th>
                  <th style={{ width: 90 }}>Weight</th>
                  <th style={{ width: 110 }}></th>
                </tr>
              </thead>
              <tbody>
                {g.tasks.map((t) => (
                  <tr key={t.id}>
                    <td>{t.code || '—'}</td>
                    <td>{t.name}</td>
                    <td>{Number(t.weight).toFixed(2)}</td>
                    <td>
                      <button className="btn btn-small btn-primary" onClick={() => approve([t.id])}>
                        Approve
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))
      )}
    </div>
  );
}
