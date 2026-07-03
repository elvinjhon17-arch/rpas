const COLORS = ['#0d9488', '#7c3aed', '#db2777', '#d97706', '#2563eb', '#16a34a', '#dc2626'];

export default function Avatar({ user, size = 36 }) {
  const name = user?.full_name || '?';
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
  const color = COLORS[(name.charCodeAt(0) || 0) % COLORS.length];
  const style = { width: size, height: size, fontSize: size * 0.4 };

  return user?.avatar_url ? (
    <img className="avatar" src={user.avatar_url} alt={name} style={style} />
  ) : (
    <div className="avatar avatar-initials" style={{ ...style, background: color }}>
      {initials}
    </div>
  );
}
