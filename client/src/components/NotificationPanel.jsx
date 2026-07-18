import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { pickPeriod } from '../period.js';
import { useAuth } from '../auth.jsx';
import Icon from './Icon.jsx';

// Floating bell on the right edge of every page. Opens a slide-out panel with
// actionable reminders plus a detailed progress feed: employees see how far
// each of their raters has come; raters see each ratee's activity.
export default function NotificationPanel() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [periodId, setPeriodId] = useState('');
  const [data, setData] = useState(null);
  const [freshKeys, setFreshKeys] = useState([]); // unread at the moment the panel opened

  const refresh = (pid = periodId) => {
    if (!pid) return;
    api(`/notifications?periodId=${pid}`)
      .then(setData)
      .catch(() => {});
  };

  useEffect(() => {
    if (user.role === 'admin') return;
    api('/periods')
      .then(({ periods }) => {
        const pid = pickPeriod(periods);
        if (pid) {
          setPeriodId(pid);
          refresh(pid);
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // keep fresh when the user returns to the tab
  useEffect(() => {
    if (user.role === 'admin') return;
    const onFocus = () => document.visibilityState === 'visible' && refresh();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodId, user.role]);

  if (user.role === 'admin') return null;

  // ----- derive actionable reminders (each with a stable key for unread tracking) -----
  const reminders = [];
  const mine = data?.mine;
  if (mine) {
    const missing = mine.tasksTotal - mine.accompDone;
    if (missing > 0) {
      reminders.push({
        key: 'accomp-self',
        to: '/appraisal',
        text: `Enter your accomplishments for ${missing} task(s) - your supervisor cannot rate them until you do.`
      });
    }
  }
  for (const r of data?.ratees || []) {
    if (r.raterType === 'supervisor') {
      if (r.status !== 'submitted') {
        const ratable = (r.accompDoneInScope ?? 0) - (r.myRated ?? 0);
        if (ratable > 0)
          reminders.push({ key: `rate:${r.user.id}`, to: `/rate/supervisor/${r.user.id}`, text: `Rate ${ratable} task(s) for ${r.user.full_name}.` });
        const waiting = (r.myScope ?? 0) - (r.accompDoneInScope ?? 0);
        if (waiting > 0)
          reminders.push({ key: `wait:${r.user.id}`, to: `/rate/supervisor/${r.user.id}`, text: `Waiting for ${r.user.full_name} to enter accomplishments on ${waiting} task(s).` });
        if (r.ratesPart2 && (r.factorsTotal ?? 0) - (r.factorsRated ?? 0) > 0) {
          reminders.push({ key: `factors:${r.user.id}`, to: `/rate/supervisor/${r.user.id}`, text: `Rate ${r.factorsTotal - r.factorsRated} critical factor(s) for ${r.user.full_name}.` });
        }
        if (ratable === 0 && waiting === 0 && (!r.ratesPart2 || (r.factorsRated ?? 0) >= (r.factorsTotal ?? 0))) {
          reminders.push({ key: `submit:${r.user.id}`, to: `/rate/supervisor/${r.user.id}`, text: `Everything is rated for ${r.user.full_name} - review and submit.` });
        }
      }
    } else if (r.status !== 'submitted') {
      reminders.push({ key: `page3:${r.raterType}:${r.user.id}`, to: '/', text: `Enter your ${r.raterLabel} for ${r.user.full_name}.` });
    }
  }

  // ----- unread: reminders whose key the user has not seen yet -----
  const seenKey = `rpas_seen_notifs_${user.id}`;
  let seen = [];
  try {
    seen = JSON.parse(localStorage.getItem(seenKey) || '[]');
  } catch {
    seen = [];
  }
  const unread = reminders.filter((r) => !seen.includes(r.key));

  const openPanel = () => {
    const next = !open;
    setOpen(next);
    if (next) {
      refresh();
      // remember which were new so the panel can tag them, then mark all read
      setFreshKeys(unread.map((r) => r.key));
      localStorage.setItem(seenKey, JSON.stringify(reminders.map((r) => r.key)));
    }
  };

  return (
    <>
      <button
        className={`notif-bell ${unread.length > 0 ? 'notif-bell-alert' : ''}`}
        title="Reminders & progress"
        onClick={openPanel}
      >
        <Icon name="bell" size={20} />
        {unread.length > 0 && <span className="notif-badge">{unread.length}</span>}
      </button>

      {open && (
        <div className="notif-panel">
          <div className="notif-head">
            <strong>Reminders & progress</strong>
            <button className="btn btn-ghost btn-small" onClick={() => setOpen(false)}>
              ✕
            </button>
          </div>

          <div className="notif-section">
            <h4>Reminders</h4>
            {reminders.length === 0 && <p className="muted small">Nothing pending - you are all caught up.</p>}
            {reminders.map((r) => (
              <Link key={r.key} to={r.to} className="notif-item" onClick={() => setOpen(false)}>
                {r.text}
                {freshKeys.includes(r.key) && <span className="badge badge-amber notif-new">new</span>}
              </Link>
            ))}
          </div>

          {mine && (
            <div className="notif-section">
              <h4>My appraisal</h4>
              <div className="notif-row">
                <span>My accomplishments entered</span>
                <strong>
                  {mine.accompDone}/{mine.tasksTotal}
                </strong>
              </div>
              <div className="notif-row">
                <span>Tasks rated by supervisor</span>
                <strong>
                  {mine.supervisorRated}/{mine.tasksTotal}
                </strong>
              </div>
              <div className="notif-row">
                <span>Critical factors rated</span>
                <strong>
                  {mine.factorsRated}/{mine.factorsTotal}
                </strong>
              </div>
              {mine.raters.map((r) => (
                <div key={r.type} className="notif-row">
                  <span>{r.label}</span>
                  {r.status === 'submitted' ? (
                    <span className="badge badge-green" title={r.submitted_at && new Date(r.submitted_at).toLocaleString()}>
                      submitted
                    </span>
                  ) : (
                    <span className="badge badge-slate">pending</span>
                  )}
                </div>
              ))}
            </div>
          )}

          {(data?.ratees || []).length > 0 && (
            <div className="notif-section">
              <h4>My ratees</h4>
              {(data.ratees || []).map((r, i) => (
                <div key={i} className="notif-ratee">
                  <div className="notif-row">
                    <strong>{r.user.full_name}</strong>
                    <span className="muted small">{r.raterLabel}</span>
                  </div>
                  {r.raterType === 'supervisor' ? (
                    <>
                      <div className="notif-row small">
                        <span>Their accomplishments entered</span>
                        <span>
                          {r.accompDone}/{r.tasksTotal}
                        </span>
                      </div>
                      <div className="notif-row small">
                        <span>My tasks rated</span>
                        <span>
                          {r.myRated}/{r.myScope}
                        </span>
                      </div>
                      {r.ratesPart2 && (
                        <div className="notif-row small">
                          <span>Critical factors rated</span>
                          <span>
                            {r.factorsRated}/{r.factorsTotal}
                          </span>
                        </div>
                      )}
                    </>
                  ) : null}
                  <div className="notif-row small">
                    <span>My rating status</span>
                    {r.status === 'submitted' ? (
                      <span className="badge badge-green">submitted</span>
                    ) : (
                      <span className="badge badge-amber">draft</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}
