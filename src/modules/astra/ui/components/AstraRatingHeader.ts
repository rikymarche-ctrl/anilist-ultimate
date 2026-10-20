/**
 * @file AstraRatingHeader.ts
 * @description Specialized header component for the Astra Rating Modal
 */

import { injectable } from 'tsyringe';
import { AstraView } from '../base/AstraView';
import { html } from '@core/utils/Template';
import { getMediaRoute } from '@core/navigation/MediaRoute';

interface HeaderState {
  mediaId: number;
  mediaType?: 'anime' | 'manga';
  title: string;
  canDelete?: boolean;
}

@injectable()
export class AstraRatingHeader extends AstraView<HeaderState> {
  protected template(state: Partial<HeaderState>): HTMLElement {
    if (!state || !state.title) return html`<div></div>`;
    const mediaType = state.mediaType || 'anime';
    const currentRoute = getMediaRoute(window.location.pathname);
    const isCurrentMediaPage = currentRoute !== null
      && currentRoute.id === state.mediaId
      && currentRoute.type.toLowerCase() === mediaType;
    const title = isCurrentMediaPage
      ? state.title
      : html`<a
          href="https://anilist.co/${mediaType}/${state.mediaId}"
          target="_blank"
          rel="noopener noreferrer"
          class="astra-title-link"
          >${state.title}</a
        >`;

    return html`
      <header class="astra-modal-header astra-rating-header">
        <div class="astra-header-main">
          <div class="astra-header-left">
            <div class="astra-header-title-box">
              <h2 class="astra-header-title">
                ${title}
              </h2>
            </div>
          </div>

          <div style="flex: 1;"></div>
          ${state.canDelete ? html`<button type="button" class="astra-btn astra-btn--danger astra-delete-entry" id="astra-delete-entry"><i class="fa-solid fa-trash-can" aria-hidden="true"></i><span>Delete entry</span></button>` : ''}
        </div>
      </header>
    `;
  }


}
