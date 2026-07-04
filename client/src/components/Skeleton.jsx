// Shimmer skeleton placeholders shown while data loads.
export function Skeleton({ w = '100%', h = 16, r = 8, className = '', style = {} }) {
  return <div className={`skeleton ${className}`} style={{ width: w, height: h, borderRadius: r, ...style }} />;
}

// A few stacked text lines; the last is shorter to look natural.
export function SkeletonText({ lines = 3, gap = 10 }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap }}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} h={13} w={i === lines - 1 ? '55%' : '100%'} />
      ))}
    </div>
  );
}

// Card-shaped skeletons in the app's card style.
export function SkeletonCards({ count = 2 }) {
  return (
    <div className="grid-2">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="card">
          <Skeleton w="45%" h={16} style={{ marginBottom: 16 }} />
          <SkeletonText lines={4} />
        </div>
      ))}
    </div>
  );
}

// A table placeholder matching the .table look.
export function SkeletonTable({ rows = 6, cols = 5 }) {
  return (
    <div className="card">
      <div className="skeleton-row" style={{ marginBottom: 14 }}>
        {Array.from({ length: cols }).map((_, c) => (
          <Skeleton key={c} h={11} w={c === 0 ? '22%' : '12%'} />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="skeleton-row">
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} h={14} w={c === 0 ? '22%' : '12%'} />
          ))}
        </div>
      ))}
    </div>
  );
}

// Generic page placeholder: title + optional cards/table.
export function SkeletonPage({ variant = 'cards' }) {
  return (
    <div>
      <div className="page-head">
        <Skeleton w={220} h={26} />
        <Skeleton w={140} h={34} r={9} />
      </div>
      {variant === 'table' ? <SkeletonTable /> : <SkeletonCards />}
    </div>
  );
}
