/**
 * @file AstraSettingsView.ts
 * @description Component for managing Astra weighted sections
 */

import { AstraView } from '../base/AstraView';
import { AstraService } from '../../AstraService';
import type { AstraSettings } from '../../AstraInterfaces';
import { ToastService } from '@core/services/ToastService';
import { container } from 'tsyringe';
import { TOKENS } from '@core/di/tokens';

export class AstraSettingsView extends AstraView {
  constructor(private service: AstraService) {
    super({});
  }

  protected template(): string {
    const sections = this.service.getSections();
    const settings = this.service.getSettings();
    const hasFinale = this.service.hasFinaleSection();

    return `
      <div class="astra-settings-tab">
        <div class="astra-settings-header">
          <div class="astra-settings-title-group">
            <h2>Astra Configuration</h2>
            <p class="astra-muted">Fine-tune your rating experience and integration preferences. <b>Changes are saved automatically.</b></p>
          </div>
        </div>

        <div class="astra-settings-grid">
          <div class="astra-settings-section">
            <h3 class="astra-section-title"><i class="fa fa-sliders"></i> Global Preferences</h3>
            <div class="astra-settings-item ${!hasFinale ? 'astra-settings-item--warning' : ''}">
              <div class="astra-settings-info">
                <div class="astra-settings-label-row">
                  <span class="astra-settings-label">Series Finale Scoring</span>
                  ${!hasFinale ? '<span class="astra-badge-warn"><i class="fa fa-exclamation-triangle"></i> Requires "Finale" section</span>' : ''}
                </div>
                <span class="astra-settings-desc">Apply extra weight to the "Finale" section for the last episode of a series.</span>
              </div>
              <div class="astra-settings-controls">
                <div class="astra-stepper astra-stepper--inline">
                  <button class="astra-step-btn" id="dec-multiplier"><i class="fa fa-minus"></i></button>
                  <div class="astra-stepper-center">
                    <input type="number" id="multiplier-input" value="${settings.finaleWeightMultiplier}" step="0.5" min="1">
                    <span class="astra-unit">x</span>
                  </div>
                  <button class="astra-step-btn" id="inc-multiplier"><i class="fa fa-plus"></i></button>
                </div>
                <div class="astra-toggle ${settings.enableSeriesFinale ? 'active' : ''}" data-setting="enableSeriesFinale">
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
                <span class="astra-settings-desc">Include the detailed breakdown (scores, journal) in your AniList activity notes.</span>
              </div>
              <div class="astra-toggle ${settings.appendAstraToComment ? 'active' : ''}" data-setting="appendAstraToComment">
                <div class="astra-toggle-handle"></div>
              </div>
            </div>
          </div>

          <div class="astra-settings-section">
            <div class="astra-settings-section-header">
              <h3 class="astra-section-title"><i class="fa fa-layer-group"></i> Scoring Configuration</h3>
              <button class="astra-btn astra-btn--secondary astra-btn--sm" id="astra-add-section">
                <i class="fa fa-plus"></i> Add Section
              </button>
            </div>
            <div class="astra-sections-list">
              ${sections.map(s => this.renderSectionItem(s)).join('')}
            </div>
          </div>

          <div class="astra-settings-section">
            <h3 class="astra-section-title"><i class="fa fa-database"></i> Data Management</h3>
            <div class="astra-settings-grid-2col">
              <div class="astra-settings-item">
                <div class="astra-settings-info">
                  <span class="astra-settings-label">Sync with AniList</span>
                  <span class="astra-settings-desc">Fetch and update all media entries from your AniList profile.</span>
                </div>
                <button class="astra-btn astra-btn--secondary" id="astra-sync-list">
                  <i class="fa fa-sync"></i> Sync List
                </button>
              </div>
              <div class="astra-settings-item">
                <div class="astra-settings-info">
                  <span class="astra-settings-label">Export Data</span>
                  <span class="astra-settings-desc">Download all your Astra ratings and notes as a JSON file.</span>
                </div>
                <button class="astra-btn astra-btn--secondary" id="astra-export-json">
                  <i class="fa fa-download"></i> Export JSON
                </button>
              </div>
              <div class="astra-settings-item">
                <div class="astra-settings-info">
                  <span class="astra-settings-label">Import Data</span>
                  <span class="astra-settings-desc">Restore your Astra database from a previously exported JSON file.</span>
                </div>
                <button class="astra-btn astra-btn--secondary" id="astra-import-json">
                  <i class="fa fa-upload"></i> Import JSON
                </button>
              </div>
              <div class="astra-settings-item destructive">
                <div class="astra-settings-info">
                  <span class="astra-settings-label">Delete All Data</span>
                  <span class="astra-settings-desc">Permanently delete all ratings, notes, and configurations. <b>This cannot be undone.</b></span>
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

  private renderSectionItem(section: any): string {
    const hasSubSections = section.subSections && section.subSections.length > 0;
    
    return `
      <div class="astra-section-config-card ${hasSubSections ? 'has-subs' : ''}" data-id="${section.id}">
        <div class="astra-section-header-row">
          <div class="astra-section-meta">
            <input type="text" class="astra-section-name-input" data-id="${section.id}" value="${section.name}" placeholder="Section Name">
            <span class="astra-section-weight-info">Overall weight: <b>${section.weight}</b></span>
          </div>
          <div class="astra-section-controls">
            <div class="astra-stepper astra-stepper--inline">
              <button class="astra-step-btn dec-weight" data-id="${section.id}"><i class="fa fa-minus"></i></button>
              <div class="astra-stepper-center">
                <input type="number" class="astra-weight-input" data-id="${section.id}" value="${section.weight}" step="0.25" min="0">
              </div>
              <button class="astra-step-btn inc-weight" data-id="${section.id}"><i class="fa fa-plus"></i></button>
            </div>
            <button class="astra-icon-btn destructive astra-remove-section" data-id="${section.id}" title="Remove Section">
              <i class="fa-solid fa-trash-can"></i>
            </button>
            <button class="astra-icon-btn astra-add-sub" data-id="${section.id}" title="Add Sub-section">
              <i class="fa fa-plus-circle"></i>
            </button>
          </div>
        </div>

        ${hasSubSections ? `
          <div class="astra-subsections-grid">
            ${section.subSections.map((sub: any) => `
              <div class="astra-subsection-item">
                <div class="astra-sub-info">
                  <input type="text" class="astra-sub-name-input" data-section-id="${section.id}" data-sub-id="${sub.id}" value="${sub.name}" placeholder="Sub-section Name">
                  <button class="astra-remove-sub" data-section-id="${section.id}" data-sub-id="${sub.id}" title="Remove Sub-section">×</button>
                </div>
                <div class="astra-stepper astra-stepper--xs">
                  <button class="astra-step-btn dec-sub-weight" data-section-id="${section.id}" data-sub-id="${sub.id}"><i class="fa fa-minus"></i></button>
                  <div class="astra-stepper-center">
                    <input type="number" class="astra-sub-weight-input" data-section-id="${section.id}" data-sub-id="${sub.id}" value="${sub.weight}" step="0.25">
                  </div>
                  <button class="astra-step-btn inc-sub-weight" data-section-id="${section.id}" data-sub-id="${sub.id}"><i class="fa fa-plus"></i></button>
                </div>
              </div>
            `).join('')}
          </div>
        ` : ''}
      </div>
    `;
  }

  protected bindEvents(): void {
    const toast = container.resolve<ToastService>(TOKENS.ToastService);
    
    this.$$('.astra-toggle').forEach(toggle => {
      toggle.addEventListener('click', () => {
        const setting = toggle.dataset.setting as keyof AstraSettings;
        if (!setting) return;

        const isActive = toggle.classList.toggle('active');
        this.service.updateSettings({ [setting]: isActive });
        toast.info(`Updated: ${setting}`);
      });
    });

    const multiplierInput = this.$('#multiplier-input') as HTMLInputElement;
    
    // Finale Multiplier - Manual Input
    multiplierInput.addEventListener('change', () => {
      const val = parseFloat(multiplierInput.value);
      if (isNaN(val) || val < 1) {
        toast.error('Invalid multiplier! Min: 1');
        multiplierInput.value = this.service.getSettings().finaleWeightMultiplier.toString();
        return;
      }
      this.service.updateSettings({ finaleWeightMultiplier: val });
    });

    this.$('#inc-multiplier')?.addEventListener('click', () => {
      const val = parseFloat(multiplierInput.value) + 0.5;
      multiplierInput.value = val.toString();
      this.service.updateSettings({ finaleWeightMultiplier: val });
    });

    this.$('#dec-multiplier')?.addEventListener('click', () => {
      const val = Math.max(1, parseFloat(multiplierInput.value) - 0.5);
      multiplierInput.value = val.toString();
      this.service.updateSettings({ finaleWeightMultiplier: val });
    });

    // Section Weights - Manual Input
    this.$$('.astra-weight-input').forEach(input => {
      const inputEl = input as HTMLInputElement;
      inputEl.addEventListener('change', () => {
        const id = inputEl.dataset.id!;
        const val = parseFloat(inputEl.value);
        if (isNaN(val) || val < 0) {
          toast.error('Invalid weight! Min: 0');
          const original = this.service.getSections().find(s => s.id === id)?.weight || 1;
          inputEl.value = original.toString();
          return;
        }
        this.service.updateSectionWeight(id, val);
      });
    });

    this.$$('.inc-weight').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = (btn as HTMLElement).dataset.id!;
        const sections = this.service.getSections();
        const section = sections.find(s => s.id === id);
        if (section) {
          const newWeight = section.weight + 0.25;
          this.service.updateSectionWeight(id, newWeight);
          const input = this.$(`.astra-weight-input[data-id="${id}"]`) as HTMLInputElement;
          if (input) input.value = newWeight.toString();
        }
      });
    });

    this.$$('.dec-weight').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = (btn as HTMLElement).dataset.id!;
        const sections = this.service.getSections();
        const section = sections.find(s => s.id === id);
        if (section && section.weight > 0.25) {
          const newWeight = section.weight - 0.25;
          this.service.updateSectionWeight(id, newWeight);
          const input = this.$(`.astra-weight-input[data-id="${id}"]`) as HTMLInputElement;
          if (input) input.value = newWeight.toString();
        }
      });
    });


    // Add Section
    this.$('#astra-add-section')?.addEventListener('click', async () => {
      const name = prompt('Enter name for the new scoring section:');
      if (name && name.trim()) {
        await this.service.addSection(name.trim());
        this.update();
        toast.success(`Section "${name}" added!`);
      }
    });

    // Section Renaming
    this.$$('.astra-section-name-input').forEach(input => {
      const el = input as HTMLInputElement;
      el.addEventListener('change', async () => {
        const id = el.dataset.id!;
        const newName = el.value.trim();
        if (newName) {
          await this.service.updateSectionName(id, newName);
          toast.info('Section renamed');
        }
      });
    });

    // Remove Section
    this.$$('.astra-remove-section').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = (btn as HTMLElement).dataset.id!;
        if (confirm(`Remove section "${id}"? This will affect your overall score calculation.`)) {
          await this.service.removeSection(id);
          this.update();
          toast.success('Section removed');
        }
      });
    });

    // Sub-section Renaming
    this.$$('.astra-sub-name-input').forEach(input => {
      const el = input as HTMLInputElement;
      el.addEventListener('change', async () => {
        const { sectionId, subId } = el.dataset;
        const newName = el.value.trim();
        if (newName && sectionId && subId) {
          await this.service.updateSubSectionName(sectionId, subId, newName);
          toast.info('Sub-section renamed');
        }
      });
    });

    // Add Sub-section
    this.$$('.astra-add-sub').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const sectionId = (btn as HTMLElement).dataset.id!;
        const name = prompt('Enter name for the sub-section (e.g. Intro, OST):');
        if (name && name.trim()) {
          await this.service.addSubSection(sectionId, name.trim());
          this.update();
          toast.success('Sub-section added');
        }
      });
    });

    // Remove Sub-section
    this.$$('.astra-remove-sub').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const { sectionId, subId } = (btn as HTMLElement).dataset;
        if (confirm('Remove this sub-section?')) {
          await this.service.removeSubSection(sectionId!, subId!);
          this.update();
        }
      });
    });

    // Sub-section Weights
    this.$$('.inc-sub-weight').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const { sectionId, subId } = (btn as HTMLElement).dataset;
        const section = this.service.getSections().find(s => s.id === sectionId);
        const sub = section?.subSections?.find(s => s.id === subId);
        if (sub) {
          const newVal = sub.weight + 0.25;
          await this.service.updateSubSectionWeight(sectionId!, subId!, newVal);
          this.update();
        }
      });
    });

    this.$$('.dec-sub-weight').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const { sectionId, subId } = (btn as HTMLElement).dataset;
        const section = this.service.getSections().find(s => s.id === sectionId);
        const sub = section?.subSections?.find(s => s.id === subId);
        if (sub) {
          const newVal = Math.max(0, sub.weight - 0.25);
          await this.service.updateSubSectionWeight(sectionId!, subId!, newVal);
          this.update();
        }
      });
    });

    this.$$('.astra-sub-weight-input').forEach(input => {
      const el = input as HTMLInputElement;
      el.addEventListener('change', async () => {
        const { sectionId, subId } = el.dataset;
        const val = parseFloat(el.value);
        if (!isNaN(val) && val >= 0) {
          await this.service.updateSubSectionWeight(sectionId!, subId!, val);
        } else {
          this.update(); // Revert
        }
      });
    });

    // Data Management
    this.$('#astra-sync-list')?.addEventListener('click', async () => {
      const btn = this.$('#astra-sync-list')!;
      btn.classList.add('loading');
      toast.info('Syncing with AniList... This may take a while.');
      
      try {
        const result = await this.service.syncWithAniList();
        toast.success(`Sync complete! Added: ${result.added}, Updated: ${result.updated}`);
      } catch (err) {
        toast.error('Sync failed. Check console for details.');
      } finally {
        btn.classList.remove('loading');
      }
    });

    this.$('#astra-export-json')?.addEventListener('click', async () => {
      try {
        const json = await this.service.exportJSON();
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `astra_backup_${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
        toast.success('Data exported successfully!');
      } catch (err) {
        toast.error('Export failed.');
      }
    });

    this.$('#astra-import-json')?.addEventListener('click', () => {
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
              toast.success('Data imported! Reloading...');
              setTimeout(() => window.location.reload(), 1500);
            } else {
              toast.error('Import failed: Invalid format.');
            }
          } catch (err) {
            toast.error('Import failed.');
          }
        };
        reader.readAsText(file);
      };
      input.click();
    });

    this.$('#astra-reset-data')?.addEventListener('click', async () => {
      if (confirm('ARE YOU SURE? This will permanently delete ALL your Astra ratings and notes. This cannot be undone.')) {
        try {
          await this.service.factoryReset();
          toast.success('All data cleared! Reloading...');
          setTimeout(() => window.location.reload(), 1500);
        } catch (err) {
          toast.error('Reset failed.');
        }
      }
    });
  }
}
