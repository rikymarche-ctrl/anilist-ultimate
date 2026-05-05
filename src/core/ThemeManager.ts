/**
 * @file ThemeManager.ts
 * @description Automatic theme detection and synchronization with AniList
 *
 * Detects the active AniList theme (dark, light, high-contrast) by sampling
 * the computed background-color luminance, then applies the corresponding
 * CSS class to the extension's container and body element.
 *
 * Detection triggers:
 *   1. On initialization (first paint)
 *   2. MutationObserver on body/html class and style attributes
 *   3. Window resize (edge-case theme media queries)
 *
 * Luminance thresholds:
 *   - sum > 600 → light
 *   - sum < 10  → high-contrast
 *   - else      → dark
 *
 * @see docs/MODULES.md#theme-detection
 */

import { log } from './logger';
import { CSS_CLASSES } from './constants';
import { inject, singleton } from 'tsyringe';
import { TOKENS } from './di/tokens';
import type { IConfigManager } from './interfaces/IConfigManager';
import type { ThemeConfig } from './config/types';
import { container } from './di/container';

/**
 * ThemeManager - Automatic theme detection and application
 * Uses singleton pattern for global theme management
 */
@singleton()
export class ThemeManager {
  private observer: MutationObserver | null = null;
  private lastTheme: string | null = null;

  /**
   * Constructor with DI support
   * tsyringe @singleton() decorator will manage singleton lifecycle
   */
  constructor(
    @inject(TOKENS.Config) private config: IConfigManager
  ) {
    if (typeof window !== 'undefined') {
      this.init();
    }
  }

  /**
   * Static resolver (for backward compatibility)
   * @deprecated Use DI container to resolve ThemeManager instead
   */
  public static getInstance(): ThemeManager {
    return container.resolve(ThemeManager);
  }

  private init(): void {
    log.info('Initializing Theme Manager');

    // Initial detection and application
    this.detectAndApply();
    this.applyAccentColor();

    // Listen for config changes to accent color
    this.config.onChange('theme', (theme: ThemeConfig) => {
      this.applyAccentColor(theme.accentColor);
    });

    // Observe changes to the body style/class (where Anilist usually sets theme)
    this.observer = new MutationObserver(() => {
      this.detectAndApply();
    });

    this.observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['style', 'class'],
    });

    // Also observe the html element as a fallback
    this.observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['style', 'class'],
    });

    // Listen for resize as a secondary trigger for theme re-evaluation
    window.addEventListener('resize', () => this.detectAndApply());
  }

  /**
   * Detect current background and apply the right AU theme class
   */
  public detectAndApply(): void {
    const theme = this.detectTheme();

    if (theme !== this.lastTheme) {
      this.applyTheme(theme);
      this.lastTheme = theme;
      log.debug('Theme change detected', { theme });
    }
  }

  /**
   * Analyze background color to determine theme
   */
  private detectTheme(): string {
    const bgColor = window.getComputedStyle(document.body).backgroundColor;

    // Parse RGB(A)
    const match = bgColor.match(/\d+/g);
    if (!match || match.length < 3) return CSS_CLASSES.THEME_DARK;

    const r = parseInt(match[0]);
    const g = parseInt(match[1]);
    const b = parseInt(match[2]);

    // Simple luminance / known Anilist background check
    // Dark: rgb(11, 22, 34) (sum ~67)
    // Light: rgb(251, 251, 251) (sum ~753)
    // Contrast: rgb(0, 0, 0) (sum 0)

    const sum = r + g + b;

    if (sum > 600) {
      return CSS_CLASSES.THEME_LIGHT;
    } else if (sum < 10) {
      return CSS_CLASSES.THEME_CONTRAST;
    } else {
      return CSS_CLASSES.THEME_DARK;
    }
  }

  private applyTheme(themeClass: string): void {
    const container = document.querySelector('.anilist-ultimate-container');
    if (container) {
      // Remove all theme classes first
      container.classList.remove(
        CSS_CLASSES.THEME_LIGHT,
        CSS_CLASSES.THEME_DARK,
        CSS_CLASSES.THEME_CONTRAST
      );

      // Add detected theme
      container.classList.add(themeClass);
    }

    // Also apply to body to affect modals/popups
    document.body.classList.remove('au-theme-light', 'au-theme-dark', 'au-theme-contrast');
    document.body.classList.add(`au-${themeClass}`);
  }

  /**
   * Apply custom accent color to document root
   */
  private applyAccentColor(color?: string): void {
    let accentColor = color || this.config.get('theme').accentColor;
    if (!accentColor) return;

    // Ensure it's a valid hex for appending
    if (accentColor.startsWith('#') && accentColor.length === 4) {
      // Convert #RGB to #RRGGBB
      accentColor = '#' + accentColor[1] + accentColor[1] + accentColor[2] + accentColor[2] + accentColor[3] + accentColor[3];
    }

    log.debug('Applying custom accent color', { accentColor });

    const root = document.documentElement;
    root.style.setProperty('--astra-accent', accentColor);

    if (accentColor.startsWith('#') && accentColor.length === 7) {
      // Update RGB variable - this is the "source of truth" for all transparent variants in CSS
      const r = parseInt(accentColor.slice(1, 3), 16);
      const g = parseInt(accentColor.slice(3, 5), 16);
      const b = parseInt(accentColor.slice(5, 7), 16);
      root.style.setProperty('--astra-accent-rgb', `${r}, ${g}, ${b}`);
    }
  }

  public destroy(): void {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
  }
}
