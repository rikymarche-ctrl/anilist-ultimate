/**
 * @file AstraSettingsView.ts
 * @description Component for managing Astra weighted sections and global configurations.
 * Refactored to use DI and secure `html` templates.
 */

import { injectable, inject } from 'tsyringe';
import { AstraView } from '../base/AstraView';
import { AstraService } from '../../AstraService';
import type { AstraSettings } from '../../AstraInterfaces';
import { ToastService } from '@core/services/ToastService';
import { TOKENS } from '@core/di/tokens';
import { html, map, when } from '@core/utils/Template';

@injectable()
export class AstraSettingsView extends AstraView {
  constructor(
    @inject(TOKENS.AstraService) private service: AstraService,
    @inject(TOKENS.ToastService) private toast: ToastService
  ) {
    super({});
    // Safety re-render after DI assignment
    this.element = this.render();
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
            <h3 class="astra-section-title"><i class="fa fa-sliders"></i> Global Preferences</h3>
            <div class="astra-settings-item ${when(!hasFinale, 'astra-settings-item--warning')}">
              <div class="astra-settings-info">
                <div class="astra-settings-label-row">
                  <span class="astra-settings-label">Series Finale Scoring</span>
                  ${when(
                    !hasFinale,
                    html`<span class="astra-badge-warn"
                      ><i class="fa fa-exclamation-triangle"></i> Requires "Finale" section</span
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
                    <i class="fa fa-minus"></i>
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
                    <i class="fa fa-plus"></i>
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
            <h3 class="astra-section-title"><i class="fa fa-sync"></i> AniList Integration</h3>
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
                <i class="fa fa-layer-group"></i> Scoring Configuration
              </h3>
              <button class="astra-btn astra-btn--secondary astra-btn--sm" id="astra-add-section">
                <i class="fa fa-plus"></i> Add Section
              </button>
            </div>
            <div class="astra-sections-list">
              ${map(sections, (s) => this.renderSectionItem(s))}
            </div>
          </div>

          <div class="astra-settings-section">
            <h3 class="astra-section-title"><i class="fa fa-database"></i> Data Management</h3>
            <div class="astra-settings-grid-2col">
              <div class="astra-settings-item">
                <div class="astra-settings-info">
                  <span class="astra-settings-label">Sync with AniList</span>
                  <span class="astra-settings-desc"
                    >Fetch and update all media entries from your AniList profile.</span
                  >
                </div>
                <button class="astra-btn astra-btn--secondary" id="astra-sync-list">
                  <i class="fa fa-sync"></i> Sync List
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
                  <i class="fa fa-download"></i> Export JSON
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
                  <i class="fa fa-upload"></i> Import JSON
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
                  <i class="fa fa-trash"></i> Delete All
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
  private renderSectionItem(section: any): HTMLElement {
    const hasSubSections = section.subSections && section.subSections.length > 0;

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
                <i class="fa fa-minus"></i>
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
                <i class="fa fa-plus"></i>
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
              <i class="fa fa-plus-circle"></i>
            </button>
          </div>
        </div>

        ${when(
          hasSubSections,
          html`
            <div class="astra-subsections-grid">
              ${map(
                section.subSections,
                (sub: any) => html`
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
                        <i class="fa fa-minus"></i>
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
                        <i class="fa fa-plus"></i>
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

  /**
   * Binds configuration events (toggles, steppers, data management).
   */
  protected bindEvents(): void {
    this.$$('.astra-toggle').forEach((toggle) => {
      this.addEventListener(toggle, 'click', () => {
        const setting = toggle.dataset.setting as keyof AstraSettings;
        if (!setting) return;

        const isActive = toggle.classList.toggle('active');
        this.service.updateSettings({ [setting]: isActive });
      });
    });

    const multiplierInput = this.$('#multiplier-input') as HTMLInputElement;
    if (multiplierInput) {
      this.addEventListener(multiplierInput, 'change', () => {
        const val = parseFloat(multiplierInput.value);
        if (isNaN(val) || val < 1) {
          this.toast.error('Invalid multiplier! Min: 1');
          multiplierInput.value = this.service.getSettings().finaleWeightMultiplier.toString();
          return;
        }
        this.service.updateSettings({ finaleWeightMultiplier: val });
      });
    }

    const incMult = this.$('#inc-multiplier');
    if (incMult) {
      this.addEventListener(incMult, 'click', () => {
        const val = parseFloat(multiplierInput.value) + 0.5;
        multiplierInput.value = val.toString();
        this.service.updateSettings({ finaleWeightMultiplier: val });
      });
    }

    const decMult = this.$('#dec-multiplier');
    if (decMult) {
      this.addEventListener(decMult, 'click', () => {
        const val = Math.max(1, parseFloat(multiplierInput.value) - 0.5);
        multiplierInput.value = val.toString();
        this.service.updateSettings({ finaleWeightMultiplier: val });
      });
    }

    // Section Weights
    this.$$('.astra-weight-input').forEach((input) => {
      this.addEventListener(input as HTMLElement, 'change', () => {
        const inputEl = input as HTMLInputElement;
        const id = inputEl.dataset.id!;
        const val = parseFloat(inputEl.value);
        if (isNaN(val) || val < 0) {
          this.toast.error('Invalid weight! Min: 0');
          const original = this.service.getSections().find((s) => s.id === id)?.weight || 1;
          inputEl.value = original.toString();
          return;
        }
        this.service.updateSectionWeight(id, val);
      });
    });

    this.$$('.inc-weight').forEach((btn) => {
      this.addEventListener(btn as HTMLElement, 'click', (e) => {
        e.stopPropagation();
        const id = (btn as HTMLElement).dataset.id!;
        const sections = this.service.getSections();
        const section = sections.find((s) => s.id === id);
        if (section) {
          const newWeight = section.weight + 0.25;
          this.service.updateSectionWeight(id, newWeight);
          const input = this.$(`.astra-weight-input[data-id="${id}"]`) as HTMLInputElement;
          if (input) input.value = newWeight.toString();
        }
      });
    });

    this.$$('.dec-weight').forEach((btn) => {
      this.addEventListener(btn as HTMLElement, 'click', (e) => {
        e.stopPropagation();
        const id = (btn as HTMLElement).dataset.id!;
        const sections = this.service.getSections();
        const section = sections.find((s) => s.id === id);
        if (section && section.weight > 0.25) {
          const newWeight = section.weight - 0.25;
          this.service.updateSectionWeight(id, newWeight);
          const input = this.$(`.astra-weight-input[data-id="${id}"]`) as HTMLInputElement;
          if (input) input.value = newWeight.toString();
        }
      });
    });

    // Add Section
    const addSectionBtn = this.$('#astra-add-section');
    if (addSectionBtn) {
      this.addEventListener(addSectionBtn, 'click', async () => {
        const name = prompt('Enter name for the new scoring section:');
        if (name && name.trim()) {
          await this.service.addSection(name.trim());
          this.update();
          this.toast.success(`Section "${name}" added!`);
        }
      });
    }

    // Section Renaming
    this.$$('.astra-section-name-input').forEach((input) => {
      this.addEventListener(input as HTMLElement, 'change', async () => {
        const el = input as HTMLInputElement;
        const id = el.dataset.id!;
        const newName = el.value.trim();
        if (newName) {
          await this.service.updateSectionName(id, newName);
          this.toast.info('Section renamed');
        }
      });
    });

    // Remove Section
    this.$$('.astra-remove-section').forEach((btn) => {
      this.addEventListener(btn as HTMLElement, 'click', async (e) => {
        e.stopPropagation();
        const id = (btn as HTMLElement).dataset.id!;
        if (confirm(`Remove section "${id}"? This will affect your overall score calculation.`)) {
          await this.service.removeSection(id);
          this.update();
          this.toast.success('Section removed');
        }
      });
    });

    // Data Management Sync
    const syncBtn = this.$('#astra-sync-list');
    if (syncBtn) {
      this.addEventListener(syncBtn, 'click', async () => {
        syncBtn.classList.add('loading');
        this.toast.info('Syncing with AniList... This may take a while.');

        try {
          const result = await this.service.syncWithAniList();
          this.toast.success(`Sync complete! Added: ${result.added}, Updated: ${result.updated}`);
          // Force a small delay to let the user see the success before any potential re-renders
          setTimeout(() => this.update(), 500);
        } catch (err) {
          this.toast.error('Sync failed. Check console for details.');
        } finally {
          syncBtn.classList.remove('loading');
        }
      });
    }

    // Data Export
    const exportBtn = this.$('#astra-export-json');
    if (exportBtn) {
      this.addEventListener(exportBtn, 'click', async () => {
        try {
          const json = await this.service.exportJSON();
          const blob = new Blob([json], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `astra_backup_${new Date().toISOString().split('T')[0]}.json`;
          a.click();
          URL.revokeObjectURL(url);
          this.toast.success('Data exported successfully!');
        } catch (err) {
          this.toast.error('Export failed.');
        }
      });
    }

    // Data Import
    const importBtn = this.$('#astra-import-json');
    if (importBtn) {
      this.addEventListener(importBtn, 'click', () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = async (e) => {
          const file = (e.target as HTMLInputElement).files?.[0];
          if (!file) return;

          const reader = new FileReader();
          reader.onload = async (ev) => {
            try {
              const content = ev.target?.result as string;
              const success = await this.service.importJSON(content);
              if (success) {
                this.toast.success('Data imported! Reloading...');
                setTimeout(() => window.location.reload(), 1500);
              } else {
                this.toast.error('Import failed: Invalid format.');
              }
            } catch (err) {
              this.toast.error('Import failed.');
            }
          };
          reader.readAsText(file);
        };
        input.click();
      });
    }

    // Factory Reset
    const resetBtn = this.$('#astra-reset-data');
    if (resetBtn) {
      this.addEventListener(resetBtn, 'click', async () => {
        if (
          confirm(
            'ARE YOU SURE? This will permanently delete ALL your Astra ratings and notes. This cannot be undone.'
          )
        ) {
          try {
            await this.service.factoryReset();
            this.update();
            this.toast.success('All data cleared!');
          } catch (err) {
            this.toast.error('Reset failed.');
          }
        }
      });
    }
  }
}
