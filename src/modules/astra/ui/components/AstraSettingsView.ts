/**
 * @file AstraSettingsView.ts
 * @description Component for managing Astra weighted sections and global configurations.
 * Refactored to use DI and secure `html` templates.
 */

import { injectable, inject } from 'tsyringe';
import { AstraView } from '../base/AstraView';
import { AstraService } from '../../AstraService';
import type { AstraSection } from '../../AstraInterfaces';
import { ToastService } from '@core/services/ToastService';
import { TOKENS } from '@core/di/tokens';
import { html, map, when } from '@core/utils/Template';
import type { IApiClient } from '@core/interfaces/IApiClient';
import type { IEventBus, EventSubscription } from '@core/interfaces/IEventBus';
import { EVENT_TYPES } from '@core/events/EventTypes';
import { MAX_ASTRA_BACKUP_CHARACTERS } from '../../store/AstraBackup';
import { AstraDashboardStore } from '../../store/AstraDashboardStore';
import { AstraSettingsActions, type AstraSettingsScope } from './AstraSettingsActions';
import { logger } from '@core/logger';

@injectable()
export class AstraSettingsView extends AstraView {
  private actions: AstraSettingsActions;
  private accountSubscription?: EventSubscription;

  constructor(
    @inject(TOKENS.AstraService) private service: AstraService,
    @inject(TOKENS.ToastService) private toast: ToastService,
    @inject(TOKENS.ApiClient) api: IApiClient,
    @inject(TOKENS.EventBus) private eventBus: IEventBus,
    @inject(TOKENS.AstraStore) private dashboardStore: AstraDashboardStore
  ) {
    super({});
    this.actions = new AstraSettingsActions(api);
    // Safety re-render after DI assignment
    this.element = this.render();
  }

  protected override onMount(): void {
    this.actions.activate();
    this.accountSubscription = this.eventBus.on(EVENT_TYPES.AUTH_STATE_CHANGED, () => this.update());
  }

  protected override onUnmount(): void {
    this.accountSubscription?.unsubscribe();
    this.accountSubscription = undefined;
    this.actions.invalidate();
    super.onUnmount();
  }

  /**
   * Renders the settings dashboard.
   */
  protected template(): HTMLElement {
    if (!this.service) return html`<div></div>`;
    const sections = this.service.getSections();
    const settings = this.service.getSettings();
    const hasFinale = this.service.hasFinaleSection();

    return html`
      <div class="astra-settings-tab">
        <div class="astra-settings-header">
          <div class="astra-settings-title-group">
            <h2>Astra Configuration</h2>
            <p class="astra-muted">
              Fine-tune your rating experience and integration preferences.
              <b>Changes are saved automatically.</b>
            </p>
          </div>
        </div>

        <div class="astra-settings-grid">
          <div class="astra-settings-section">
            <h3 class="astra-section-title"><i class="fa-solid fa-sliders"></i> Global Preferences</h3>
            <div class="astra-settings-item">
              <div class="astra-settings-info">
                <span class="astra-settings-label">Separate Airing</span>
                <span class="astra-settings-desc"
                  >Move anime currently airing from Watching into an Airing section above Reading and Watching.</span
                >
              </div>
              <div
                class="astra-toggle ${when(this.dashboardStore.getState().separateAiring, 'active')}"
                id="astra-separate-airing-toggle"
                role="switch"
                tabindex="0"
                aria-label="Separate airing anime"
                aria-checked="${this.dashboardStore.getState().separateAiring}"
              >
                <div class="astra-toggle-handle"></div>
              </div>
            </div>
            <div class="astra-settings-item ${when(!hasFinale, 'astra-settings-item--warning')}">
              <div class="astra-settings-info">
                <div class="astra-settings-label-row">
                  <span class="astra-settings-label">Series Finale Scoring</span>
                  ${when(
                    !hasFinale,
                    html`<span class="astra-badge-warn"
                      ><i class="fa-solid fa-triangle-exclamation"></i> Requires "Finale" section</span
                    >`
                  )}
                </div>
                <span class="astra-settings-desc"
                  >Apply extra weight to the "Finale" section for the last episode of a
                  series.</span
                >
              </div>
              <div class="astra-settings-controls">
                <div class="astra-stepper astra-stepper--inline">
                  <button class="astra-step-btn" id="dec-multiplier">
                    <i class="fa-solid fa-minus"></i>
                  </button>
                  <div class="astra-stepper-center">
                    <input
                      type="number"
                      id="multiplier-input"
                      value="${settings.finaleWeightMultiplier}"
                      step="0.5"
                      min="1"
                    />
                    <span class="astra-unit">x</span>
                  </div>
                  <button class="astra-step-btn" id="inc-multiplier">
                    <i class="fa-solid fa-plus"></i>
                  </button>
                </div>
                <div
                  class="astra-toggle ${when(settings.enableSeriesFinale, 'active')}"
                  data-setting="enableSeriesFinale"
                >
                  <div class="astra-toggle-handle"></div>
                </div>
              </div>
            </div>
          </div>

          <div class="astra-settings-section">
            <h3 class="astra-section-title"><i class="fa-solid fa-arrows-rotate"></i> AniList Integration</h3>
            <div class="astra-settings-item">
              <div class="astra-settings-info">
                <span class="astra-settings-label">Append Astra Review to comment</span>
                <span class="astra-settings-desc"
                  >Include the detailed breakdown (scores, journal) in your AniList activity
                  notes.</span
                >
              </div>
              <div
                class="astra-toggle ${when(settings.appendAstraToComment, 'active')}"
                data-setting="appendAstraToComment"
              >
                <div class="astra-toggle-handle"></div>
              </div>
            </div>
          </div>

          <div class="astra-settings-section">
            <div class="astra-settings-section-header">
              <h3 class="astra-section-title">
                <i class="fa-solid fa-layer-group"></i> Scoring Configuration
              </h3>
              <button class="astra-btn astra-btn--secondary astra-btn--sm" id="astra-add-section">
                <i class="fa-solid fa-plus"></i> Add Section
              </button>
            </div>
            <div class="astra-sections-list">
              ${map(sections, (s) => this.renderSectionItem(s))}
            </div>
          </div>

          <div class="astra-settings-section">
            <h3 class="astra-section-title"><i class="fa-solid fa-database"></i> Data Management</h3>
            <div class="astra-settings-grid-2col">
              <div class="astra-settings-item">
                <div class="astra-settings-info">
                  <span class="astra-settings-label">Sync with AniList</span>
                  <span class="astra-settings-desc"
                    >Fetch and update all media entries from your AniList profile.</span
                  >
                </div>
                <button class="astra-btn astra-btn--secondary" id="astra-sync-list">
                  <i class="fa-solid fa-arrows-rotate"></i> Sync List
                </button>
              </div>
              <div class="astra-settings-item">
                <div class="astra-settings-info">
                  <span class="astra-settings-label">Export Data</span>
                  <span class="astra-settings-desc"
                    >Download all your Astra ratings and notes as a JSON file.</span
                  >
                </div>
                <button class="astra-btn astra-btn--secondary" id="astra-export-json">
                  <i class="fa-solid fa-download"></i> Export JSON
                </button>
              </div>
              <div class="astra-settings-item">
                <div class="astra-settings-info">
                  <span class="astra-settings-label">Import Data</span>
                  <span class="astra-settings-desc"
                    >Restore your Astra database from a previously exported JSON file.</span
                  >
                </div>
                <button class="astra-btn astra-btn--secondary" id="astra-import-json">
                  <i class="fa-solid fa-upload"></i> Import JSON
                </button>
              </div>
              <div class="astra-settings-item destructive">
                <div class="astra-settings-info">
                  <span class="astra-settings-label">Delete All Data</span>
                  <span class="astra-settings-desc"
                    >Permanently delete all ratings, notes, and configurations.
                    <b>This cannot be undone.</b></span
                  >
                </div>
                <button class="astra-btn astra-btn--danger" id="astra-reset-data">
                  <i class="fa-solid fa-trash"></i> Delete All
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Renders a single scoring section configuration card.
   */
  private renderSectionItem(section: AstraSection): HTMLElement {
    const subSections = section.subSections ?? [];
    const hasSubSections = subSections.length > 0;

    return html`
      <div
        class="astra-section-config-card ${when(hasSubSections, 'has-subs')}"
        data-id="${section.id}"
      >
        <div class="astra-section-header-row">
          <div class="astra-section-meta">
            <input
              type="text"
              class="astra-section-name-input"
              data-id="${section.id}"
              value="${section.name}"
              placeholder="Section Name"
            />
            <span class="astra-section-weight-info">Overall weight: <b>${section.weight}</b></span>
          </div>
          <div class="astra-section-controls">
            <div class="astra-stepper astra-stepper--inline">
              <button class="astra-step-btn dec-weight" data-id="${section.id}">
                <i class="fa-solid fa-minus"></i>
              </button>
              <div class="astra-stepper-center">
                <input
                  type="number"
                  class="astra-weight-input"
                  data-id="${section.id}"
                  value="${section.weight}"
                  step="0.25"
                  min="0"
                />
              </div>
              <button class="astra-step-btn inc-weight" data-id="${section.id}">
                <i class="fa-solid fa-plus"></i>
              </button>
            </div>
            <button
              class="astra-icon-btn destructive astra-remove-section"
              data-id="${section.id}"
              title="Remove Section"
            >
              <i class="fa-solid fa-trash-can"></i>
            </button>
            <button
              class="astra-icon-btn astra-add-sub"
              data-id="${section.id}"
              title="Add Sub-section"
            >
              <i class="fa-solid fa-circle-plus"></i>
            </button>
          </div>
        </div>

        ${when(
          hasSubSections,
          html`
            <div class="astra-subsections-grid">
              ${map(
                subSections,
                (sub) => html`
                  <div class="astra-subsection-item">
                    <div class="astra-sub-info">
                      <input
                        type="text"
                        class="astra-sub-name-input"
                        data-section-id="${section.id}"
                        data-sub-id="${sub.id}"
                        value="${sub.name}"
                        placeholder="Sub-section Name"
                      />
                      <button
                        class="astra-remove-sub"
                        data-section-id="${section.id}"
                        data-sub-id="${sub.id}"
                        title="Remove Sub-section"
                      >
                        ×
                      </button>
                    </div>
                    <div class="astra-stepper astra-stepper--xs">
                      <button
                        class="astra-step-btn dec-sub-weight"
                        data-section-id="${section.id}"
                        data-sub-id="${sub.id}"
                      >
                        <i class="fa-solid fa-minus"></i>
                      </button>
                      <div class="astra-stepper-center">
                        <input
                          type="number"
                          class="astra-sub-weight-input"
                          data-section-id="${section.id}"
                          data-sub-id="${sub.id}"
                          value="${sub.weight}"
                          step="0.25"
                        />
                      </div>
                      <button
                        class="astra-step-btn inc-sub-weight"
                        data-section-id="${section.id}"
                        data-sub-id="${sub.id}"
                      >
                        <i class="fa-solid fa-plus"></i>
                      </button>
                    </div>
                  </div>
                `
              )}
            </div>
          `
        )}
      </div>
    `;
  }

  /** Bind the existing controls to the single durable writer. */
  protected bindEvents(): void {
    const separateAiring = this.$<HTMLElement>('#astra-separate-airing-toggle');
    if (separateAiring) {
      this.addEventListener(separateAiring, 'click', () => {
        const next = !this.dashboardStore.getState().separateAiring;
        this.dashboardStore.setSeparateAiring(next);
        separateAiring.classList.toggle('active', next);
        separateAiring.setAttribute('aria-checked', String(next));
      });
      this.addEventListener(separateAiring, 'keydown', (event) => {
        const keyboardEvent = event as KeyboardEvent;
        if (keyboardEvent.key !== ' ' && keyboardEvent.key !== 'Enter') return;
        keyboardEvent.preventDefault();
        separateAiring.click();
      });
    }
    this.$$('.astra-toggle').forEach(toggle => {
      this.addEventListener(toggle, 'click', () => {
        const setting = toggle.dataset.setting;
        if (setting !== 'enableSeriesFinale' && setting !== 'appendAstraToComment') return;
        this.save(async () => {
          await this.service.updateSettings({ [setting]: !this.service.getSettings()[setting] });
        }, () => toggle.classList.toggle('active', this.service.getSettings()[setting]));
      });
    });
    const multiplier = this.$<HTMLInputElement>('#multiplier-input');
    if (multiplier) {
      this.addEventListener(multiplier, 'change', () => {
        const value = Number.parseFloat(multiplier.value);
        if (!Number.isFinite(value) || value < 1) {
          this.toast.error('Invalid multiplier! Min: 1');
          multiplier.value = String(this.service.getSettings().finaleWeightMultiplier);
          return;
        }
        this.save(() => this.service.updateSettings({ finaleWeightMultiplier: value }));
      });
      for (const [selector, delta] of [['#inc-multiplier', 0.5], ['#dec-multiplier', -0.5]] as const) {
        const button = this.$(selector);
        if (button) this.addEventListener(button, 'click', () => this.save(async () => {
          const value = Math.max(1, this.service.getSettings().finaleWeightMultiplier + delta);
          await this.service.updateSettings({ finaleWeightMultiplier: value });
        }, () => { multiplier.value = String(this.service.getSettings().finaleWeightMultiplier); }));
      }
    }
    this.bindSectionControls();
    this.bindDataControls();
  }

  private save(action: () => Promise<void>, completed: () => void = () => {}): void {
    const scope = this.actions.capture();
    void this.actions.run(scope, action, completed, error => {
      logger.warn('[AstraSettings] Configuration save failed', error);
      this.toast.error('Could not save configuration. Please try again.');
      this.update();
    });
  }

  private weight(sectionId: string, subId?: string): number | undefined {
    const section = this.service.getSections().find(item => item.id === sectionId);
    return subId ? section?.subSections?.find(item => item.id === subId)?.weight : section?.weight;
  }
  private setWeight(sectionId: string, subId: string | undefined, value: number): Promise<void> {
    return subId ? this.service.updateSubSectionWeight(sectionId, subId, value)
      : this.service.updateSectionWeight(sectionId, value);
  }
  private refreshWeight(input: HTMLInputElement, sectionId: string, subId?: string): void {
    const value = this.weight(sectionId, subId);
    if (value === undefined) return;
    input.value = String(value);
    if (!subId) {
      const label = input.closest('.astra-section-config-card')?.querySelector('.astra-section-weight-info b');
      if (label) label.textContent = String(value);
    }
  }

  private bindSectionControls(): void {
    this.$$<HTMLInputElement>('.astra-weight-input, .astra-sub-weight-input').forEach(input => {
      const sectionId = input.dataset.sectionId ?? input.dataset.id;
      const subId = input.dataset.subId;
      if (!sectionId) return;
      this.addEventListener(input, 'change', () => {
        const value = Number.parseFloat(input.value);
        if (!Number.isFinite(value) || value < 0) {
          this.toast.error('Invalid weight! Min: 0');
          this.refreshWeight(input, sectionId, subId);
          return;
        }
        this.save(() => this.setWeight(sectionId, subId, value),
          () => this.refreshWeight(input, sectionId, subId));
      });
    });
    this.$$('.inc-weight, .dec-weight, .inc-sub-weight, .dec-sub-weight').forEach(button => {
      const sectionId = button.dataset.sectionId ?? button.dataset.id;
      const subId = button.dataset.subId;
      if (!sectionId) return;
      const input = button.closest('.astra-stepper')?.querySelector<HTMLInputElement>('input');
      const delta = button.classList.contains('inc-weight') || button.classList.contains('inc-sub-weight') ? 0.25 : -0.25;
      this.addEventListener(button, 'click', event => {
        event.stopPropagation();
        this.save(async () => {
          const value = this.weight(sectionId, subId);
          if (value !== undefined) await this.setWeight(sectionId, subId, Math.max(0, value + delta));
        }, () => { if (input) this.refreshWeight(input, sectionId, subId); });
      });
    });
    this.$$<HTMLInputElement>('.astra-section-name-input, .astra-sub-name-input').forEach(input => {
      const sectionId = input.dataset.sectionId ?? input.dataset.id;
      const subId = input.dataset.subId;
      if (!sectionId) return;
      this.addEventListener(input, 'change', () => {
        const name = input.value.trim();
        if (!name) {
          // A blank label is not a valid name: restore the saved one rather than leave the field empty.
          const section = this.service.getSections().find(item => item.id === sectionId);
          input.value = (subId ? section?.subSections?.find(item => item.id === subId)?.name : section?.name) ?? '';
          this.toast.error('Name cannot be empty; the previous name was restored.');
          return;
        }
        this.save(() => subId ? this.service.updateSubSectionName(sectionId, subId, name)
          : this.service.updateSectionName(sectionId, name),
        () => this.toast.info(subId ? 'Sub-section renamed' : 'Section renamed'));
      });
    });
    const addSection = this.$('#astra-add-section');
    if (addSection) this.addEventListener(addSection, 'click', () => {
      const name = prompt('Enter name for the new scoring section:')?.trim();
      if (name) this.save(() => this.service.addSection(name), () => {
        this.toast.success('Section added!'); this.update();
      });
    });
    this.$$('.astra-add-sub').forEach(button => this.addEventListener(button, 'click', () => {
      const sectionId = button.dataset.id;
      const name = prompt('Enter name for the new sub-section:')?.trim();
      if (sectionId && name) this.save(() => this.service.addSubSection(sectionId, name), () => {
        this.toast.success('Sub-section added!'); this.update();
      });
    }));
    this.$$('.astra-remove-section, .astra-remove-sub').forEach(button => {
      this.addEventListener(button, 'click', event => {
        event.stopPropagation();
        const sectionId = button.dataset.sectionId ?? button.dataset.id;
        const subId = button.dataset.subId;
        if (!sectionId || !confirm(subId ? 'Remove this sub-section? This will affect your overall score calculation.'
          : 'Remove this section? This will affect your overall score calculation.')) return;
        this.save(() => subId ? this.service.removeSubSection(sectionId, subId)
          : this.service.removeSection(sectionId), () => {
          this.toast.success(subId ? 'Sub-section removed' : 'Section removed'); this.update();
        });
      });
    });
  }

  private busy(scope: AstraSettingsScope, button: HTMLButtonElement): () => void {
    button.disabled = true;
    button.classList.add('loading');
    return this.actions.track(scope, () => { button.disabled = false; button.classList.remove('loading'); });
  }
  private perform<T>(button: HTMLButtonElement, action: () => Promise<T>, completed: (value: T, scope: AstraSettingsScope) => void,
    errorMessage: string): void {
    if (button.disabled) return;
    const scope = this.actions.capture();
    const release = this.busy(scope, button);
    void this.actions.run(scope, action, result => completed(result, scope), error => {
      logger.warn('[AstraSettings] Data operation failed', error); this.toast.error(errorMessage);
    }).finally(release);
  }

  private bindDataControls(): void {
    const sync = this.$<HTMLButtonElement>('#astra-sync-list');
    if (sync) this.addEventListener(sync, 'click', () => this.perform(sync, () => {
      this.toast.info('Syncing with AniList... This may take a while.');
      return this.service.syncWithAniList();
    }, (result, scope) => {
      this.toast.success(`Sync complete! Added: ${result.added}, Updated: ${result.updated}`);
      this.actions.schedule(scope, () => {
        // Do not replace the form while a later configuration write is pending.
        void this.actions.run(scope, async () => {}, () => this.update(), () => {});
      }, 500);
    }, 'Sync failed. Please try again.'));
    const exportButton = this.$<HTMLButtonElement>('#astra-export-json');
    if (exportButton) this.addEventListener(exportButton, 'click', () => this.perform(exportButton,
      () => this.service.exportJSON(), json => {
        try {
          const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
          try {
            const anchor = document.createElement('a'); anchor.href = url;
            anchor.download = `astra_backup_${new Date().toISOString().split('T')[0]}.json`; anchor.click();
          } finally { URL.revokeObjectURL(url); }
          this.toast.success('Data exported successfully!');
        } catch (error) {
          logger.warn('[AstraSettings] Export download failed', error); this.toast.error('Export failed.');
        }
      }, 'Export failed.'));
    const importButton = this.$<HTMLButtonElement>('#astra-import-json');
    if (importButton) this.addEventListener(importButton, 'click', () => {
      if (importButton.disabled) return;
      const scope = this.actions.capture();
      const input = document.createElement('input'); input.type = 'file'; input.accept = '.json';
      const release = this.actions.track(scope, () => {
        input.onchange = null; input.removeEventListener('cancel', release); input.remove();
      });
      input.addEventListener('cancel', release, { once: true });
      input.onchange = () => {
        const file = input.files?.[0]; release();
        if (file && this.actions.current(scope) && !importButton.disabled) this.readImport(file, scope, importButton);
      };
      input.click();
    });
    const reset = this.$<HTMLButtonElement>('#astra-reset-data');
    if (reset) this.addEventListener(reset, 'click', () => {
      if (reset.disabled || !confirm('ARE YOU SURE? This will permanently delete ALL your Astra ratings and notes. This cannot be undone.')) return;
      this.perform(reset, () => this.service.factoryReset(), () => {
        this.toast.success('All data cleared!'); this.update();
      }, 'Reset failed.');
    });
  }

  private readImport(file: File, scope: AstraSettingsScope, button: HTMLButtonElement): void {
    // UTF-8 may take up to three bytes per UTF-16 code unit. The parser still
    // enforces the original character limit after reading; this bounds memory.
    if (file.size > MAX_ASTRA_BACKUP_CHARACTERS * 3 + 3) {
      this.toast.error('Import failed: Backup is too large.'); return;
    }
    const releaseBusy = this.busy(scope, button);
    const reader = new FileReader();
    const releaseReader = this.actions.track(scope, () => {
      reader.onload = null; reader.onerror = null; reader.onabort = null;
      if (reader.readyState === FileReader.LOADING) reader.abort();
    });
    const failedRead = () => {
      releaseReader(); releaseBusy();
      if (this.actions.current(scope)) this.toast.error('Import failed: Could not read the file.');
    };
    reader.onerror = failedRead; reader.onabort = failedRead;
    reader.onload = () => {
      const content = reader.result; releaseReader();
      if (!this.actions.current(scope)) { releaseBusy(); return; }
      if (typeof content !== 'string') { failedRead(); return; }
      const loader = this.createImportOverlay(scope);
      void this.actions.run(scope, () => this.service.importJSON(content), success => {
        if (success) {
          this.toast.success('Data imported! Reloading...');
          this.actions.schedule(scope, () => { loader.remove(); window.location.reload(); }, 1500);
        } else { loader.remove(); this.toast.error('Import failed: Invalid format.'); }
      }, error => {
        loader.remove(); logger.warn('[AstraSettings] Import failed', error); this.toast.error('Import failed.');
      }).finally(releaseBusy);
    };
    try { reader.readAsText(file); } catch { failedRead(); }
  }

  /**
   * Full-screen animated overlay shown while a JSON import is being restored,
   * so the operation feels active instead of frozen. Returns a `remove()` to
   * tear it down on failure (on success the page reloads over it).
   */
  private createImportOverlay(scope: AstraSettingsScope): { remove: () => void } {
    const overlay = document.createElement('div');
    overlay.className = 'astra-import-overlay';
    overlay.innerHTML = `
      <div class="astra-import-card">
        <div class="astra-import-logo" aria-hidden="true">
          <svg viewBox="4.5 4 15 16" width="46" height="46"><path d="M12 4L4.5 20H7L12 10.5L17 20H19.5L12 4Z"></path><path d="M12 10.5L10.75 14.1H13.25L12 10.5Z"></path></svg>
        </div>
        <h2 class="astra-import-title">Importing your archive</h2>
        <p class="astra-import-status">Reading your backup…</p>
        <div class="astra-import-progress" role="progressbar" aria-label="Importing">
          <div class="astra-import-progress-bar"></div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    const frame = requestAnimationFrame(() => overlay.classList.add('astra-import-overlay--open'));

    const messages = [
      'Reading your backup…',
      'Restoring ratings & notes…',
      'Rebuilding your archive…',
      'Almost there…',
    ];
    let i = 0;
    const statusEl = overlay.querySelector('.astra-import-status') as HTMLElement | null;
    const timer = window.setInterval(() => {
      i = (i + 1) % messages.length;
      if (statusEl) statusEl.textContent = messages[i];
    }, 1200);
    let closing = false;
    let closeTimer: number | undefined;
    const release = this.actions.track(scope, () => {
      cancelAnimationFrame(frame);
      clearInterval(timer);
      clearTimeout(closeTimer);
      overlay.remove();
    });

    return {
      remove: () => {
        if (closing) return;
        closing = true;
        cancelAnimationFrame(frame);
        clearInterval(timer);
        overlay.classList.remove('astra-import-overlay--open');
        closeTimer = window.setTimeout(release, 250);
      },
    };
  }
}
