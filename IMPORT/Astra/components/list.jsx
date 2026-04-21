// ============================================================
// LIST VIEW — main screen
// Each row has its own per-part selector when the work has >1 parts.
// 'avg' shows the series average; individual part shows that part's scores.
// ============================================================

function ListView({ state, dispatch, onOpen, onAdd }) {
  const { works, sections, view, filter, sort } = state;

  const enriched = useMemo(() => works.map(w => {
    const overall = calcSeriesOverall(w, sections);
    const latestSeason = w.seasons[w.seasons.length - 1];
    return { ...w, overall, latestSeason };
  }), [works, sections]);

  const filtered = useMemo(() => {
    let list = enriched;
    if (filter.type !== 'both' && filter.type !== 'all') list = list.filter(w => w.type === filter.type);
    if (filter.status !== 'all') list = list.filter(w => w.status === filter.status);
    if (filter.q) {
      const q = filter.q.toLowerCase();
      list = list.filter(w =>
        w.title.toLowerCase().includes(q) ||
        w.tags.some(t => t.toLowerCase().includes(q))
      );
    }
    list = [...list].sort((a, b) => {
      if (sort === 'score-desc') return (b.overall ?? -1) - (a.overall ?? -1);
      if (sort === 'score-asc')  return (a.overall ?? 99) - (b.overall ?? 99);
      if (sort === 'title')      return a.title.localeCompare(b.title);
      if (sort === 'recent') {
        const ad = a.latestSeason?.endDate || a.latestSeason?.startDate || '';
        const bd = b.latestSeason?.endDate || b.latestSeason?.startDate || '';
        return bd.localeCompare(ad);
      }
      return 0;
    });
    return list;
  }, [enriched, filter, sort]);

  const stats = useMemo(() => {
    const rated = enriched.filter(w => w.overall !== null);
    const avg = rated.length ? (rated.reduce((a, b) => a + b.overall, 0) / rated.length) : 0;
    return {
      total: enriched.length,
      rated: rated.length,
      avg: Math.round(avg * 10) / 10,
      top: [...rated].sort((a, b) => b.overall - a.overall)[0],
    };
  }, [enriched]);

  return (
    <div className="list-view">
      <header className="list-head">
        <div className="list-head__left">
          <h1 className="app-title">Astra<span className="app-title__dot">.</span></h1>
          <div className="list-stats">
            <span><strong>{stats.total}</strong> works</span>
            <span className="dot">·</span>
            <span><strong>{stats.rated}</strong> rated</span>
            <span className="dot">·</span>
            <span>avg <strong style={{ color: scoreColor(stats.avg) }}>{stats.avg.toFixed(1)}</strong></span>
            {stats.top && <>
              <span className="dot">·</span>
              <span className="muted">top: {stats.top.title}</span>
            </>}
          </div>
        </div>
        <div className="list-head__right">
          <button className="btn btn--ghost" onClick={() => dispatch({ type: 'openSettings' })}>
            <Icon name="settings" /> Sections & weights
          </button>
          <button className="btn btn--primary" onClick={onAdd}>
            <Icon name="plus" /> New entry
          </button>
        </div>
      </header>

      <div className="list-toolbar">
        <div className="list-search">
          <Icon name="search" />
          <input
            placeholder="Search titles, tags…"
            value={filter.q}
            onChange={(e) => dispatch({ type: 'filter', key: 'q', val: e.target.value })}
          />
        </div>
        <div className="chip-group">
          {['both','anime','manga'].map(t => (
            <button
              key={t}
              className={`chip ${filter.type === t ? 'is-active' : ''}`}
              onClick={() => dispatch({ type: 'filter', key: 'type', val: t })}
            >{t}</button>
          ))}
        </div>
        <div className="chip-group">
          {['all','watching','completed','paused','dropped','plan'].map(s => (
            <button
              key={s}
              className={`chip ${filter.status === s ? 'is-active' : ''}`}
              onClick={() => dispatch({ type: 'filter', key: 'status', val: s })}
            >{s}</button>
          ))}
        </div>
        <div className="spacer" />
        <select className="select" value={sort} onChange={(e) => dispatch({ type: 'sort', val: e.target.value })}>
          <option value="score-desc">Highest rated</option>
          <option value="score-asc">Lowest rated</option>
          <option value="title">A → Z</option>
          <option value="recent">Recently watched</option>
        </select>
        <div className="view-toggle">
          <button className={view === 'table' ? 'is-active' : ''} onClick={() => dispatch({ type: 'setView', val: 'table' })}><Icon name="list" /></button>
          <button className={view === 'grid' ? 'is-active' : ''} onClick={() => dispatch({ type: 'setView', val: 'grid' })}><Icon name="grid" /></button>
        </div>
      </div>

      {view === 'table' && <TableList items={filtered} sections={sections} onOpen={onOpen} />}
      {view === 'grid' && <GridList items={filtered} sections={sections} onOpen={onOpen} />}

      {filtered.length === 0 && (
        <div className="empty">
          <p>No works match these filters.</p>
        </div>
      )}
    </div>
  );
}

// Per-row component so each row can independently track selectedSeasonId
function WorkRow({ w, idx, sections, onOpen }) {
  // '__avg__' = show series average; otherwise a season id
  const [selId, setSelId] = useState('__avg__');
  const multiPart = w.seasons.length > 1;

  // Derive the score data to display
  const { displayScores, displaySkip, displayOverall } = useMemo(() => {
    if (!multiPart || selId === '__avg__') {
      return {
        displayScores: null, // signal: show per-section avg
        displaySkip: null,
        displayOverall: w.overall,
      };
    }
    const s = w.seasons.find(s => s.id === selId) || w.seasons[w.seasons.length - 1];
    return {
      displayScores: s.scores,
      displaySkip: s.skip,
      displayOverall: calcOverall(s.scores, sections, s.skip),
    };
  }, [selId, w, sections, multiPart]);

  const stopProp = (e) => e.stopPropagation();

  return (
    <tr key={w.id} onClick={() => onOpen(w.id)}>
      <td className="col-rank muted">{idx + 1}</td>
      <td className="col-title">
        <div className="title-cell">
          <Cover title={w.title} type={w.type} size="xs" src={w.cover} color={w.coverColor} />
          <div>
            <div className="title-cell__name">{w.title}</div>
            {multiPart ? (
              <div className="title-cell__sub" onClick={stopProp}>
                <select
                  className="part-sel"
                  value={selId}
                  onChange={(e) => setSelId(e.target.value)}
                >
                  <option value="__avg__">avg ({w.seasons.length} parts)</option>
                  {w.seasons.map(s => (
                    <option key={s.id} value={s.id}>{s.label}</option>
                  ))}
                </select>
              </div>
            ) : (
              <div className="title-cell__sub">{w.seasons[0]?.label}</div>
            )}
          </div>
        </div>
      </td>
      <td className="col-type"><span className="type-tag">{w.type}</span></td>
      <td className="col-overall"><ScorePill value={displayOverall} /></td>
      {sections.map(s => {
        // In avg mode, show series average per section
        let v = null, skipped = false;
        if (!multiPart || selId === '__avg__') {
          if (multiPart) {
            // average of non-skipped, non-null values across seasons
            const vals = w.seasons
              .filter(sea => !new Set(sea.skip || []).has(s.id))
              .map(sea => sea.scores?.[s.id])
              .filter(x => x != null && x !== 0);
            v = vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 : null;
          } else {
            const sea = w.seasons[0];
            const sk = new Set(sea?.skip || []);
            skipped = sk.has(s.id);
            v = sea?.scores?.[s.id] ?? null;
          }
        } else {
          const skipSet = new Set(displaySkip || []);
          skipped = skipSet.has(s.id);
          v = displayScores?.[s.id] ?? null;
        }
        return (
          <td key={s.id} className="col-score">
            {skipped
              ? <span className="muted" title="Off for this work">—</span>
              : v == null
                ? <span className="muted">—</span>
                : <span style={{ color: scoreColor(v) }}>{v.toFixed(1)}</span>}
          </td>
        );
      })}
      <td className="col-status"><span className={`status status--${w.status}`}>{w.status}</span></td>
      <td className="col-date muted">{fmtDate(w.latestSeason?.endDate || w.latestSeason?.startDate)}</td>
    </tr>
  );
}

function TableList({ items, sections, onOpen }) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th className="col-rank">#</th>
            <th className="col-title">Title</th>
            <th className="col-type">Type</th>
            <th className="col-overall">Overall</th>
            {sections.map(s => <th key={s.id} className="col-score">{s.name}</th>)}
            <th className="col-status">Status</th>
            <th className="col-date">Last activity</th>
          </tr>
        </thead>
        <tbody>
          {items.map((w, i) => (
            <WorkRow key={w.id} w={w} idx={i} sections={sections} onOpen={onOpen} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function GridCard({ w, sections, onOpen }) {
  const multiPart = w.seasons.length > 1;
  const [selId, setSelId] = useState('__avg__');

  const { displayScores, displaySkip, displayOverall } = useMemo(() => {
    if (!multiPart || selId === '__avg__') {
      return { displayScores: w.latestSeason?.scores, displaySkip: w.latestSeason?.skip, displayOverall: w.overall };
    }
    const s = w.seasons.find(s => s.id === selId) || w.seasons[w.seasons.length - 1];
    return { displayScores: s.scores, displaySkip: s.skip, displayOverall: calcOverall(s.scores, sections, s.skip) };
  }, [selId, w, sections, multiPart]);

  return (
    <div className="grid-card">
      <div onClick={() => onOpen(w.id)} style={{ cursor: 'pointer' }}>
        <Cover title={w.title} type={w.type} size="lg" src={w.cover} color={w.coverColor} />
      </div>
      <div className="grid-card__body">
        <div className="grid-card__top">
          <div onClick={() => onOpen(w.id)} style={{ cursor: 'pointer', flex: 1 }}>
            <div className="grid-card__title">{w.title}</div>
            <div className="grid-card__sub">
              <span className="type-tag">{w.type}</span>
            </div>
          </div>
          <ScoreBig value={displayOverall} />
        </div>
        {multiPart && (
          <select
            className="part-sel"
            value={selId}
            onChange={(e) => setSelId(e.target.value)}
            style={{ marginBottom: 6 }}
          >
            <option value="__avg__">avg ({w.seasons.length} parts)</option>
            {w.seasons.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        )}
        <MiniRadar scores={displayScores || {}} sections={sections} skip={displaySkip} />
      </div>
    </div>
  );
}

function GridList({ items, sections, onOpen }) {
  return (
    <div className="grid-list">
      {items.map(w => (
        <GridCard key={w.id} w={w} sections={sections} onOpen={onOpen} />
      ))}
    </div>
  );
}

function MiniRadar({ scores, sections, skip }) {
  const skipSet = new Set(skip || []);
  const enabled = sections.filter(s => !skipSet.has(s.id));
  const n = enabled.length;
  if (n < 3) return null;
  const cx = 60, cy = 50, r = 40;
  const points = enabled.map((s, i) => {
    const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
    const v = scores[s.id];
    const norm = v == null ? 0 : v / 10;
    return `${cx + Math.cos(angle) * r * norm},${cy + Math.sin(angle) * r * norm}`;
  }).join(' ');
  const grid = [0.25, 0.5, 0.75, 1].map(pct => {
    const ring = enabled.map((_, i) => {
      const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
      return `${cx + Math.cos(angle) * r * pct},${cy + Math.sin(angle) * r * pct}`;
    }).join(' ');
    return <polygon key={pct} points={ring} fill="none" stroke="var(--border)" strokeWidth="0.5" />;
  });
  return (
    <svg className="mini-radar" viewBox="0 0 120 100">
      {grid}
      <polygon points={points} fill="var(--accent-a20)" stroke="var(--accent)" strokeWidth="1.2" />
      {enabled.map((s, i) => {
        const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
        const lx = cx + Math.cos(angle) * (r + 8);
        const ly = cy + Math.sin(angle) * (r + 8);
        return <text key={s.id} x={lx} y={ly} className="mini-radar__label" textAnchor="middle" dominantBaseline="middle">{s.name[0]}</text>;
      })}
    </svg>
  );
}

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleDateString('en', { day: 'numeric', month: 'short', year: 'numeric' });
}

Object.assign(window, { ListView, fmtDate });
