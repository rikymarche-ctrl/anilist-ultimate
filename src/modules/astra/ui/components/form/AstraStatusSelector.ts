import { injectable } from 'tsyringe';
import { AstraView } from '../../base/AstraView';
import { MediaListStatus, MediaType } from '@/api/AnilistTypes';
import { getStatusLabel } from '@core/utils/UIHelpers';
import { html } from '@core/utils/Template';

export interface StatusSelectorOptions {
  status: MediaListStatus;
  type: MediaType | string;
  onStatusChange: (status: MediaListStatus) => void;
}

@injectable()
export class AstraStatusSelector extends AstraView {
  private options: StatusSelectorOptions | null = null;

  public mount(parent: HTMLElement, options: StatusSelectorOptions): void {
    this.options = options;
    super.mount(parent);
  }

  protected template(): HTMLElement {
    if (!this.options) return document.createElement('div');
    const { status, type } = this.options;

    const statusOptions = [
      { value: MediaListStatus.CURRENT, label: getStatusLabel(MediaListStatus.CURRENT, type), icon: 'fa-play-circle' },
      { value: MediaListStatus.COMPLETED, label: getStatusLabel(MediaListStatus.COMPLETED, type), icon: 'fa-check-circle' },
      { value: MediaListStatus.PAUSED, label: getStatusLabel(MediaListStatus.PAUSED, type), icon: 'fa-pause-circle' },
      { value: MediaListStatus.DROPPED, label: getStatusLabel(MediaListStatus.DROPPED, type), icon: 'fa-times-circle' },
      { value: MediaListStatus.PLANNING, label: getStatusLabel(MediaListStatus.PLANNING, type), icon: 'fa-calendar' },
      { value: MediaListStatus.REPEATING, label: getStatusLabel(MediaListStatus.REPEATING, type), icon: 'fa-redo' },
    ];

    const currentStatus = statusOptions.find(o => o.value === status) || statusOptions[0];

    return html`
      <div class="astra-input-box">
        <span class="astra-label-xs">STATUS</span>
        <div class="astra-dropdown" id="astra-status-dropdown">
          <button class="astra-dropdown-trigger">
            <i class="fa ${currentStatus.icon}"></i>
            <span>${currentStatus.label}</span>
            <i class="fa fa-chevron-down"></i>
          </button>
          <div class="astra-dropdown-menu">
            ${statusOptions.map(o => html`
              <div class="astra-dropdown-item astra-status-option ${status === o.value ? 'active' : ''}" data-value="${o.value}">
                <i class="fa ${o.icon}"></i>
                <span>${o.label}</span>
              </div>
            `)}
          </div>
        </div>
      </div>
    `;
  }

  protected bindEvents(): void {
    this.$('.astra-dropdown-trigger')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.$('.astra-dropdown')?.classList.toggle('active');
    });

    this.$$('.astra-status-option').forEach(opt => {
      opt.addEventListener('click', () => {
        const val = (opt as HTMLElement).dataset.value as MediaListStatus;
        if (val && this.options) {
          this.options.onStatusChange(val);
        }
        this.$('.astra-dropdown')?.classList.remove('active');
      });
    });

    // Managed listener: BaseComponent removes it on unmount (prevents accumulation
    // of document listeners every time this singleton component is re-mounted).
    this.addEventListener(document, 'click', () => {
      this.$('.astra-dropdown')?.classList.remove('active');
    });
  }
}
