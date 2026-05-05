/**
 * @file AstraView.ts
 * @description Base class for atomic Astra UI components
 */

import { BaseComponent } from '@ui/components/BaseComponent';

export abstract class AstraView extends BaseComponent {
  protected element: HTMLElement = document.createElement('div') as HTMLElement;
  protected parent: HTMLElement | null = null;

  /**
   * Return the HTML template for this component
   */
  protected abstract template(state?: any): string;

  /**
   * Mount the component to a parent element
   */
  public mount(parent: HTMLElement, state?: any): void {
    this.parent = parent;
    const html = this.template(state);
    
    // Create temporary container to parse HTML
    const container = document.createElement('div');
    container.innerHTML = html.trim();
    const newElement = container.firstElementChild as HTMLElement;
    
    if (newElement) {
      this.element = newElement;
      parent.appendChild(this.element);
      this.onMount();
      this.bindEvents();
    }
  }

  /**
   * Unmount the component and cleanup
   */
  public unmount(): void {
    if (this.element && this.element.parentElement) {
      this.onUnmount();
      this.cleanup();
      this.element.remove();
    }
    this.parent = null;
  }

  /**
   * Update the component with new state (re-renders)
   */
  public update(state?: any): void {
    if (!this.element || !this.parent) return;
    
    const oldElement = this.element;
    this.onUnmount();
    this.cleanup(); // Clean up listeners before re-rendering
    
    const html = this.template(state);
    const container = document.createElement('div');
    container.innerHTML = html.trim();
    const newElement = container.firstElementChild as HTMLElement;
    
    if (newElement) {
      this.element = newElement;
      this.parent.replaceChild(this.element, oldElement);
      this.onMount();
      this.bindEvents();
    }
  }

  /**
   * Internal cleanup of DOM references if needed
   */
  protected cleanup(): void {
    // Subclasses can implement specific cleanup
  }

  /**
   * Lifecycle hook: Called after element is added to DOM
   */
  protected onMount(): void {}

  /**
   * Lifecycle hook: Called before element is removed from DOM
   */
  protected onUnmount(): void {}

  /**
   * Declarative event binding
   */
  protected bindEvents(): void {}

  /**
   * Shorthand for querySelector within the component
   */
  protected $<T extends HTMLElement>(selector: string): T | null {
    return this.element?.querySelector(selector) as T || null;
  }

  /**
   * Shorthand for querySelectorAll within the component
   */
  protected $$<T extends HTMLElement>(selector: string): NodeListOf<T> {
    return this.element?.querySelectorAll(selector) as NodeListOf<T> || [] as any;
  }

  // Implementation for BaseComponent (fallback)
  protected render(): HTMLElement {
    return this.element || document.createElement('div');
  }
}
