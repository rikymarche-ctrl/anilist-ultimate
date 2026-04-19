/**
 * Base Component Class
 * Simple component abstraction for DOM manipulation
 */

import type { ComponentProps } from '@core/types';

export abstract class BaseComponent<P extends ComponentProps = ComponentProps> {
  protected element: HTMLElement;
  protected props: P;
  protected mounted: boolean = false;
  private eventCleanupFunctions: Array<() => void> = [];

  constructor(props: P) {
    this.props = props;
    this.element = this.render();
    this.attachEvents();
  }

  /**
   * Render the component - must be implemented by subclasses
   */
  protected abstract render(): HTMLElement;

  /**
   * Attach event listeners - override in subclasses
   */
  protected attachEvents(): void {
    // Default: no events
    // Subclasses can override to add event listeners
  }

  /**
   * Update component with new props
   */
  public update(props: Partial<P>): void {
    const prevProps = { ...this.props };
    this.props = { ...this.props, ...props };

    // Only re-render if props actually changed
    if (this.shouldUpdate(prevProps, this.props)) {
      this.rerender();
    }
  }

  /**
   * Determine if component should update
   * Override for custom comparison logic
   */
  protected shouldUpdate(prevProps: P, nextProps: P): boolean {
    return JSON.stringify(prevProps) !== JSON.stringify(nextProps);
  }

  /**
   * Re-render the component
   */
  protected rerender(): void {
    const parent = this.element.parentElement;
    const nextSibling = this.element.nextSibling;

    // Clean up old element
    this.cleanup();
    this.element.remove();

    // Create new element
    this.element = this.render();
    this.attachEvents();

    // Re-insert into DOM if was mounted
    if (parent) {
      if (nextSibling) {
        parent.insertBefore(this.element, nextSibling);
      } else {
        parent.appendChild(this.element);
      }
    }
  }

  /**
   * Mount the component to a parent element
   */
  public mount(parent: HTMLElement): void {
    if (this.mounted) {
      console.warn('[BaseComponent] Component already mounted');
      return;
    }

    parent.appendChild(this.element);
    this.mounted = true;
    this.onMount();
  }

  /**
   * Unmount the component from the DOM
   */
  public unmount(): void {
    if (!this.mounted) {
      console.warn('[BaseComponent] Component not mounted');
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
   * Add an event listener with automatic cleanup tracking
   */
  protected addEventListener<K extends keyof HTMLElementEventMap>(
    element: HTMLElement,
    event: K,
    handler: (ev: HTMLElementEventMap[K]) => void,
    options?: boolean | AddEventListenerOptions
  ): void {
    element.addEventListener(event, handler as EventListener, options);

    // Track cleanup function
    this.eventCleanupFunctions.push(() => {
      element.removeEventListener(event, handler as EventListener, options);
    });
  }

  /**
   * Query selector within component
   */
  protected querySelector<T extends Element = Element>(selector: string): T | null {
    return this.element.querySelector<T>(selector);
  }

  /**
   * Query selector all within component
   */
  protected querySelectorAll<T extends Element = Element>(selector: string): NodeListOf<T> {
    return this.element.querySelectorAll<T>(selector);
  }

  /**
   * Add a CSS class to the root element
   */
  public addClass(className: string): void {
    this.element.classList.add(className);
  }

  /**
   * Remove a CSS class from the root element
   */
  public removeClass(className: string): void {
    this.element.classList.remove(className);
  }

  /**
   * Toggle a CSS class on the root element
   */
  public toggleClass(className: string, force?: boolean): void {
    this.element.classList.toggle(className, force);
  }

  /**
   * Set an attribute on the root element
   */
  public setAttribute(name: string, value: string): void {
    this.element.setAttribute(name, value);
  }

  /**
   * Clean up event listeners and resources
   */
  protected cleanup(): void {
    // Clean up all tracked event listeners
    this.eventCleanupFunctions.forEach((cleanup) => cleanup());
    this.eventCleanupFunctions = [];
  }

  /**
   * Create an HTML element with optional props
   */
  protected createElement<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    props?: Partial<HTMLElementTagNameMap[K]> & { class?: string; id?: string }
  ): HTMLElementTagNameMap[K] {
    const element = document.createElement(tag);

    if (props) {
      Object.entries(props).forEach(([key, value]) => {
        if (key === 'class' && typeof value === 'string') {
          element.className = value;
        } else if (key === 'id' && typeof value === 'string') {
          element.id = value;
        } else if (key in element) {
          (element as any)[key] = value;
        }
      });
    }

    return element;
  }

  /**
   * Helper to create element from HTML string
   */
  protected createFromHTML(html: string): HTMLElement {
    const template = document.createElement('template');
    template.innerHTML = html.trim();
    return template.content.firstElementChild as HTMLElement;
  }
}

/**
 * Component Registry for dynamic component creation
 */
export class ComponentRegistry {
  private static components = new Map<string, new (props: any) => BaseComponent>();

  static register(name: string, component: new (props: any) => BaseComponent): void {
    this.components.set(name, component);
  }

  static create(name: string, props: ComponentProps): BaseComponent | null {
    const ComponentClass = this.components.get(name);
    if (!ComponentClass) {
      console.error(`[ComponentRegistry] Component "${name}" not found`);
      return null;
    }
    return new ComponentClass(props);
  }

  static has(name: string): boolean {
    return this.components.has(name);
  }
}
