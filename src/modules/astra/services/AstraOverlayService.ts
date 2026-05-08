/**
 * @file AstraOverlayService.ts
 * @description Centralized service for managing Astra UI overlays (modals, dashboards).
 * Ensures consistent animation, backdrop management, and scroll-lock behavior.
 */

import { injectable, singleton } from 'tsyringe';

@injectable()
@singleton()
export class AstraOverlayService {
  private activeOverlays: Map<string, HTMLElement> = new Map();

  /**
   * Creates or returns a modal overlay.
   * 
   * @param id Unique identifier for the overlay
   * @returns The overlay element
   */
  public create(id: string): HTMLElement {
    if (this.activeOverlays.has(id)) {
      return this.activeOverlays.get(id)!;
    }

    const overlay = document.createElement('div');
    overlay.className = 'astra-modal-overlay';
    overlay.id = `astra-overlay-${id}`;
    
    const target = document.body || document.documentElement;
    target.appendChild(overlay);
    
    // Lock body scroll
    if (document.body) {
      document.body.style.overflow = 'hidden';
    }

    this.activeOverlays.set(id, overlay);
    return overlay;
  }

  /**
   * Triggers the open animation for an overlay.
   * 
   * @param id Overlay identifier
   */
  public show(id: string): void {
    const overlay = this.activeOverlays.get(id);
    if (overlay) {
      requestAnimationFrame(() => {
        overlay.classList.add('astra-modal-overlay--open');
      });
    }
  }

  /**
   * Triggers the close animation and removes the overlay.
   * 
   * @param id Overlay identifier
   * @param onComplete Callback after animation finishes
   */
  public hide(id: string, onComplete?: () => void): void {
    const overlay = this.activeOverlays.get(id);
    if (!overlay) return;

    overlay.classList.add('astra-modal-overlay--closing');
    overlay.classList.remove('astra-modal-overlay--open');

    setTimeout(() => {
      overlay.remove();
      this.activeOverlays.delete(id);
      
      // Unlock body scroll if no other overlays are active
      if (this.activeOverlays.size === 0 && document.body) {
        document.body.style.overflow = '';
      }

      if (onComplete) onComplete();
    }, 350);
  }

  /**
   * Checks if an overlay is currently active.
   */
  public isActive(id: string): boolean {
    return this.activeOverlays.has(id);
  }
}
