// ============================================================
// COMPARE VIEW — side-by-side comparison of 2 works
// Foundation for future friend-comparison (extension feature).
// Each side picks a work (and specific season) → overlays radar,
// diffs per section, shows which section each side wins.
// ============================================================

function CompareView({ state, onClose, onOpen }) {
  const { works, sections } = state;

  const [leftId, setLeftId]   = useState(works[0]?.id || null);
  const [rightId, setRightId] = useState(works[1]?.id || works[0]?.id || null);

  const leftWork  = works.find(w => w.id === leftId);
  const rightWork = works.find(w => w.id === rightId);

  const [leftSeasonId, setLeftSeasonId]   = useState(leftWork?.seasons[leftWork.seasons.length - 1]?.id);
  const [rightSeasonId, setRightSeasonId] = useState(rightWork?.seasons[rightWork.seasons.length - 1]?.id);

  // If user switches work, default to latest season
  useEffect(() => {
    if (leftWork) setLeftSeasonId(leftWork.seasons[leftWork.seasons.length - 1]?.id);
  }, [leftId]);
  useEffect(() => {
    if (rightWork) setRightSeasonId(rightWork.seasons[rightWork.seasons.length - 1]?.id);
  }, [rightId]);

  const leftSeason  = leftWork?.seasons.find(s => s.id === leftSeasonId);
  const rightSeason = rightWork?.seasons.find(s => s.id === rightSeasonId);

  const leftOverall  = leftSeason  ? calcOverall(leftSeason.scores,  sections, leftSeason.skip)  : null;
  const rightOverall = rightSeason ? calcOverall(rightSeason.scores, sections, rightSeason.skip) : null;

  return (
    <div className="compare-view">
      <header className="compare-head">
        <button className="btn btn--ghost" onClick={onClose}><Icon name="back" /> Back</button>
        <div className="compare-head__title">
          <h1>Compare</h1>
          <p className="muted">Side-by-side comparison. When the extension ships, you'll also be able to compare your ratings against a friend's.</p>
        </div>
      </header>

      <div className="compare-body">
        <CompareSide
          side="left"
          works={works} workId={leftId} setWorkId={setLeftId}
          seasonId={leftSeasonId} setSeasonId={setLeftSeasonId}
          work={leftWork} season={leftSeason} overall={leftOverall}
          onOpen={onOpen}
        />
        <CompareMiddle
          sections={sections}
          leftScores={leftSeason?.scores} leftSkip={leftSeason?.skip}
          rightScores={rightSeason?.scores} rightSkip={rightSeason?.skip}
          leftTitle={leftWork?.title} rightTitle={rightWork?.title}
          leftOverall={leftOverall} rightOverall={rightOverall}
        />
        <CompareSide
          side="right"
          works={works} workId={rightId} setWorkId={setRightId}
          seasonId={rightSeasonId} setSeasonId={setRightSeasonId}
          work={rightWork} season={rightSeason} overall={rightOverall}
          onOpen={onOpen}
        />
      </div>
    </div>
  );
}

function CompareSide({ side, works, workId, setWorkId, seasonId, setSeasonId, work, season, overall, onOpen }) {
  return (
    <div className={`compare-side compare-side--${side}`}>
      <select className="select compare-picker" value={workId || ''} onChange={(e) => setWorkId(e.target.value)}>
        {works.map(w => <option key={w.id} value={w.id}>{w.title}</option>)}
      </select>
      {work && (
        <>
          <div className="compare-cover">
            <Cover title={work.title} type={work.type} size="xl" src={work.cover} color={work.coverColor} />
          </div>
          <div className="compare-meta">
            <h2 onClick={() => onOpen(work.id)} style={{ cursor: 'pointer' }}>{work.title}</h2>
            <div className="compare-meta__row">
              <span className="type-tag">{work.type}</span>
              <span className={`status status--${work.status}`}>{work.status}</span>
            </div>
            {work.seasons.length > 1 && (
              <select className="select compare-season" value={seasonId || ''} onChange={(e) => setSeasonId(e.target.value)}>
                {work.seasons.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            )}
            {work.seasons.length <= 1 && season && (
              <div className="muted" style={{ fontSize: 12 }}>{season.label}</div>
            )}
            <div className="compare-overall">
              <span className="muted">Overall</span>
              <ScoreBig value={overall} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function CompareMiddle({ sections, leftScores, leftSkip, rightScores, rightSkip, leftTitle, rightTitle, leftOverall, rightOverall }) {
  const leftSkipSet  = new Set(leftSkip || []);
  const rightSkipSet = new Set(rightSkip || []);

  return (
    <div className="compare-middle">
      <OverlayRadar
        sections={sections}
        leftScores={leftScores} leftSkip={leftSkip}
        rightScores={rightScores} rightSkip={rightSkip}
      />
      <div className="compare-delta">
        <div className="compare-delta__head">
          <span className="muted">Section</span>
          <span className="compare-delta__l" title={leftTitle}>{abbreviate(leftTitle)}</span>
          <span className="compare-delta__bar" />
          <span className="compare-delta__r" title={rightTitle}>{abbreviate(rightTitle)}</span>
        </div>
        {sections.map(s => {
          const lv = leftScores?.[s.id];
          const rv = rightScores?.[s.id];
          const lSkip = leftSkipSet.has(s.id);
          const rSkip = rightSkipSet.has(s.id);
          const lEff = lSkip || lv == null ? null : lv;
          const rEff = rSkip || rv == null ? null : rv;
          const winner = (lEff != null && rEff != null)
            ? (lEff > rEff ? 'l' : rEff > lEff ? 'r' : 'tie')
            : null;
          return (
            <div key={s.id} className="compare-delta__row">
              <span className="compare-delta__label">{s.name}</span>
              <span className={`compare-delta__val ${winner === 'l' ? 'is-win' : ''}`}
                    style={{ color: lSkip ? 'var(--muted)' : scoreColor(lv) }}>
                {lSkip ? 'off' : lv == null ? '—' : lv.toFixed(1)}
              </span>
              <DeltaBar lv={lEff} rv={rEff} />
              <span className={`compare-delta__val ${winner === 'r' ? 'is-win' : ''}`}
                    style={{ color: rSkip ? 'var(--muted)' : scoreColor(rv) }}>
                {rSkip ? 'off' : rv == null ? '—' : rv.toFixed(1)}
              </span>
            </div>
          );
        })}
        <div className="compare-delta__row compare-delta__row--overall">
          <span className="compare-delta__label"><strong>Overall</strong></span>
          <span className="compare-delta__val" style={{ color: scoreColor(leftOverall) }}>
            {leftOverall == null ? '—' : leftOverall.toFixed(1)}
          </span>
          <DeltaBar lv={leftOverall} rv={rightOverall} />
          <span className="compare-delta__val" style={{ color: scoreColor(rightOverall) }}>
            {rightOverall == null ? '—' : rightOverall.toFixed(1)}
          </span>
        </div>
      </div>
    </div>
  );
}

function DeltaBar({ lv, rv }) {
  if (lv == null && rv == null) return <span className="compare-delta__bar" />;
  if (lv == null) return <span className="compare-delta__bar compare-delta__bar--only-r" />;
  if (rv == null) return <span className="compare-delta__bar compare-delta__bar--only-l" />;
  const lp = (lv / 10) * 100;
  const rp = (rv / 10) * 100;
  return (
    <span className="compare-delta__bar">
      <span className="compare-delta__bar-l" style={{ width: `${lp/2}%`, background: scoreColor(lv) }} />
      <span className="compare-delta__bar-r" style={{ width: `${rp/2}%`, background: scoreColor(rv) }} />
    </span>
  );
}

function OverlayRadar({ sections, leftScores, leftSkip, rightScores, rightSkip }) {
  const enabled = sections; // always show all globals; skipped → 0 on that side
  const n = enabled.length;
  if (n < 3) return <div className="muted">Need at least 3 sections to show radar.</div>;
  const cx = 170, cy = 170, r = 130;
  const leftSkipSet  = new Set(leftSkip || []);
  const rightSkipSet = new Set(rightSkip || []);

  const ptsFor = (scores, skipSet) => enabled.map((s, i) => {
    const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
    const skipped = skipSet.has(s.id);
    const v = scores?.[s.id];
    const norm = (skipped || v == null) ? 0 : v / 10;
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
    <svg viewBox="0 0 340 340" className="overlay-radar">
      {rings}
      {enabled.map((_, i) => {
        const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
        return <line key={i} x1={cx} y1={cy}
          x2={cx + Math.cos(angle) * r}
          y2={cy + Math.sin(angle) * r}
          stroke="var(--border)" strokeWidth="0.5" />;
      })}
      {leftScores && (
        <polygon points={ptsFor(leftScores, leftSkipSet)}
          fill="oklch(0.72 0.15 200 / 0.18)" stroke="oklch(0.78 0.16 200)" strokeWidth="1.8" />
      )}
      {rightScores && (
        <polygon points={ptsFor(rightScores, rightSkipSet)}
          fill="oklch(0.72 0.17 25 / 0.18)" stroke="oklch(0.78 0.18 25)" strokeWidth="1.8" />
      )}
      {enabled.map((s, i) => {
        const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
        const lx = cx + Math.cos(angle) * (r + 20);
        const ly = cy + Math.sin(angle) * (r + 20);
        return (
          <text key={s.id} x={lx} y={ly} textAnchor="middle" dominantBaseline="middle" className="radar-label">
            {s.name}
          </text>
        );
      })}
    </svg>
  );
}

function abbreviate(s) {
  if (!s) return '—';
  if (s.length <= 20) return s;
  return s.slice(0, 18) + '…';
}

Object.assign(window, { CompareView });
