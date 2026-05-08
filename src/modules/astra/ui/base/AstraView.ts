/**
 * @file AstraView.ts
 * @description Base class for atomic Astra UI components.
 * Aligned with BaseComponent lifecycle for consistent rendering and DI compatibility.
 */

import { BaseComponent } from '@ui/components/BaseComponent';

/**
 * Enterprise bridge between BaseComponent and Astra-specific UI requirements.
 * Standardizes on the `html` template engine and provides DOM helpers.
 */
export abstract class AstraView extends BaseComponent {
  protected parent: HTMLElement | null = null;

  constructor(props: any = {}) {
    super(props);
  }

  /**
   * Return the HTML template or element for this component.
   * Subclasses should use the `html` utility for secure rendering.
   * 
   * @param state Optional state/props for rendering
   */
  protected abstract template(state?: any): string | HTMLElement;

  /**
   * Implementation of BaseComponent.render().
   * Orchestrates the template generation and conversion.
   */
  protected render(): HTMLElement {
    const templateResult = this.template(this.props);
    
    if (typeof templateResult === 'string') {
      // Fallback for legacy string templates, sanitized via BaseComponent helper
      return this.createFromHTML(templateResult.trim(), true);
    }
    
    return templateResult;
  }

  /**
   * Mount the component to a parent element.
   * Wraps BaseComponent.mount() to provide a consistent Astra interface.
   * 
   * @param parent The DOM element to append this component to
   * @param state Optional initial state to update props before mounting
   */
  public mount(parent: HTMLElement, state?: any): void {
    this.parent = parent;
    if (state) {
      this.props = { ...this.props, ...state };
    }

    // Always re-render the element using the latest props and class state
    // before the BaseComponent.mount() appends it to the DOM.
    // This ensures that any logic in template() that depends on initialized
    // services or stores (like AstraRatingController.store) is reflected.
    this.element = this.render();
    
    super.mount(parent);
  }

  /**
   * Update the component with new state.
   * Aligns Astra's update() with BaseComponent's reactive update flow.
   * 
   * @param state The new state/props to apply
   */
  public update(state?: any): void {
    if (state) {
      super.update(state);
    } else {
      this.rerender();
    }
  }

  /**
   * Internal cleanup.
   * Called automatically by BaseComponent during unmount/rerender.
   */
  protected onUnmount(): void {
    this.parent = null;
  }

  /**
   * Shorthand for querySelector within the component element.
   */
  protected $<T extends HTMLElement>(selector: string): T | null {
    return this.element?.querySelector(selector) as T || null;
  }

  /**
   * Shorthand for querySelectorAll within the component element.
   */
  protected $$<T extends HTMLElement>(selector: string): NodeListOf<T> {
    return this.element?.querySelectorAll(selector) as NodeListOf<T> || [] as any;
  }

  /**
   * Implementation of BaseComponent.attachEvents().
   * Bridges to the Astra-specific bindEvents() pattern.
   */
  protected override attachEvents(): void {
    this.bindEvents();
  }

  /**
   * Lifecycle: Bind event listeners to the component elements.
   * To be overridden by subclasses.
   */
  protected bindEvents(): void {
    // Override in subclasses
  }
}
