/**
 * @file WatchOrderStyles.ts
 * @description Stylesheet of the Watch Order section, injected once into the page. Colours come
 * from AniList's own theme variables, so light, dark and contrast themes all follow.
 */

const STYLE_ID = 'au-watchorder-style';

const CSS = /* css */ `
.au-watchorder-section{--wo-accent:var(--color-blue);--wo-radius:8px;margin:0 0 30px;width:100%;font-size:1.3rem;color:rgb(var(--color-text));}
.au-watchorder-section *{box-sizing:border-box;}
.au-watchorder-section button{font:inherit;color:inherit;}
.au-watchorder-section :focus-visible{outline:2px solid rgb(var(--wo-accent));outline-offset:2px;}

/* Header */
.au-wo-header{display:flex;align-items:center;gap:16px;padding:0 0 10px;cursor:pointer;user-select:none;}
.au-wo-toggle{display:flex;align-items:center;gap:12px;flex:1;min-width:0;padding:0;border:0;background:none;cursor:pointer;text-align:left;}
.au-wo-chevron{flex:none;color:rgb(var(--color-text-lighter));transition:transform .2s ease;}
/* Same chevron size and label offset as the collapsible AniList sections (1em box, 0.8em glyph, label 18.2px in). */
.au-wo-toggle>.au-wo-chevron{width:14px;height:14px;padding:1.4px;box-sizing:border-box;margin-right:-7.8px;}
/* Collapsed, the header sits on the same 46px rhythm as collapsed AniList sections. */
.au-wo-header:not(.is-open){padding-bottom:0;}
.au-wo-header.is-open .au-wo-chevron{transform:rotate(90deg);}
.au-wo-title{font-size:1.4rem;font-weight:500;color:rgb(var(--color-text));white-space:nowrap;}
.au-wo-subtitle{font-size:1.2rem;color:rgb(var(--color-text-lighter));white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.au-wo-meter{display:flex;align-items:center;gap:10px;flex:none;font-size:1.2rem;color:rgb(var(--color-text-lighter));white-space:nowrap;}
.au-wo-meter strong{color:rgb(var(--color-text));font-weight:600;}
.au-wo-meter-track{width:120px;height:6px;border-radius:3px;background:rgba(var(--color-text-lighter),.18);overflow:hidden;}
.au-wo-meter-fill{display:block;height:100%;border-radius:3px;background:linear-gradient(90deg,rgba(var(--wo-accent),.75),rgb(var(--wo-accent)));transition:width .3s ease;}

.au-wo-body{padding:16px 18px;border-radius:4px;background:rgb(var(--color-foreground));}
.au-wo-stats{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px 16px;margin:-4px 0 12px;}
.au-wo-status{font-size:1.2rem;color:rgb(var(--color-text-lighter));white-space:nowrap;}
.au-wo-retry{padding:5px 14px;border-radius:6px;border:1px solid rgba(var(--wo-accent),.5);background:none;color:rgb(var(--wo-accent));cursor:pointer;}

/* Toolbar: view switch on the left, filters on the right */
.au-wo-toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:10px 14px;margin-bottom:14px;}
.au-wo-views{display:inline-flex;gap:2px;padding:3px;border-radius:10px;background:rgb(var(--color-background));}
.au-wo-view{display:inline-flex;align-items:center;gap:7px;padding:7px 14px;border:0;border-radius:8px;background:none;cursor:pointer;font-size:1.25rem;font-weight:500;color:rgb(var(--color-text-lighter));transition:background .15s,color .15s;}
.au-wo-view:hover{color:rgb(var(--color-text));}
.au-wo-view[aria-pressed="true"]{background:rgb(var(--color-foreground));color:rgb(var(--wo-accent));box-shadow:0 1px 3px rgba(0,0,0,.18);}
.au-wo-filters{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-left:auto;}
.au-wo-chip{display:inline-flex;align-items:center;gap:6px;padding:5px 11px;border-radius:999px;border:1px solid rgba(var(--color-text-lighter),.28);background:none;cursor:pointer;font-size:1.15rem;color:rgb(var(--color-text-lighter));transition:all .15s;}
.au-wo-chip:hover{border-color:rgba(var(--color-text-lighter),.55);color:rgb(var(--color-text));}
.au-wo-chip[aria-pressed="true"]{border-color:rgba(var(--wo-accent),.55);background:rgba(var(--wo-accent),.12);color:rgb(var(--wo-accent));}
.au-wo-chip .au-wo-icon{width:14px;height:14px;}
.au-wo-segment{display:inline-flex;border-radius:999px;border:1px solid rgba(var(--color-text-lighter),.28);overflow:hidden;}
.au-wo-segment button{display:inline-flex;align-items:center;padding:5px 9px;border:0;background:none;cursor:pointer;color:rgb(var(--color-text-lighter));}
.au-wo-segment button[aria-pressed="true"]{background:rgba(var(--wo-accent),.14);color:rgb(var(--wo-accent));}
.au-wo-segment .au-wo-icon{width:15px;height:15px;}


/* Timeline list */
.au-wo-list{position:relative;display:flex;flex-direction:column;max-height:520px;overflow-y:auto;padding:4px 4px 4px 0;scrollbar-width:thin;scrollbar-color:rgba(127,127,127,.45) transparent;}
.au-wo-row{position:relative;display:grid;grid-template-columns:34px 42px minmax(0,1fr) auto;align-items:center;gap:0 14px;padding:7px 12px 7px 4px;border-radius:var(--wo-radius);color:inherit;text-decoration:none;transition:background .15s;}
a.au-wo-row:hover{background:rgba(var(--color-background),.85);}
.au-wo-row::before{content:"";position:absolute;left:20px;top:0;bottom:0;width:2px;background:rgba(var(--color-text-lighter),.2);}
.au-wo-row:first-child::before{top:50%;}
.au-wo-row:last-child::before{bottom:50%;}
.au-wo-row:only-child::before{display:none;}
.au-wo-row.is-watched::before{background:rgba(var(--wo-accent),.45);}
.au-wo-row.is-branch .au-wo-cover{width:34px;height:48px;justify-self:end;}
.au-wo-marker{position:relative;z-index:1;justify-self:center;display:flex;align-items:center;justify-content:center;box-sizing:border-box;width:26px;height:26px;border-radius:50%;font-size:1.1rem;font-weight:700;line-height:1;font-variant-numeric:tabular-nums;text-align:center;background:rgb(var(--color-foreground));border:2px solid rgba(var(--color-text-lighter),.45);color:rgb(var(--color-text-lighter));}
.au-wo-row.is-branch .au-wo-marker{width:14px;height:14px;border-width:2px;border-style:solid;}
.au-wo-row.is-watched .au-wo-marker{background:rgb(var(--wo-accent));border-color:rgb(var(--wo-accent));color:#fff;}
.au-wo-row.is-branch .au-wo-marker{border-color:var(--wo-kind);}
.au-wo-row.is-watched.is-branch .au-wo-marker{background:var(--wo-kind);border-color:var(--wo-kind);}
.au-wo-row.is-watched.is-branch .au-wo-marker .au-wo-icon{display:none;}
/* The digit box is trimmed to the cap height, so the number sits in the exact centre. */
.au-wo-marker-num{display:block;text-box:trim-both cap alphabetic;}
.au-wo-row.is-progress .au-wo-marker{border-color:rgb(var(--wo-accent));color:rgb(var(--wo-accent));}
.au-wo-row.is-next .au-wo-marker{border-color:rgb(var(--wo-accent));color:rgb(var(--wo-accent));}
.au-wo-marker .au-wo-icon{width:14px;height:14px;stroke-width:3;}
.au-wo-cover{display:block;width:42px;height:58px;border-radius:5px;object-fit:cover;background:rgba(var(--color-text-lighter),.15);}
.au-wo-row-text{display:flex;flex-direction:column;gap:3px;min-width:0;}
.au-wo-row-title{font-size:1.35rem;font-weight:600;color:rgb(var(--color-text));overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.au-wo-row.is-watched .au-wo-row-title{color:rgb(var(--color-text-light));}
.au-wo-row-meta{display:flex;flex-wrap:wrap;align-items:center;gap:0 8px;font-size:1.15rem;color:rgb(var(--color-text-lighter));}
.au-wo-row-bar{display:block;width:140px;max-width:100%;height:3px;margin-top:3px;border-radius:2px;background:rgba(var(--color-text-lighter),.2);overflow:hidden;}
.au-wo-row-bar span{display:block;height:100%;background:rgb(var(--wo-accent));}
.au-wo-row.is-current{background:rgba(var(--wo-accent),.09);}
.au-wo-row.is-current .au-wo-row-title{color:rgb(var(--wo-accent));}
.au-wo-badges{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;}
.au-wo-badge{flex:none;padding:2px 9px;border-radius:10px;font-size:1.05rem;font-weight:600;white-space:nowrap;background:rgba(var(--color-text-lighter),.16);color:rgb(var(--color-text-lighter));}
.au-wo-badge--kind{background:color-mix(in srgb,var(--wo-kind) 16%,transparent);color:var(--wo-kind);}
.au-wo-badge--next{background:rgb(var(--wo-accent));color:#fff;}
.au-wo-badge--here{background:rgba(var(--wo-accent),.16);color:rgb(var(--wo-accent));}
.au-wo-start{margin:0 0 10px;padding:9px 12px;border-radius:var(--wo-radius);background:rgb(var(--color-background));font-size:1.2rem;color:rgb(var(--color-text-light));}
.au-wo-empty{padding:28px 12px;text-align:center;color:rgb(var(--color-text-lighter));}

/* Map */
.au-wo-map{position:relative;overflow:hidden;border-radius:10px;user-select:none;cursor:grab;background:rgb(var(--color-background));box-shadow:inset 0 0 0 1px rgba(var(--color-text-lighter),.12);outline:none;}
.au-wo-map:focus-visible{box-shadow:inset 0 0 0 2px rgb(var(--wo-accent));}
.au-wo-map.is-dragging{cursor:grabbing;}
.au-wo-map::after{content:"";position:absolute;inset:0;pointer-events:none;border-radius:inherit;background:radial-gradient(120% 90% at 50% 40%,transparent 60%,rgba(0,0,0,.16));}
.au-wo-svg{display:block;width:100%;height:100%;}
.au-wo-svg text{font-family:inherit;}
.au-wo-dot{fill:rgb(var(--color-text-lighter));opacity:.22;}
.au-wo-edge{stroke-width:2;stroke-linecap:round;stroke-linejoin:round;opacity:.75;transition:opacity .15s,stroke-width .15s;}
.au-wo-edge[data-au-kind="MAIN"]{stroke:rgb(var(--wo-accent));stroke-width:2.6;opacity:.9;}
.au-wo-edge.is-lit{stroke-width:3.2;opacity:1;}
.au-wo-node{cursor:pointer;transition:opacity .15s;}
.au-wo-node-bg{fill:rgb(var(--color-foreground));filter:drop-shadow(0 2px 6px rgba(0,0,0,.22));}
.au-wo-node-frame{stroke:rgba(var(--color-text-lighter),.22);stroke-width:1;transition:stroke .15s;}
.au-wo-node:hover .au-wo-node-frame,.au-wo-node:focus .au-wo-node-frame{stroke:rgba(var(--wo-accent),.8);stroke-width:1.5;}
.au-wo-node:focus{outline:none;}
.au-wo-node.is-current .au-wo-node-frame{stroke:rgb(var(--wo-accent));stroke-width:2.5;}
.au-wo-node.is-watched .au-wo-node-cover{opacity:.72;}
.au-wo-node-title{font-size:12.5px;font-weight:600;fill:rgb(var(--color-text));}
.au-wo-node.is-current .au-wo-node-title{fill:rgb(var(--wo-accent));}
.au-wo-node-meta{font-size:10.5px;fill:rgb(var(--color-text-lighter));}
.au-wo-kind{font-weight:600;}
.au-wo-cover-empty{opacity:.28;}
.au-wo-cover-letter{font-size:20px;font-weight:700;fill:rgb(var(--color-text));opacity:.6;}
.au-wo-poster-title{font-size:11.5px;font-weight:700;fill:#fff;}
.au-wo-poster-meta{font-size:9.5px;fill:rgba(255,255,255,.72);}
.au-wo-check circle{fill:rgb(var(--wo-accent));stroke:rgb(var(--color-foreground));stroke-width:2;}
.au-wo-check path{stroke:#fff;}
.au-wo-progress-track{fill:rgba(var(--color-text-lighter),.25);}
.au-wo-progress-fill{fill:rgb(var(--wo-accent));}
.au-wo-pill rect{fill:rgb(var(--wo-accent));}
.au-wo-pill-text{font-size:10px;font-weight:700;fill:#fff;letter-spacing:.02em;}
.au-wo-pill--next rect{fill:rgb(var(--color-foreground));stroke:rgb(var(--wo-accent));stroke-width:1.5;}
.au-wo-pill--next .au-wo-pill-text{fill:rgb(var(--wo-accent));}

.au-wo-controls{position:absolute;right:12px;bottom:12px;z-index:2;display:flex;align-items:center;gap:2px;padding:4px;border-radius:12px;background:rgba(var(--color-foreground),.88);backdrop-filter:blur(8px);box-shadow:0 4px 18px rgba(0,0,0,.25),0 0 0 1px rgba(var(--color-text-lighter),.15);cursor:default;}
.au-wo-control{display:inline-flex;align-items:center;justify-content:center;min-width:30px;height:30px;padding:0 6px;border:0;border-radius:8px;background:none;cursor:pointer;color:rgb(var(--color-text-light));transition:background .12s,color .12s;}
.au-wo-control:hover{background:rgba(var(--color-text-lighter),.16);color:rgb(var(--color-text));}
.au-wo-control--level{min-width:52px;font-size:1.15rem;font-weight:600;font-variant-numeric:tabular-nums;}
.au-wo-control-divider{width:1px;height:18px;margin:0 3px;background:rgba(var(--color-text-lighter),.25);}
.au-wo-minimap{position:absolute;left:12px;bottom:12px;z-index:2;padding:6px;border-radius:10px;background:rgba(var(--color-foreground),.88);backdrop-filter:blur(8px);box-shadow:0 4px 18px rgba(0,0,0,.25),0 0 0 1px rgba(var(--color-text-lighter),.15);cursor:pointer;transition:opacity .2s;}
.au-wo-control[aria-pressed="true"]{color:rgb(var(--wo-accent));}
.au-wo-minimap.is-hidden{opacity:0;pointer-events:none;}
.au-wo-minimap svg{display:block;}
.au-wo-mini-node{fill:rgba(var(--color-text-lighter),.35);}
.au-wo-mini-node.is-watched{fill:rgba(var(--wo-accent),.55);}
.au-wo-mini-node.is-current{fill:rgb(var(--wo-accent));}
.au-wo-mini-view{fill:rgba(var(--wo-accent),.1);stroke:rgb(var(--wo-accent));stroke-width:1.5;}

/* Legend doubles as the relation filter */
.au-wo-legend{display:flex;flex-wrap:wrap;align-items:center;gap:6px 8px;margin-top:10px;}
.au-wo-legend-item{display:inline-flex;align-items:center;gap:8px;padding:4px 10px;border-radius:999px;border:1px solid transparent;background:none;font-size:1.15rem;color:rgb(var(--color-text-light));}
button.au-wo-legend-item{cursor:pointer;}
button.au-wo-legend-item:hover{border-color:rgba(var(--color-text-lighter),.3);}
.au-wo-legend-item[aria-pressed="false"]{opacity:.45;text-decoration:line-through;}
.au-wo-swatch{display:inline-block;width:22px;height:0;border-top:2.5px solid var(--wo-kind);}
.au-wo-swatch--dashed{border-top-style:dashed;}
.au-wo-swatch--dotted{border-top-style:dotted;}
.au-wo-legend-count{font-size:1.05rem;color:rgb(var(--color-text-lighter));}
.au-wo-legend-hint{margin-left:auto;font-size:1.1rem;color:rgb(var(--color-text-lighter));}

.au-wo-chip:disabled{opacity:.45;cursor:default;}
.au-wo-totals{font-size:1.2rem;color:rgb(var(--color-text-lighter));}
.au-wo-footer{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:14px;padding-top:12px;border-top:1px solid rgba(var(--color-text-lighter),.12);font-size:1.1rem;color:rgb(var(--color-text-lighter));}
.au-wo-footer .au-wo-link{padding:0;border:0;background:none;font:inherit;color:rgb(var(--wo-accent));cursor:pointer;}
.au-wo-footer .au-wo-link:hover{text-decoration:underline;}
.au-wo-footer a{color:rgb(var(--wo-accent));text-decoration:none;}
.au-wo-footer a:hover{text-decoration:underline;}

/* Full screen: the body (or the bare map) fills the screen and the map takes the free height. */
.au-wo-body:fullscreen{display:flex;flex-direction:column;height:100%;padding:20px 24px;overflow:auto;background:rgb(var(--color-foreground));}
.au-wo-body:fullscreen .au-wo-map-wrap{display:flex;flex-direction:column;flex:1;min-height:0;}
.au-wo-body:fullscreen .au-wo-map{flex:1;height:auto!important;min-height:0;}
.au-wo-body:fullscreen .au-wo-list{max-height:none;flex:1;}
.au-wo-body:fullscreen .au-wo-footer{display:none;}
.au-wo-map:fullscreen{height:100vh!important;border-radius:0;}

@media (max-width:760px){
  .au-wo-header{flex-wrap:wrap;gap:10px;}
  .au-wo-meter{width:100%;}
  .au-wo-meter-track{flex:1;}
  .au-wo-filters{margin-left:0;}
  .au-wo-view{padding:7px 10px;}
  .au-wo-view span{display:none;}
  .au-wo-legend-hint{display:none;}
  .au-wo-minimap{display:none;}
  .au-wo-row{grid-template-columns:28px 36px minmax(0,1fr);}
  .au-wo-row::before{left:17px;}
  .au-wo-badges{grid-column:3;justify-content:flex-start;}
}
@media (prefers-reduced-motion:reduce){
  .au-watchorder-section *{transition:none!important;animation:none!important;}
}
`;

/** Add the stylesheet once per document (idempotent). */
export function ensureWatchOrderStyles(doc: Document = document): void {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  (doc.head ?? doc.documentElement).append(style);
}
