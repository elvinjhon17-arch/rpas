import { useRef, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import Avatar from '../components/Avatar.jsx';

export default function Profile() {
  const { user, setUser } = useAuth();
  const fileRef = useRef(null);
  const [msg, setMsg] = useState(null);
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [busy, setBusy] = useState(false);

  const note = (type, text) => setMsg({ type, text });

  const uploadAvatar = async (file) => {
    if (!file) return;
    const formData = new FormData();
    formData.append('avatar', file);
    setBusy(true);
    try {
      const { user: updated } = await api(`/users/${user.id}/avatar`, { method: 'POST', formData });
      setUser(updated);
      note('success', 'Avatar updated!');
    } catch (e) {
      note('error', e.message);
    } finally {
      setBusy(false);
    }
  };

  const changePassword = async (e) => {
    e.preventDefault();
    if (pw.next !== pw.confirm) return note('error', 'New passwords do not match');
    setBusy(true);
    try {
      await api('/auth/password', { method: 'PUT', body: { currentPassword: pw.current, newPassword: pw.next } });
      setPw({ current: '', next: '', confirm: '' });
      note('success', 'Password changed!');
    } catch (e2) {
      note('error', e2.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="page-head">
        <h1>My Profile</h1>
      </div>
      {msg && <div className={`alert alert-${msg.type}`}>{msg.text}</div>}
      <div className="grid-2">
        <div className="card card-center">
          <Avatar user={user} size={110} />
          <h3>{user.full_name}</h3>
          <p className="muted">
            {user.position || 'Employee'}
            {user.department && ` · ${user.department}`}
          </p>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => uploadAvatar(e.target.files[0])} />
          <button className="btn btn-primary" disabled={busy} onClick={() => fileRef.current.click()}>
            {user.avatar_url ? 'Change photo' : 'Upload photo'}
          </button>
          <p className="muted small">JPG or PNG, max 3 MB</p>
        </div>
        <form className="card" onSubmit={changePassword}>
          <h3>Change Password</h3>
          <label>
            Current password
            <input type="password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
          </label>
          <label>
            New password (min 6 characters)
            <input type="password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
          </label>
          <label>
            Confirm new password
            <input type="password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />
          </label>
          <button className="btn btn-primary" disabled={busy || !pw.current || !pw.next}>
            Change password
          </button>
        </form>
      </div>
    </div>
  );
}
