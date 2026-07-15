// Centered popup message (blocking, dismissed with OK or clicking outside).
export default function Notice({ title, message, variant = 'info', onClose }) {
  return (
    <div className="notice-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`notice-box notice-${variant}`}>
        <div className="notice-icon">{variant === 'warn' ? '!' : 'i'}</div>
        {title && <h3>{title}</h3>}
        <p>{message}</p>
        <button className="btn btn-primary" onClick={onClose} autoFocus>
          OK
        </button>
      </div>
    </div>
  );
}
