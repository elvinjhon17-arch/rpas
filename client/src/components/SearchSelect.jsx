import { useEffect, useMemo, useRef, useState } from 'react';

// Searchable dropdown: type to filter, click or Enter to pick.
// options: [{ value, label, hint? }]
export default function SearchSelect({ options, value, onChange, placeholder = 'Search…', width }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [hi, setHi] = useState(0);
  const boxRef = useRef(null);
  const selected = options.find((o) => o.value === value) || null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => `${o.label} ${o.hint || ''}`.toLowerCase().includes(q));
  }, [options, query]);

  // close when clicking anywhere outside
  useEffect(() => {
    const close = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const pick = (o) => {
    onChange(o.value);
    setOpen(false);
    setQuery('');
  };

  return (
    <div className="search-select" ref={boxRef} style={width ? { width } : undefined}>
      <input
        value={open ? query : selected?.label || ''}
        placeholder={selected ? selected.label : placeholder}
        onFocus={() => {
          setOpen(true);
          setQuery('');
          setHi(0);
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setHi(0);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setOpen(false);
            setQuery('');
          } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            setHi((h) => Math.min(h + 1, filtered.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setHi((h) => Math.max(h - 1, 0));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            if (open && filtered[hi]) pick(filtered[hi]);
          }
        }}
      />
      {open && (
        <div className="search-select-menu">
          {filtered.map((o, i) => (
            <button
              type="button"
              key={o.value || '(none)'}
              className={`search-select-option ${i === hi ? 'hi' : ''} ${o.value === value ? 'on' : ''}`}
              onMouseEnter={() => setHi(i)}
              onClick={() => pick(o)}
            >
              <span>{o.label}</span>
              {o.hint && <span className="muted small">{o.hint}</span>}
            </button>
          ))}
          {!filtered.length && <div className="search-select-empty muted small">No match</div>}
        </div>
      )}
    </div>
  );
}
