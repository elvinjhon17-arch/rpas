import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import Avatar from '../components/Avatar.jsx';
import Icon from '../components/Icon.jsx';
import Logo from '../components/Logo.jsx';
import DevCredit from '../components/DevCredit.jsx';

export default function Shell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const isAdmin = user.role === 'admin';

  const links = isAdmin
    ? [
        ['/admin/submissions', 'chart', 'Submissions'],
        ['/admin/employees', 'users', 'Employees'],
        ['/admin/tasks', 'clipboard', 'Task Setup'],
        ['/admin/factors', 'star', 'Critical Factors'],
        ['/admin/periods', 'calendar', 'Periods'],
        ['/admin/settings', 'sliders', 'Formula Settings'],
        ['/profile', 'user', 'My Profile']
      ]
    : [
        ['/', 'home', 'Dashboard'],
        ['/appraisal', 'file-text', 'My Appraisal'],
        ['/profile', 'user', 'My Profile']
      ];

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <span className="brand-logo">
            <Logo size={26} />
          </span>
          <span>RBLI RPAS</span>
        </div>
        <nav>
          {links.map(([to, icon, label]) => (
            <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
              <span className="nav-icon">
                <Icon name={icon} />
              </span>
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
        <DevCredit />
      </main>
    </div>
  );
}
