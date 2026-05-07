/**
 * @file AstraRadarPreview.ts
 * @description Reactive wrapper for the Astra Radar Chart
 */

import { AstraView } from '../base/AstraView';
import { AstraRadarChart } from '../AstraRadarChart';
import { AstraSection } from '../../AstraService';

export class AstraRadarPreview extends AstraView {
  protected template(state: { scores: Record<string, number | null>, sections: AstraSection[] }): string {
    return `
      <div class="astra-radar-mount">
        ${AstraRadarChart.getHTML(state.scores, state.sections, [], 300)}
      </div>
    `;
  }

  public updateRadar(scores: Record<string, number | null>, sections: AstraSection[]): void {
    const mount = this.$('.astra-radar-mount');
    if (mount) {
      mount.innerHTML = AstraRadarChart.getHTML(scores, sections, [], 250);
    }
  }
}
