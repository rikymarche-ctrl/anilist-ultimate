/**
 * @file AstraRadarPreview.ts
 * @description Reactive wrapper for the Astra Radar Chart
 */

import { injectable } from 'tsyringe';
import { AstraView } from '../base/AstraView';
import { AstraRadarChart } from '../AstraRadarChart';
import type { AstraSection } from '../../AstraInterfaces';
import { html } from '@core/utils/Template';

@injectable()
export class AstraRadarPreview extends AstraView {
  protected template(state: { scores: Record<string, number | null>, sections: AstraSection[] }): HTMLElement {
    if (!state || !state.sections) return html`<div class="astra-radar-mount"></div>`;
    const radarHTML = AstraRadarChart.getHTML(state.scores, state.sections, [], 300);
    const container = html`<div class="astra-radar-mount"></div>`;
    container.innerHTML = radarHTML; // Chart SVG is generated as string, this is a safe internal boundary for SVG
    return container;
  }

  public updateRadar(scores: Record<string, number | null>, sections: AstraSection[]): void {
    const mount = this.$('.astra-radar-mount');
    if (mount) {
      mount.innerHTML = AstraRadarChart.getHTML(scores, sections, [], 250);
    }
  }
}
