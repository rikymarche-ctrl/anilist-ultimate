/**
 * @file CustomListModule.ts
 * @description Router module for the custom lists settings page
 *
 * Intercepts hash-based navigation (#au-custom-lists) on the settings
 * page, injects a navigation link in the AniList settings sidebar,
 * and shows/hides the CustomListManager UI component.
 *
 * Performance (BUG-007):
 * - Uses SharedGlobalObserver instead of individual MutationObserver
 * - Reduces overhead when multiple modules observe document.body
 *
 * @see CustomListManager.ts for the UI component
 * @see CustomListService.ts for the data layer
 * @see docs/MODULES.md#7-custom-list-module
 * @see docs/PERFORMANCE.md#bug-007 for SharedGlobalObserver optimization
 */

import { injectable, inject } from 'tsyringe';
import { BaseModule } from '@core/modules/BaseModule';
import { TOKENS } from '@core/di/tokens';
import type { IEventBus } from '@core/interfaces/IEventBus';
import type { SharedGlobalObserver } from '@core/observers/SharedGlobalObserver';
import { EVENT_TYPES } from '@core/events/EventTypes';
import { CustomListManager } from './components/CustomListManager';

export const isCustomListSettingsPath = (path: string): boolean => /^\/settings(?:\/|$)/.test(path);
const ACTIVE_CLASSES = ['router-link-exact-active', 'router-link-active'];

@injectable()
export class CustomListModule extends BaseModule {
  private initialized = false;
  private version = 0;
  private wrapper: HTMLElement | null = null;
  private native: { element: HTMLElement; display: string } | null = null;
  private link: HTMLElement | null = null;
  private linkHandler: ((event: Event) => void) | null = null;
  private nativeActive = new Map<Element, { path: string; classes: string[] }>();
  private readonly routingHandler = (): void => this.handleRouting();

  constructor(
    @inject(TOKENS.SharedGlobalObserver) private sharedObserver: SharedGlobalObserver,
    @inject(TOKENS.EventBus) protected eventBus: IEventBus,
    @inject(CustomListManager) private manager: CustomListManager
  ) {
    super(eventBus);
  }

  public async init(): Promise<void> {
    if (this.initialized) return;
    if (location.pathname === '/settings/au-custom-lists') {
      location.replace('/settings#au-custom-lists');
      return;
    }
    this.initialized = true;
    const version = ++this.version;
    this.sharedObserver.register('customList', () => {
      if (this.initialized && version === this.version) this.handleRouting();
    });
    window.addEventListener('popstate', this.routingHandler);
    window.addEventListener('hashchange', this.routingHandler);
    this.subscribe(EVENT_TYPES.PAGE_CHANGED, this.routingHandler);
    this.handleRouting();
  }

  public getName(): string {
    return 'customList';
  }

  private injectLink(): void {
    if (!isCustomListSettingsPath(location.pathname)) {
      this.removeLink();
      return;
    }
    if (this.link && !this.link.isConnected) this.removeLink();
    if (this.link) return;
    const target = [...document.querySelectorAll('.nav-group.mobile-nav-hidden')].find(
      (group) => group.querySelector('.group-header')?.textContent?.trim() === 'Settings'
    );
    if (!target) return;
    const link = document.createElement('a');
    // Mirror a native sibling's classes and Vue scoped-style attribute so the link inherits AniList's nav styling.
    const native = target.querySelector<HTMLAnchorElement>('a:not(.au-custom-lists-link)');
    const nativeClasses = native
      ? [...native.classList].filter((name) => !ACTIVE_CLASSES.includes(name))
      : [];
    link.classList.add(...nativeClasses, 'au-custom-lists-link');
    const scopeAttrs = native
      ? native.getAttributeNames().filter((name) => name.startsWith('data-v-'))
      : [];
    for (const name of scopeAttrs.length ? scopeAttrs : ['data-v-48560ace'])
      link.setAttribute(name, '');
    link.href = '#au-custom-lists';
    link.textContent = 'AU - Custom Lists';
    link.style.cursor = 'pointer';
    const version = this.version;
    this.linkHandler = (event) => {
      if (
        !this.initialized ||
        version !== this.version ||
        !link.isConnected ||
        !isCustomListSettingsPath(location.pathname)
      )
        return;
      event.preventDefault();
      location.hash = 'au-custom-lists';
      this.handleRouting();
    };
    link.addEventListener('click', this.linkHandler);
    this.link = link;
    target.appendChild(link);
  }

  private removeLink(): void {
    if (this.link && this.linkHandler) this.link.removeEventListener('click', this.linkHandler);
    this.link?.remove();
    this.link = null;
    this.linkHandler = null;
  }

  private handleRouting(): void {
    if (!this.initialized) return;
    for (const element of this.nativeActive.keys())
      if (!element.isConnected) this.nativeActive.delete(element);
    const custom =
      isCustomListSettingsPath(location.pathname) && location.hash === '#au-custom-lists';
    this.injectLink();
    if (custom) {
      const content =
        document.querySelector<HTMLElement>(
          '.settings.container > .content:not(#au-custom-settings-container)'
        ) ||
        document.querySelector<HTMLElement>(
          '.settings .content:not(#au-custom-settings-container)'
        );
      if (
        this.native?.element !== content ||
        !this.wrapper?.isConnected ||
        !this.wrapper.contains(this.manager.getElement())
      ) {
        this.deactivateManager();
        if (content?.parentElement) this.activateManager(content);
      }
    } else this.deactivateManager();
    this.updateLinkUI(custom);
  }

  private activateManager(content: HTMLElement): void {
    this.native = { element: content, display: content.style.display };
    content.style.display = 'none';
    const wrapper = document.createElement('div');
    wrapper.id = 'au-custom-settings-container';
    wrapper.className = 'content';
    wrapper.setAttribute('data-v-48560ace', '');
    wrapper.style.display = 'block';
    content.parentElement!.appendChild(wrapper);
    this.wrapper = wrapper;
    this.manager.mount(wrapper);
  }

  private deactivateManager(): void {
    if (this.wrapper) {
      this.manager.unmount();
      this.wrapper.remove();
      this.wrapper = null;
    }
    if (this.native?.element.style.display === 'none')
      this.native.element.style.display = this.native.display;
    this.native = null;
  }

  private restoreNativeActive(): void {
    for (const [element, state] of this.nativeActive) {
      // On path navigation Vue owns the new active marker; restore only our same-path hash takeover.
      if (
        element.isConnected &&
        state.path === location.pathname &&
        state.classes.some((name) => !element.classList.contains(name))
      )
        element.classList.add(...state.classes);
    }
    this.nativeActive.clear();
  }

  private updateLinkUI(custom: boolean): void {
    if (custom) {
      for (const group of document.querySelectorAll('.nav-group.mobile-nav-hidden')) {
        for (const anchor of group.querySelectorAll('a')) {
          if (anchor === this.link) continue;
          const classes = ACTIVE_CLASSES.filter((name) => anchor.classList.contains(name));
          if (classes.length) {
            if (this.nativeActive.get(anchor)?.path !== location.pathname)
              this.nativeActive.set(anchor, { path: location.pathname, classes });
            anchor.classList.remove(...classes);
          }
        }
      }
      if (this.link && ACTIVE_CLASSES.some((name) => !this.link!.classList.contains(name)))
        this.link.classList.add(...ACTIVE_CLASSES);
    } else {
      this.restoreNativeActive();
      if (this.link && ACTIVE_CLASSES.some((name) => this.link!.classList.contains(name)))
        this.link.classList.remove(...ACTIVE_CLASSES);
    }
  }

  public override async destroy(): Promise<void> {
    this.initialized = false;
    this.version++;
    this.sharedObserver.unregister('customList');
    window.removeEventListener('popstate', this.routingHandler);
    window.removeEventListener('hashchange', this.routingHandler);
    this.deactivateManager();
    this.restoreNativeActive();
    this.removeLink();
    await super.destroy();
  }
}
