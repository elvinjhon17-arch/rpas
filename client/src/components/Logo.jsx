import { useState } from 'react';

// Rural Bank of Liloy (ZN), Inc. logo.
// Loads the real uploaded artwork from /logo.png (client/public/logo.png).
// If that file is missing it falls back to a simple mark so nothing looks
// broken - drop the PNG in client/public/logo.png to use the real logo.
export default function Logo({ size = 34, color = '#1d4ed8', className }) {
  const [failed, setFailed] = useState(false);

  if (!failed) {
    return (
      <img
        src="/logo.png"
        alt="Rural Bank of Liloy logo"
        height={size}
        className={className}
        style={{ height: size, width: 'auto', objectFit: 'contain', display: 'block' }}
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <svg
      width={size}
      height={Math.round(size * 1.18)}
      viewBox="0 0 100 118"
      fill={color}
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label="Rural Bank of Liloy logo"
    >
      <polygon points="50,6 88,44 88,58 50,20 12,58 12,44" />
      <polygon points="50,35 88,73 88,87 50,49 12,87 12,73" />
      <polygon points="50,64 88,102 88,116 50,78 12,116 12,102" />
    </svg>
  );
}
