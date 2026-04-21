// ============================================================
// RATING FORM
//
// Three modes:
//   isNew         (workId=null)           — full form: work meta + AniList + first part
//   isEditingSeason (workId + seasonId)   — edit an existing part only
//   isAddingPart  (workId, seasonId=null) — add a new part to existing work (part fields only)
// ============================================================

function RatingForm({ state, workId, seasonId, onClose, dispatch }) {
  const { sections } = state;

  const isNew         = !workId;
  const existing      = workId ? state.works.find(w => w.id === workId) : null;
  const existingSeason = existing && seasonId ? existing.seasons.find(s => s.id === seasonId) : null;
  const isAddingPart  = !isNew && !existingSeason;   // adding a new part to an existing work
  const isEditingPart = !isNew && !!existingSeason;  // editing an existing part

  // ---- Work-level state (only used in isNew mode) ----
  const [title, setTitle]     = useState(existing?.title || '');
  const [type, setType]       = useState(existing?.type || 'anime');
  const [status, setStatus]   = useState(existing?.status || 'watching');
  const [tagsInput, setTags]  = useState(existing?.tags?.join(', ') || '');
  const [cover, setCover]     = useState(existing?.cover || null);
  const [coverColor, setCoverColor] = useState(existing?.coverColor || null);
  const [anilistUrl, setAnilistUrl] = useState(existing?.anilistUrl || '');
  const [anilistState, setAnilistState] = useState('idle');
  const [anilistMsg,   setAnilistMsg]   = useState('');

  // ---- Part-level state ----
  // Smart default label: "Season N" based on how many parts already exist
  const defaultLabel = (() => {
    if (existingSeason) return existingSeason.label;
    if (existing) return `Season ${existing.seasons.length + 1}`;
    return 'Season 1';
  })();
  const [seasonLabel, setSeasonLabel] = useState(defaultLabel);
  const [startDate, setStartDate] = useState(existingSeason?.startDate || '');
  const [endDate, setEndDate]     = useState(existingSeason?.endDate   || '');
  const [scores, setScores] = useState(() => {
    const base = {};
    sections.forEach(s => { base[s.id] = existingSeason?.scores?.[s.id] ?? null; });
    return base;
  });
  const [skip, setSkip] = useState(() => new Set(existingSeason?.skip || []));
  const [notes, setNotes] = useState(existingSeason?.notes || '');

  const overall = useMemo(
    () => calcOverall(scores, sections, [...skip]),
    [scores, sections, skip]
  );

  const titleRef = useRef(null);
  useEffect(() => { if (isNew && titleRef.current) titleRef.current.focus(); }, [isNew]);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); save(); }
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const loadFromAnilist = async () => {
    if (!anilistUrl.trim()) return;
    setAnilistState('loading'); setAnilistMsg('');
    try {
      const data = await fetchAnilistCover(anilistUrl.trim());
      setCover(data.cover);
      setCoverColor(data.coverColor);
      if (!title.trim() && data.title) setTitle(data.title);
      if (data.anilistType) setType(data.anilistType);
      if (!tagsInput.trim() && data.genres?.length)
        setTags(data.genres.slice(0, 5).map(g => g.toLowerCase()).join(', '));
      setAnilistState('ok'); setAnilistMsg('Cover loaded');
      setTimeout(() => setAnilistState('idle'), 2400);
    } catch (err) {
      setAnilistState('error'); setAnilistMsg(err.message || 'Failed');
    }
  };

  const toggleSkip = (id) => {
    setSkip(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const save = () => {
    if (isNew && !title.trim()) { titleRef.current?.focus(); return; }
    const season = {
      id: existingSeason?.id || 'sn_' + Math.random().toString(36).slice(2, 8),
      label: seasonLabel.trim() || defaultLabel,
      scores, skip: [...skip], startDate, endDate, notes,
      episodes: existingSeason?.episodes || [],
    };
    if (isNew) {
      const tags = tagsInput.split(',').map(t => t.trim()).filter(Boolean);
      dispatch({ type: 'addWork', work: {
        id: 'w_' + Math.random().toString(36).slice(2, 8),
        title, type, status, tags, notes: '', seasons: [season],
        cover, coverColor, anilistUrl,
      }});
    } else if (isAddingPart) {
      dispatch({ type: 'updateWork', id: existing.id, patch: {
        seasons: [...existing.seasons, season],
      }});
    } else {
      // editing existing season
      dispatch({ type: 'updateWork', id: existing.id, patch: {
        seasons: existing.seasons.map(s => s.id === existingSeason.id ? season : s),
      }});
    }
    onClose();
  };

  const headingText = isNew
    ? 'New entry'
    : isAddingPart
      ? `Add part · ${existing.title}`
      : `Edit · ${existing.title} — ${existingSeason.label}`;

  // For the preview cover/title in add-part / edit-part mode, use the existing work's data
  const previewTitle  = isNew ? (title || 'Untitled') : existing.title;
  const previewType   = isNew ? type : existing.type;
  const previewCover  = isNew ? cover : existing.cover;
  const previewColor  = isNew ? coverColor : existing.coverColor;

  return (
    <div className="rating-form">
      <header className="form-head">
        <button className="btn btn--ghost" onClick={onClose}><Icon name="back" /> Back</button>
        <div className="form-head__title">{headingText}</div>
        <div className="form-head__actions">
          <div className="form-head__overall">
            <span className="muted">Overall</span>
            <ScoreBig value={overall} />
          </div>
          <button className="btn btn--primary" onClick={save}>
            <Icon name="check" /> Save <kbd>⌘↵</kbd>
          </button>
        </div>
      </header>

      <div className="form-body">
        <div className="form-main">

          {/* ── Work meta — only for new entries ── */}
          {isNew && (
            <section className="form-section">
              <h3 style={{ marginBottom: 18 }}>Work</h3>
              <label className="field field--title">
                <span className="field__label">Title</span>
                <input
                  ref={titleRef} value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Frieren: Beyond Journey's End"
                />
              </label>

              <label className="field" style={{ marginTop: 16 }}>
                <span className="field__label">
                  <Icon name="link" size={11} /> AniList URL
                  <span className="muted" style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, marginLeft: 8 }}>
                    paste any anilist.co/anime/… or /manga/… link
                  </span>
                </span>
                <div className="anilist-row">
                  <input
                    value={anilistUrl} onChange={(e) => setAnilistUrl(e.target.value)}
                    placeholder="https://anilist.co/anime/181444/…"
                    onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), loadFromAnilist())}
                  />
                  <button className="btn btn--ghost" onClick={loadFromAnilist} disabled={anilistState === 'loading'}>
                    {anilistState === 'loading' ? 'Loading…' : 'Fetch'}
                  </button>
                </div>
                {anilistState === 'error' && <span className="anilist-msg anilist-msg--err">{anilistMsg}</span>}
                {anilistState === 'ok'    && <span className="anilist-msg anilist-msg--ok">{anilistMsg}</span>}
              </label>

              <div className="field-row">
                <label className="field">
                  <span className="field__label">Type</span>
                  <div className="seg">
                    {['anime','manga'].map(t => (
                      <button key={t} className={type === t ? 'is-active' : ''} onClick={() => setType(t)}>{t}</button>
                    ))}
                  </div>
                </label>
                <label className="field">
                  <span className="field__label">Status</span>
                  <div className="seg">
                    {['watching','completed','paused','dropped','plan'].map(s => (
                      <button key={s} className={status === s ? 'is-active' : ''} onClick={() => setStatus(s)}>{s}</button>
                    ))}
                  </div>
                </label>
              </div>

              <div className="field-row">
                <label className="field">
                  <span className="field__label">Tags</span>
                  <input value={tagsInput} onChange={(e) => setTags(e.target.value)}
                    placeholder="isekai, action, slice-of-life" />
                </label>
              </div>
            </section>
          )}

          {/* ── Part meta ── */}
          <section className="form-section">
            <h3 style={{ marginBottom: 18 }}>{isNew ? 'First part' : isAddingPart ? 'New part' : 'Part'}</h3>
            <div className="field-row">
              <label className="field">
                <span className="field__label">Part label</span>
                <input value={seasonLabel} onChange={(e) => setSeasonLabel(e.target.value)}
                  placeholder="Season 1 · Film pt.1 · Vol. 1–10" />
              </label>
            </div>
            <div className="field-row">
              <label className="field">
                <span className="field__label">Start date</span>
                <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </label>
              <label className="field">
                <span className="field__label">End date</span>
                <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </label>
            </div>
          </section>

          {/* ── Scores ── */}
          <section className="form-section">
            <div className="form-section__head">
              <h3>Scores</h3>
              <button className="text-btn" onClick={() => dispatch({ type: 'openSettings' })}>
                Edit default sections & weights
              </button>
            </div>
            <p className="hint" style={{ marginTop: -8, marginBottom: 16 }}>
              Toggle <kbd>off</kbd> to exclude a section from this part's overall — e.g. no finale, no OST.
            </p>
            <div className="score-grid">
              {sections.map(s => (
                <ScoreInput
                  key={s.id} label={s.name} weight={s.weight}
                  value={scores[s.id]}
                  skipped={skip.has(s.id)}
                  onToggleSkip={() => toggleSkip(s.id)}
                  onChange={(v) => setScores(prev => ({ ...prev, [s.id]: v }))}
                />
              ))}
            </div>
            <p className="hint">
              <kbd>←</kbd>/<kbd>→</kbd> in the number field: −/+0.1 · hold <kbd>⇧</kbd> for ±1
            </p>
          </section>

          {/* ── Notes ── */}
          <section className="form-section">
            <label className="field">
              <span className="field__label">Notes</span>
              <textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)}
                placeholder="Thoughts, favorite moments, why you skipped a section…" />
            </label>
          </section>
        </div>

        {/* Side preview */}
        <aside className="form-aside">
          <div className="preview-card">
            <Cover title={previewTitle} type={previewType} size="lg" src={previewCover} color={previewColor} />
            <div className="preview-body">
              <div className="preview-title">{previewTitle}</div>
              <div className="preview-sub">
                <span className="type-tag">{previewType}</span> · {seasonLabel}
              </div>
              <div className="preview-overall">
                <span className="muted">Weighted overall</span>
                <ScoreBig value={overall} />
              </div>
              <div className="preview-breakdown">
                {sections.map(s => {
                  const v = scores[s.id];
                  const isSkipped = skip.has(s.id);
                  const pct = v == null || isSkipped ? 0 : (v / 10) * 100;
                  return (
                    <div key={s.id} className={`breakdown-row ${isSkipped ? 'is-skipped' : ''}`}>
                      <span className="breakdown-row__label">{s.name}</span>
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
              <div className="preview-formula">
                <span className="muted">= round( Σ(score × weight) / Σ(weight) , 1 )</span>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

Object.assign(window, { RatingForm });
