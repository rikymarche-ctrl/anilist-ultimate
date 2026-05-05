/**
 * @file AstraSettingsView.ts
 * @description Component for managing Astra weighted sections
 */

import { AstraView } from '../base/AstraView';
import { AstraService } from '../../AstraService';
import { ToastService } from '@core/services/ToastService';
import { container } from 'tsyringe';
import { TOKENS } from '@core/di/tokens';

export class AstraSettingsView extends AstraView {
  constructor(private service: AstraService) {
    super({});
  }

  protected template(): string {
    const sections = this.service.getSections();
    return `
      <div class="astra-settings-tab">
        <div class="astra-settings-header">
          <h2>Scoring Configuration</h2>
          <p class="astra-muted">Manage your weighted rating sections and criteria.</p>
        </div>
        
        <div class="astra-sections-list">
          ${sections.map(s => this.renderSectionItem(s)).join('')}
        </div>

        <div class="astra-settings-footer">
          <button class="astra-btn astra-btn--primary" id="astra-save-settings">
            <i class="fa fa-save"></i> Save Configuration
          </button>
        </div>
      </div>
    `;
  }

  private renderSectionItem(section: any): string {
    return `
      <div class="astra-section-config-item" data-id="${section.id}">
        <div class="astra-section-info">
          <span class="astra-section-name">${section.name}</span>
          <span class="astra-section-weight">Weight: ${section.weight}</span>
        </div>
        <div class="astra-section-actions">
           <!-- Editing logic will be implemented here -->
           <i class="fa fa-chevron-right"></i>
        </div>
      </div>
    `;
  }

  protected bindEvents(): void {
    const toast = container.resolve<ToastService>(TOKENS.ToastService);
    
    this.$('#astra-save-settings')?.addEventListener('click', () => {
      // TODO: Implement full section editing.
      toast.success('Settings saved!');
    });
  }
}
