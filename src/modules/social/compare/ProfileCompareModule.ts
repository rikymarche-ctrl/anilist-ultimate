/**
 * @file ProfileCompareModule.ts
 * @description "Astra compare" button under AniList's "Compare with your list", on another
 * user's anime and manga list pages. Opens the Versus story for that media type.
 *
 * AniList only renders its own button for signed-in viewers on someone else's list; when it is
 * missing, the button sits at the end of the same filter column. Costs no request until clicked,
 * apart from the viewer lookup the client already caches. A token guards every await, and
 * leaving the page or changing account closes an open story at once.
 */

import { inject, injectable } from 'tsyringe';
import { TOKENS } from '@core/di/tokens';
import { EVENT_TYPES } from '@core/events/EventTypes';
import type { IApiClient } from '@core/interfaces/IApiClient';
import type { IEventBus } from '@core/interfaces/IEventBus';
import { logger } from '@core/logger';
import { BaseModule } from '@core/modules/BaseModule';
import { AstraOverlayService } from '@modules/astra/services/AstraOverlayService';
import { profileNameFromPath } from '../ProfileConnectionsModule';
import type { CompareMedia } from './ProfileCompareModel';
import { ProfileCompareService } from './ProfileCompareService';
import { ProfileCompareView } from './ProfileCompareView';
import '../../../styles/profile-compare.css';

const FILTERS_SELECTOR = '.filters-wrap .filters';
const NATIVE_BUTTON_SELECTOR = '.compare-btn';
const NAME_SELECTOR = '.header-wrap .banner-content .name-wrapper .name';
const BUTTON_CLASS = 'au-astra-compare';
const OBSERVER_NAME = 'profile-compare-filters';
const OVERLAY_ID = 'versus';
const LIST_WAIT_MS = 15_000;
const LIST_POLL_MS = 150;
const LIST_ROUTE = /^\/user\/[^/]+\/(anime|manga)list(?:\/|$)/;

/** The media type of a user's list page, or null on any other page. */
export function listMediaFromPath(path: string): CompareMedia | null {
  const match = LIST_ROUTE.exec(path);
  if (!match) return null;
  return match[1] === 'anime' ? 'ANIME' : 'MANGA';
}

@injectable()
export class ProfileCompareModule extends BaseModule {
  private token = 0;
  private button: HTMLButtonElement | null = null;
  private view: ProfileCompareView | null = null;
  private profile: string | null = null;

  constructor(
    @inject(TOKENS.ApiClient) private api: IApiClient,
    @inject(ProfileCompareService) private service: ProfileCompareService,
    @inject(AstraOverlayService) private overlays: AstraOverlayService,
    @inject(TOKENS.EventBus) protected eventBus: IEventBus
  ) {
    super(eventBus);
  }

  public async init(): Promise<void> {
    this.onPageChange(() => this.refresh());
    this.subscribe(EVENT_TYPES.AUTH_STATE_CHANGED, () => {
      this.service.clear();
      this.refresh();
    });
    await this.render(this.startRun());
  }

  public getName(): string {
    return 'profileCompare';
  }

  public override async destroy(): Promise<void> {
    this.token++;
    this.closeNow();
    this.removeButton();
    await super.destroy();
  }

  private refresh(): void {
    void this.render(this.startRun()).catch((error: unknown) =>
      logger.error('[ProfileCompareModule] Render failed', error)
    );
  }

  private startRun(): number {
    this.closeNow();
    this.removeButton();
    this.cleanup();
    return ++this.token;
  }

  private isStale(token: number, name: string): boolean {
    return (
      token !== this.token ||
      !listMediaFromPath(location.pathname) ||
      profileNameFromPath(location.pathname)?.toLowerCase() !== name.toLowerCase()
    );
  }

  private async render(token: number): Promise<void> {
    const name = profileNameFromPath(location.pathname);
    if (!name || !listMediaFromPath(location.pathname) || !this.api.isAuthenticated()) return;
    let viewerName: string;
    try {
      viewerName = (await this.api.getCurrentUser()).name;
    } catch (error) {
      if (!this.isStale(token, name))
        logger.warn('[ProfileCompareModule] Viewer unavailable', error);
      return;
    }
    if (this.isStale(token, name) || viewerName.toLowerCase() === name.toLowerCase()) return;
    if (!(await this.waitForFilters(name, token))) return;
    this.profile = name;
    this.place();
    const filters = document.querySelector('.filters-wrap');
    if (filters)
      this.registerObserver(OBSERVER_NAME, filters, { childList: true, subtree: true }, () =>
        this.keepPlaced(token)
      );
  }

  private headerShows(name: string): boolean {
    const shown = document.querySelector(NAME_SELECTOR)?.textContent?.trim().toLowerCase();
    return shown === name.toLowerCase();
  }

  /** AniList keeps the previous page on screen while the next list loads. */
  private async waitForFilters(name: string, token: number): Promise<boolean> {
    const deadline = Date.now() + LIST_WAIT_MS;
    while (!this.isStale(token, name) && Date.now() < deadline) {
      if (document.querySelector(FILTERS_SELECTOR) && this.headerShows(name)) return true;
      await new Promise((resolve) => window.setTimeout(resolve, LIST_POLL_MS));
    }
    return false;
  }

  /** Vue rebuilds the column as filters change, and adds its own button late: follow it. */
  private keepPlaced(token: number): void {
    const name = this.profile;
    if (!name || this.isStale(token, name)) return;
    const native = document.querySelector(NATIVE_BUTTON_SELECTOR);
    const misplaced = native && native.nextElementSibling !== this.button;
    if (!this.button?.isConnected || misplaced) this.place();
  }

  private place(): void {
    const filters = document.querySelector(FILTERS_SELECTOR);
    if (!filters) return;
    const button = this.button ?? this.createButton();
    this.button = button;
    const native = filters.querySelector(NATIVE_BUTTON_SELECTOR);
    if (native) native.after(button);
    else filters.append(button);
  }

  private createButton(): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = BUTTON_CLASS;
    button.textContent = 'Astra compare';
    button.setAttribute('aria-haspopup', 'dialog');
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.open();
    });
    return button;
  }

  private open(): void {
    const name = this.profile;
    const media = listMediaFromPath(location.pathname);
    if (!name || !media || this.view) return;
    const overlay = this.overlays.create(OVERLAY_ID);
    const view = new ProfileCompareView(this.service, name, media, () => this.closeAnimated());
    this.view = view;
    view.mount(overlay);
    this.overlays.show(OVERLAY_ID);
  }

  private closeAnimated(): void {
    const view = this.view;
    if (!view) return;
    this.overlays.hide(OVERLAY_ID, () => {
      view.unmount();
      if (this.view === view) this.view = null;
      if (this.button?.isConnected) this.button.focus({ preventScroll: true });
    });
  }

  /** Navigation and account changes cannot wait for an animation. */
  private closeNow(): void {
    this.view?.unmount();
    this.view = null;
    this.overlays.remove(OVERLAY_ID);
  }

  private removeButton(): void {
    this.button?.remove();
    this.button = null;
    this.profile = null;
  }
}
