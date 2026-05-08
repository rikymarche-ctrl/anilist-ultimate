import { injectable } from 'tsyringe';
import { AstraView } from '../../base/AstraView';
import { html } from '@core/utils/Template';

export interface ProgressStepperOptions {
  label: string;
  field: string;
  value: number;
  max?: number | null;
  aired?: number | null;
  onValueChange: (val: number) => void;
}

@injectable()
export class AstraProgressStepper extends AstraView {
  private options: ProgressStepperOptions | null = null;

  public mount(parent: HTMLElement, options: ProgressStepperOptions): void {
    this.options = options;
    super.mount(parent);
  }

  protected template(): HTMLElement {
    if (!this.options) return document.createElement('div');
    const { label, field, value, max, aired } = this.options;

    let progressLabel = max ? `/ ${max}` : '/ ?';
    if (aired !== undefined && aired !== null && aired !== max) {
      progressLabel = `/ ${aired} / ${max || '?'}`;
    }

    return html`
      <div class="astra-input-box">
        <span class="astra-label-xs">${label}</span>
        <div class="astra-stepper">
          <button class="astra-step-btn" data-step="-1">-</button>
          <div class="astra-stepper-center">
            <input type="number" class="astra-number-input" id="astra-${field}" value="${value}">
            ${field === 'progress' ? html`<span class="astra-progress-label">${progressLabel}</span>` : ''}
          </div>
          <button class="astra-step-btn" data-step="1">+</button>
        </div>
      </div>
    `;
  }

  protected bindEvents(): void {
    this.$$('.astra-step-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const step = parseInt((btn as HTMLElement).dataset.step || '0');
        if (this.options) {
          const newVal = Math.max(0, this.options.value + step);
          this.options.onValueChange(newVal);
        }
      });
    });

    this.$('input')?.addEventListener('change', (e) => {
      const val = parseInt((e.target as HTMLInputElement).value) || 0;
      if (this.options) {
        this.options.onValueChange(Math.max(0, val));
      }
    });
  }
}
