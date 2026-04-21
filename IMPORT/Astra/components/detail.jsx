// ============================================================
// DETAIL VIEW — single work with seasons/episodes
// SETTINGS — sections & weights editor (global defaults)
// ============================================================

function DetailView({ state, workId, onClose, onEdit, onAddSeason, dispatch }) {
  const work = state.works.find(w => w.id === workId);
  if (!work) return null;
  const { sections } = state;

  const seriesOverall = calcSeriesOverall(work, sections);
  const [openSeasonId, setOpenSeasonId] = useState(work.seasons[work.seasons.length - 1]?.id);
  const openSeason = work.seasons.find(s => s.id === openSeasonId);
  const seasonOverall = openSeason ? calcOverall(openSeason.scores, sections, openSeason.skip) : null;
  const skipSet = new Set(openSeason?.skip || []);

  return (
    <div className="detail-view">
      <header className="detail-hero">
        <button className="btn btn--ghost btn--back" onClick={onClose}><Icon name="back" /> Back</button>
        <Cover title={work.title} type={work.type} size="xl" src={work.cover} color={work.coverColor} />
        <div className="detail-hero__body">
          <div className="detail-hero__meta">
            <span className="type-tag">{work.type}</span>
            <span className={`status status--${work.status}`}>{work.status}</span>
            {work.tags.map(t => <span key={t} className="tag-chip"><Icon name="tag" size={10} /> {t}</span>)}
            {work.anilistUrl && (
              <a className="tag-chip" href={work.anilistUrl} target="_blank" rel="noreferrer">
                <Icon name="link" size={10} /> anilist
              </a>
            )}
          </div>
          <h1 className="detail-hero__title">{work.title}</h1>
          <div className="detail-hero__stats">
            <div>
              <span className="muted">Series overall</span>
              <ScoreBig value={seriesOverall} />
            </div>
            <div>
              <span className="muted">Parts</span>
              <div className="stat-num">{work.seasons.length}</div>
            </div>
            <div>
              <span className="muted">Rated sections</span>
              <div className="stat-num">
                {sections.filter(s => !skipSet.has(s.id) && openSeason?.scores?.[s.id] != null).length}
                <span className="muted">/{sections.filter(s => !skipSet.has(s.id)).length}</span>
              </div>
            </div>
          </div>
          <div className="detail-hero__actions">
            <button className="btn btn--primary" onClick={() => onEdit(work.id, openSeasonId)}>
              <Icon name="edit" /> Edit this part
            </button>
            <button className="btn btn--ghost" onClick={() => onAddSeason(work.id)}>
              <Icon name="plus" /> Add part
            </button>
            <button className="btn btn--danger-ghost" onClick={() => {
              if (confirm(`Delete "${work.title}"?`)) { dispatch({ type: 'deleteWork', id: work.id }); onClose(); }
            }}>
              <Icon name="trash" /> Delete
            </button>
          </div>
        </div>
      </header>

      <div className="detail-body">
        <aside className="season-rail">
          <div className="rail-head">Parts</div>
          {work.seasons.map(s => {
            const ov = calcOverall(s.scores, sections, s.skip);
            return (
              <button
                key={s.id}
                className={`season-chip ${openSeasonId === s.id ? 'is-active' : ''}`}
                onClick={() => setOpenSeasonId(s.id)}
              >
                <div className="season-chip__label">{s.label}</div>
                <div className="season-chip__score" style={{ color: scoreColor(ov) }}>
                  {ov == null ? '—' : ov.toFixed(1)}
                </div>
              </button>
            );
          })}
          <button className="season-add" onClick={() => onAddSeason(work.id)}>
            <Icon name="plus" /> New part
          </button>
        </aside>

        <section className="season-panel">
          {openSeason && (
            <>
              <div className="panel-head">
                <div>
                  <h2>{openSeason.label}</h2>
                  <div className="muted">
                    {fmtDate(openSeason.startDate)} → {fmtDate(openSeason.endDate)}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <ScoreBig value={seasonOverall} />
                  <button className="btn btn--danger-ghost btn--sm" onClick={() => {
                    if (work.seasons.length === 1) {
                      if (confirm(`This is the only part — deleting it will remove "${work.title}" entirely. Continue?`)) {
                        dispatch({ type: 'deleteWork', id: work.id });
                        onClose();
                      }
                    } else {
                      if (confirm(`Delete part "${openSeason.label}" from "${work.title}"?`)) {
                        const nextSeason = work.seasons.find(s => s.id !== openSeason.id);
                        dispatch({ type: 'deleteSeason', workId: work.id, seasonId: openSeason.id });
                        setOpenSeasonId(nextSeason?.id);
                      }
                    }
                  }}>
                    <Icon name="trash" size={14} /> Delete part
                  </button>
                </div>
              </div>

              <div className="panel-grid">
                <div className="panel-radar">
                  <BigRadar scores={openSeason.scores} sections={sections} skip={openSeason.skip} />
                </div>
                <div className="panel-breakdown">
                  {sections.map(s => {
                    const v = openSeason.scores?.[s.id];
                    const isSkipped = skipSet.has(s.id);
                    const pct = v == null || isSkipped ? 0 : (v / 10) * 100;
                    return (
                      <div key={s.id} className={`breakdown-row ${isSkipped ? 'is-skipped' : ''}`}>
                        <span className="breakdown-row__label">
                          {s.name} <span className="muted">w{s.weight}</span>
                        </span>
                        <div className="breakdown-row__bar">
                          <div className="breakdown-row__fill" style={{
                            width: `${pct}%`, background: scoreColor(v),
                            opacity: isSkipped || v == null ? 0.1 : 1,
                          }} />
                        </div>
                        <span className="breakdown-row__val" style={{ color: isSkipped ? 'var(--muted)' : scoreColor(v) }}>
                          {isSkipped ? 'off' : v == null ? '—' : v.toFixed(1)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {openSeason.notes && (
                <div className="panel-notes">
                  <div className="muted" style={{ marginBottom: 6 }}>Notes</div>
                  {openSeason.notes}
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function BigRadar({ scores, sections, skip }) {
  const skipSet = new Set(skip || []);
  const enabled = sections.filter(s => !skipSet.has(s.id));
  const n = enabled.length;
  if (n < 3) return <div className="muted">Need at least 3 active sections to show the chart.</div>;
  const cx = 150, cy = 150, r = 110;
  const points = enabled.map((s, i) => {
    const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
    const v = scores?.[s.id];
    const norm = v == null ? 0 : v / 10;
    return `${cx + Math.cos(angle) * r * norm},${cy + Math.sin(angle) * r * norm}`;
  }).join(' ');
  const rings = [0.25, 0.5, 0.75, 1].map(pct => {
    const pts = enabled.map((_, i) => {
      const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
      return `${cx + Math.cos(angle) * r * pct},${cy + Math.sin(angle) * r * pct}`;
    }).join(' ');
    return <polygon key={pct} points={pts} fill="none" stroke="var(--border)" strokeWidth="0.8" />;
  });
  return (
    <svg viewBox="0 0 300 300" className="big-radar">
      {rings}
      {enabled.map((_, i) => {
        const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
        return <line key={i} x1={cx} y1={cy}
          x2={cx + Math.cos(angle) * r}
          y2={cy + Math.sin(angle) * r}
          stroke="var(--border)" strokeWidth="0.5" />;
      })}
      <polygon points={points} fill="var(--accent-a20)" stroke="var(--accent)" strokeWidth="1.8" />
      {enabled.map((s, i) => {
        const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
        const lx = cx + Math.cos(angle) * (r + 20);
        const ly = cy + Math.sin(angle) * (r + 20);
        const v = scores?.[s.id];
        return (
          <g key={s.id}>
            <text x={lx} y={ly - 4} textAnchor="middle" className="radar-label">{s.name}</text>
            <text x={lx} y={ly + 10} textAnchor="middle" className="radar-val" style={{ fill: scoreColor(v) }}>
              {v == null ? '—' : v.toFixed(1)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ============================================================
// SETTINGS MODAL — sections editor (global defaults)
// No enable/disable toggle: sections live here, skipping is per-work.
// ============================================================
function SettingsModal({ state, dispatch, onClose }) {
  const [sections, setSections] = useState(state.sections.map(s => ({ ...s })));
  const [newName, setNewName] = useState('');

  const update = (id, patch) => setSections(sections.map(s => s.id === id ? { ...s, ...patch } : s));
  const remove = (id) => setSections(sections.filter(s => s.id !== id));
  const add = () => {
    if (!newName.trim()) return;
    setSections([...sections, {
      id: 'sec_' + Math.random().toString(36).slice(2, 6),
      name: newName.trim(), weight: 1,
    }]);
    setNewName('');
  };
  const move = (idx, dir) => {
    const j = idx + dir;
    if (j < 0 || j >= sections.length) return;
    const next = [...sections];
    [next[idx], next[j]] = [next[j], next[idx]];
    setSections(next);
  };

  const save = () => {
    // Strip any legacy `enabled` field that may still be on persisted data
    const clean = sections.map(({ enabled, ...rest }) => rest);
    dispatch({ type: 'setSections', sections: clean });
    onClose();
  };

  return (
    <div className="modal-shell" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal__head">
          <h2>Sections & weights</h2>
          <button className="icon-btn" onClick={onClose}><Icon name="close" /></button>
        </header>
        <div className="modal__body">
          <p className="hint" style={{ marginBottom: 16 }}>
            Global sections and their weights. Overall ={' '}
            <code>Σ(score × weight) / Σ(weight)</code>. To exclude a section for a specific work
            (e.g. a season without a finale), use the <kbd>off</kbd> toggle on its rating form —
            it doesn't affect other works.
          </p>

          <div className="sections-editor">
            {sections.map((s, i) => (
              <div key={s.id} className="section-row">
                <div className="reorder">
                  <button onClick={() => move(i, -1)} disabled={i === 0}>↑</button>
                  <button onClick={() => move(i, +1)} disabled={i === sections.length - 1}>↓</button>
                </div>
                <input
                  className="section-name"
                  value={s.name}
                  onChange={(e) => update(s.id, { name: e.target.value })}
                />
                <div className="weight-control">
                  <label className="muted">weight</label>
                  <input
                    type="number" min="0" max="10" step="0.5"
                    value={s.weight}
                    onChange={(e) => update(s.id, { weight: parseFloat(e.target.value) || 0 })}
                  />
                </div>
                <button className="icon-btn icon-btn--danger" onClick={() => remove(s.id)}
                  disabled={sections.length <= 1} title="Remove section globally">
                  <Icon name="trash" />
                </button>
              </div>
            ))}
          </div>

          <div className="add-section">
            <input
              placeholder="New section — e.g. Pacing, OP/ED, Worldbuilding…"
              value={newName} onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && add()}
            />
            <button className="btn btn--ghost" onClick={add}><Icon name="plus" /> Add</button>
          </div>
        </div>
        <footer className="modal__foot">
          <button className="btn btn--ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn--primary" onClick={save}>
            <Icon name="check" /> Save changes
          </button>
        </footer>
      </div>
    </div>
  );
}

Object.assign(window, { DetailView, SettingsModal, BigRadar });
