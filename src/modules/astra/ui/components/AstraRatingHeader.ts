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
  /** Shows the revert control; it stays hidden until the form holds changes since opening. */
  canRevert?: boolean;
  hasChanges?: boolean;
  /** Mirrors the "Open in New Tab" preference; otherwise the title navigates in place. */
  openInNewTab?: boolean;
}

@injectable()
export class AstraRatingHeader extends AstraView<HeaderState> {
  protected template(state: Partial<HeaderState>): HTMLElement {
    if (!state || !state.title) return html`<div></div>`;
    const mediaType = state.mediaType || 'anime';
    const currentRoute = getMediaRoute(window.location.pathname);
    const isCurrentMediaPage =
      currentRoute !== null &&
      currentRoute.id === state.mediaId &&
      currentRoute.type.toLowerCase() === mediaType;
    const path = `/${mediaType}/${state.mediaId}`;
    const title = isCurrentMediaPage
      ? state.title
      : state.openInNewTab
        ? html`<a
            href="https://anilist.co${path}"
            target="_blank"
            rel="noopener noreferrer"
            class="astra-title-link"
            >${state.title}</a
          >`
        : html`<a href="${path}" class="astra-title-link">${state.title}</a>`;

    return html`
      <header class="astra-modal-header astra-rating-header">
        <div class="astra-header-main">
          <div class="astra-header-left">
            <div class="astra-header-title-box">
              <h2 class="astra-header-title">${title}</h2>
            </div>
          </div>

          <div style="flex: 1;"></div>
          ${state.canRevert
            ? html`<button
                type="button"
                class="astra-btn astra-revert-entry"
                id="astra-revert-entry"
                title="Undo every change made since this form was opened"
                ${state.hasChanges ? '' : 'hidden'}
              >
                <i class="fa-solid fa-arrow-rotate-left" aria-hidden="true"></i
                ><span>Revert changes</span>
              </button>`
            : ''}
          ${state.canDelete
            ? html`<button
                type="button"
                class="astra-btn astra-btn--danger astra-delete-entry"
                id="astra-delete-entry"
              >
                <i class="fa-solid fa-trash-can" aria-hidden="true"></i><span>Delete entry</span>
              </button>`
            : ''}
        </div>
      </header>
    `;
  }
}
