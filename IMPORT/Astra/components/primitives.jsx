// ============================================================
// SHARED UI PRIMITIVES
// ============================================================
const { useState, useEffect, useMemo, useRef, useCallback } = React;

// Score pill with color based on value 0-10
function scoreColor(v) {
  if (v === null || v === undefined) return 'var(--muted)';
  if (v >= 8.5) return 'var(--score-great)';
  if (v >= 7)   return 'var(--score-good)';
  if (v >= 5)   return 'var(--score-mid)';
  if (v >= 3)   return 'var(--score-meh)';
  return 'var(--score-bad)';
}

function ScorePill({ value, size = 'md' }) {
  const display = value === null || value === undefined ? '—' : value.toFixed(1);
  const cls = `score-pill score-pill--${size}`;
  return (
    <span className={cls} style={{ color: scoreColor(value), borderColor: scoreColor(value) }}>
      {display}
    </span>
  );
}

function ScoreBig({ value }) {
  const display = value === null || value === undefined ? '—' : value.toFixed(1);
  return (
    <div className="score-big" style={{ color: scoreColor(value) }}>
      <span className="score-big__val">{display}</span>
      <span className="score-big__max">/10</span>
    </div>
  );
}

// A compact 0-10 slider-style input with 0.1 increments
function ScoreInput({ value, onChange, label, weight, skipped, onToggleSkip }) {
  const v = value ?? null;
  const handleKey = (e) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
      e.preventDefault();
      const next = Math.min(10, (v ?? 0) + (e.shiftKey ? 1 : 0.1));
      onChange(Math.round(next * 10) / 10);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const next = Math.max(0, (v ?? 0) - (e.shiftKey ? 1 : 0.1));
      onChange(Math.round(next * 10) / 10);
    } else if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault();
      onChange(null);
    }
  };

  return (
    <div className={`score-input ${skipped ? 'is-skipped' : ''}`}>
      <div className="score-input__head">
        <span className="score-input__label">{label}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {weight !== undefined && <span className="score-input__weight">w{weight}</span>}
          {onToggleSkip && (
            <button
              className={`score-input__off ${skipped ? 'is-active' : ''}`}
              onClick={onToggleSkip}
              title="Exclude this section from this work's overall"
              type="button"
            >{skipped ? 'off' : 'on'}</button>
          )}
        </div>
      </div>
      <div className="score-input__row" style={{ opacity: skipped ? 0.4 : 1 }}>
        <input
          type="range" min="0" max="10" step="0.1"
          value={v ?? 0}
          disabled={skipped}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          style={{ accentColor: scoreColor(v) }}
        />
        <input
          className="score-input__num"
          type="number" min="0" max="10" step="0.1"
          value={v ?? ''}
          placeholder="—"
          disabled={skipped}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === '') onChange(null);
            else onChange(Math.max(0, Math.min(10, parseFloat(raw))));
          }}
          onKeyDown={handleKey}
          style={{ color: scoreColor(v), borderColor: v === null ? 'var(--border)' : scoreColor(v) }}
        />
        <button
          className="score-input__clear"
          onClick={() => onChange(null)}
          disabled={skipped}
          title="Clear value"
          type="button"
        >×</button>
      </div>
      <div className="score-input__ticks">
        {[0,1,2,3,4,5,6,7,8,9,10].map(n => (
          <span key={n} className={v !== null && Math.round(v) === n ? 'is-near' : ''}>{n}</span>
        ))}
      </div>
    </div>
  );
}

function Cover({ title, type, size = 'md', src, color }) {
  const hue = Math.abs(hashStr(title || '')) % 360;
  const bgStyle = src
    ? { background: color || `oklch(0.22 0.04 ${hue})` }
    : { background: `linear-gradient(135deg, oklch(0.35 0.03 ${hue}) 0%, oklch(0.22 0.04 ${(hue+40)%360}) 100%)` };
  return (
    <div className={`cover cover--${size} ${src ? 'cover--img' : ''}`} style={bgStyle}>
      {src && <img className="cover__img" src={src} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none'; }} />}
      {!src && <div className="cover__stripes" />}
      <div className="cover__meta">
        <span className="cover__type">{type}</span>
        <span className="cover__title">{title}</span>
      </div>
    </div>
  );
}

function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return h;
}

function Icon({ name, size = 16 }) {
  const paths = {
    search: <path d="M10 17a7 7 0 1 1 4.6-1.7l4.5 4.6-1.4 1.4-4.6-4.6A7 7 0 0 1 10 17Zm0-2a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z"/>,
    plus: <path d="M11 4h2v7h7v2h-7v7h-2v-7H4v-2h7z"/>,
    close: <path d="M6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12 19 6.4 17.6 5 12 10.6z"/>,
    chevron: <path d="M8 6l6 6-6 6"/>,
    edit: <path d="M14.7 3.3l6 6L8.4 21.6 2 22l.4-6.4zM16.1 1.9l6 6 2.6-2.6a2 2 0 0 0 0-2.8L22.3-.8a2 2 0 0 0-2.8 0z"/>,
    trash: <path d="M6 7h12l-1 14H7zM9 4h6l1 2h5v2H3V6h5z"/>,
    filter: <path d="M3 5h18v2l-7 8v6l-4-2v-4L3 7z"/>,
    star: <path d="M12 2l3 7 7 1-5 5 1 7-6-4-6 4 1-7-5-5 7-1z"/>,
    grid: <path d="M3 3h8v8H3zm10 0h8v8h-8zM3 13h8v8H3zm10 0h8v8h-8z"/>,
    list: <path d="M3 5h18v2H3zm0 6h18v2H3zm0 6h18v2H3z"/>,
    settings: <path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm9 4a9 9 0 0 0-.2-1.8l2-1.6-2-3.4-2.4.8a9 9 0 0 0-3.2-1.8L15 2h-6l-.4 2.2a9 9 0 0 0-3.2 1.8l-2.4-.8-2 3.4 2 1.6a9 9 0 0 0 0 3.6l-2 1.6 2 3.4 2.4-.8a9 9 0 0 0 3.2 1.8L9 22h6l.4-2.2a9 9 0 0 0 3.2-1.8l2.4.8 2-3.4-2-1.6c.1-.6.2-1.2.2-1.8z"/>,
    download: <path d="M12 3v12l5-5 1.4 1.4L12 17.8 5.6 11.4 7 10l5 5V3zM4 19h16v2H4z"/>,
    upload: <path d="M12 21V9l-5 5-1.4-1.4L12 6.2l6.4 6.4L17 14l-5-5v12zM4 3h16v2H4z"/>,
    back: <path d="M20 11H7.8l5.6-5.6L12 4l-8 8 8 8 1.4-1.4L7.8 13H20z"/>,
    check: <path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/>,
    calendar: <path d="M7 2v2H3v18h18V4h-4V2h-2v2H9V2zm12 6v12H5V8z"/>,
    tag: <path d="M10 2H2v8l12 12 8-8zM6.5 7A1.5 1.5 0 1 1 5 5.5 1.5 1.5 0 0 1 6.5 7z"/>,
    compare: <path d="M3 3h8v18H3zm10 0h8v18h-8zM5 5v14h4V5zm10 0v14h4V5z"/>,
    link: <path d="M10.6 13.4a4 4 0 0 1 0-5.6l3-3a4 4 0 0 1 5.6 5.6l-1.4 1.4-1.4-1.4 1.4-1.4a2 2 0 0 0-2.8-2.8l-3 3a2 2 0 0 0 0 2.8zm2.8-2.8a4 4 0 0 1 0 5.6l-3 3a4 4 0 0 1-5.6-5.6l1.4-1.4 1.4 1.4-1.4 1.4a2 2 0 0 0 2.8 2.8l3-3a2 2 0 0 0 0-2.8z"/>,
    spinner: <path d="M12 2a10 10 0 0 1 10 10h-2a8 8 0 0 0-8-8z"/>,
    drag: <path d="M9 4h2v2H9zm4 0h2v2h-2zM9 10h2v2H9zm4 0h2v2h-2zM9 16h2v2H9zm4 0h2v2h-2z"/>,
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className="icon">
      {paths[name]}
    </svg>
  );
}

Object.assign(window, {
  ScorePill, ScoreBig, ScoreInput, Cover, Icon, scoreColor, hashStr,
});
