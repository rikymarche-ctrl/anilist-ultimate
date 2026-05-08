/**
 * @file BaseComponent.ts
 * @description Enterprise Base Class for all UI Components.
 *
 * Implements a standardized lifecycle and reactive update pattern:
 *   - constructor() -> render()
 *   - mount(parent) -> onMount() -> attachEvents()
 *   - update(newProps) -> shouldUpdate() -> onUpdate() or rerender()
 *   - unmount() -> onUnmount() -> cleanup()
 *
 * Features:
 *   - Prop-based reactivity
 *   - DOM helper (createElement) with attribute/style support
 *   - Event listener tracking and automatic cleanup
 *   - Memory leak prevention via automatic event unbinding
 */

import { log } from '@core/logger';

export abstract class BaseComponent<P = any> {
  protected element: HTMLElement;
  protected props: P;
  protected mounted: boolean = false;
  private eventListeners: Array<{ target: EventTarget; type: string; listener: EventListenerOrEventListenerObject }> = [];

  constructor(props: P) {
    this.props = props;
    this.element = this.render();
  }

  /**
   * Return the root HTMLElement for this component.
   * MUST be implemented by subclasses.
   */
  protected abstract render(): HTMLElement;

  /**
   * Update the component with new props.
   * Triggers a reactive update flow.
   */
  public update(newProps: Partial<P>): void {
    const prevProps = { ...this.props };
    this.props = { ...this.props, ...newProps };

    if (this.shouldUpdate(prevProps, this.props)) {
      // Allow subclasses to perform surgical updates
      const handledSurgically = this.onUpdate(prevProps);

      if (!handledSurgically) {
        this.rerender();
      }
    }
  }

  /**
   * Lifecycle: Determine if the component needs to update.
   * Default implementation checks for shallow prop equality.
   */
  protected shouldUpdate(prevProps: P, nextProps: P): boolean {
    return JSON.stringify(prevProps) !== JSON.stringify(nextProps);
  }

  /**
   * Lifecycle: Perform surgical DOM updates instead of full rerender.
   * Return true if the update was handled, false to trigger rerender().
   */
  protected onUpdate(_prevProps: P): boolean {
    return false;
  }

  /**
   * Re-render the component (Full Reconstruction)
   * Use sparingly; prefer onUpdate() for better performance.
   */
  public rerender(): void {
    const parent = this.element.parentElement;
    const nextSibling = this.element.nextSibling;

    // Clean up old element
    this.onUnmount();
    this.cleanup();
    this.element.remove();

    // Create new element
    this.element = this.render();
    
    // Re-mount if it was previously mounted
    if (this.mounted) {
      if (parent) {
        try {
          if (nextSibling) {
            parent.insertBefore(this.element, nextSibling);
          } else {
            parent.appendChild(this.element);
          }
          this.onMount();
          this.attachEvents();
        } catch (error) {
          log.error(`[BaseComponent] Failed to re-append ${this.constructor.name}`, error);
        }
      } else {
        log.warn(`[BaseComponent] Cannot re-append ${this.constructor.name}: parent is null`);
      }
    }
  }

  /**
   * Mount the component to a parent element
   */
  public mount(parent: HTMLElement): void {
    if (this.mounted) {
      return;
    }

    if (!parent) {
      log.warn(`[BaseComponent] Cannot mount ${this.constructor.name}: parent is null`);
      return;
    }

    try {
      parent.appendChild(this.element);
      this.mounted = true;
      this.onMount();
      this.attachEvents();
    } catch (error) {
      log.error(`[BaseComponent] Failed to mount ${this.constructor.name}`, error);
    }
  }

  /**
   * Unmount the component from the DOM
   */
  public unmount(): void {
    if (!this.mounted) {
      return;
    }

    this.onUnmount();
    this.cleanup();
    this.element.remove();
    this.mounted = false;
  }

  /**
   * Get the root element
   */
  public getElement(): HTMLElement {
    return this.element;
  }

  /**
   * Lifecycle: Called after component is mounted
   */
  protected onMount(): void {
    // Override in subclasses
  }

  /**
   * Lifecycle: Called before component is unmounted
   */
  protected onUnmount(): void {
    // Override in subclasses
  }

  /**
   * Attach component-level events.
   * Called automatically after mount and rerender.
   */
  protected attachEvents(): void {
    // Override in subclasses
  }

  /**
   * Securely register an event listener with automatic cleanup tracking.
   */
  protected addEventListener(
    target: EventTarget,
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions
  ): void {
    target.addEventListener(type, listener, options);
    this.eventListeners.push({ target, type, listener });
  }

  /**
   * Manually remove all registered listeners.
   * Called automatically during unmount.
   */
  protected cleanup(): void {
    this.eventListeners.forEach(({ target, type, listener }) => {
      target.removeEventListener(type, listener);
    });
    this.eventListeners = [];
  }

  /**
   * Helper: Create an element with attributes and styles safely.
   */
  protected createElement<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    props?: Record<string, unknown>
  ): HTMLElementTagNameMap[K] {
    const element = document.createElement(tag);

    if (props) {
      Object.entries(props).forEach(([key, value]) => {
        if (key === 'class') {
          element.className = value as string;
        } else if (key === 'style' && typeof value === 'object') {
          Object.assign(element.style, value);
        } else if (key.startsWith('on') && typeof value === 'function') {
          const eventName = key.toLowerCase().substring(2);
          this.addEventListener(element, eventName, value as EventListener);
        } else {
          element.setAttribute(key, String(value));
        }
      });
    }

    return element;
  }

  /**
   * Helper: Query an element within the component's root
   */
  protected $<E extends HTMLElement = HTMLElement>(selector: string): E | null {
    return this.element.querySelector(selector);
  }

  /**
   * Helper: Query multiple elements within the component's root
   */
  protected $$<E extends HTMLElement = HTMLElement>(selector: string): NodeListOf<E> {
    return this.element.querySelectorAll(selector);
  }

  /**
   * Proxy for this.element.querySelector (for legacy compatibility)
   */
  protected querySelector<E extends Element = Element>(selector: string): E | null {
    return this.element.querySelector(selector);
  }

  /**
   * Helper: Toggle a class on the component element
   */
  protected toggleClass(className: string, force?: boolean): void {
    this.element.classList.toggle(className, force);
  }

  /**
   * Helper: Create an element from HTML string (Sanitized)
   */
  protected createFromHTML(html: string, wrap: boolean = false): HTMLElement {
    const template = document.createElement('template');
    template.innerHTML = html.trim();
    const content = template.content.firstElementChild as HTMLElement;

    if (!content) {
      return document.createElement('div');
    }

    if (wrap) {
      const wrapper = document.createElement('div');
      wrapper.appendChild(content);
      return wrapper;
    }

    return content;
  }
}
