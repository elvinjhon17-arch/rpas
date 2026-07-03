import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import Avatar from '../components/Avatar.jsx';

export default function Shell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const isAdmin = user.role === 'admin';

  const links = isAdmin
    ? [
        ['/admin/submissions', '📊', 'Submissions'],
        ['/admin/employees', '👥', 'Employees'],
        ['/admin/tasks', '🗂️', 'Task Setup'],
        ['/admin/factors', '⭐', 'Critical Factors'],
        ['/admin/periods', '📅', 'Periods'],
        ['/admin/settings', '⚙️', 'Formula Settings'],
        ['/profile', '👤', 'My Profile']
      ]
    : [
        ['/', '🏠', 'Dashboard'],
        ['/appraisal', '📝', 'My Appraisal'],
        ['/profile', '👤', 'My Profile']
      ];

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <span className="brand-badge">RBLI</span>
          <span>RPAS</span>
        </div>
        <nav>
          {links.map(([to, icon, label]) => (
            <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
              <span className="nav-icon">{icon}</span>
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-user" onClick={() => navigate('/profile')}>
          <Avatar user={user} size={38} />
          <div className="sidebar-user-info">
            <strong>{user.full_name}</strong>
            <span className="muted">{isAdmin ? 'Administrator' : user.position || 'Employee'}</span>
          </div>
        </div>
        <button
          className="btn btn-ghost btn-block"
          onClick={() => {
            logout();
            navigate('/login');
          }}
        >
          Sign out
        </button>
      </aside>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
