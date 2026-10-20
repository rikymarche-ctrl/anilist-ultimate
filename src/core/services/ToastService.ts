/**
 * @file ToastService.ts
 * @description Global notification toast service with event-driven auto-display
 *
 * Provides success/error/info/warn toast methods and auto-initializes
 * a ToastContainer in the DOM. Listens on the EventBus for:
 *   - ERROR_OCCURRED: shows error toasts (high/critical severity only)
 *   - AUTH_REQUIRED: prompts user to log in
 *   - API_ERROR (429): rate-limit warning
 *
 * Duplicate suppression: identical error messages are throttled with
 * a 3-second cooldown to prevent toast spam.
 *
 * @see docs/ARCHITECTURE.md#toast-system
 */

import { injectable, inject } from 'tsyringe';
import { TOKENS } from '@core/di/tokens';
import { EVENT_TYPES } from '@core/events/EventTypes';
import type { EventSubscription, IEventBus } from '@core/interfaces/IEventBus';
import { ToastContainer } from '@ui/components/ToastContainer';
import { logger } from '@core/logger';
import type { ToastType } from '@ui/components/Toast';
import type { ICalendarService } from '@core/interfaces/ICalendarService';

export interface ToastOptions {
  title?: string;
  duration?: number;
  mediaId?: number;
  progress?: number;
}

@injectable()
export class ToastService {
  private container: ToastContainer | null = null;
  private readonly DEFAULT_DURATION = 5000;
  private lastRateLimitWarningAt: number | null = null;
  private subscriptions: EventSubscription[] = [];
  private lastErrorMessages = new Map<string, number>();
  private initTimeout: ReturnType<typeof setTimeout> | null = null;
  private awaitingBody = false;
  private generation = 0;
  private destroyed = false;
  private readonly bodyReady = () => { this.awaitingBody = false; this.init(); };

  constructor(
    @inject(TOKENS.EventBus) private eventBus: IEventBus,
    @inject(TOKENS.CalendarService) private calendarService: ICalendarService
  ) {
    this.setupEventListeners();
  }

  /**
   * Initialize the toast container in the DOM
   */
  public init(): void {
    if (this.destroyed) return;
    if (this.container) return;

    if (!document.body) {
      logger.warn('[ToastService] document.body not found, delaying initialization...');
      if (document.readyState === 'loading') {
        if (!this.awaitingBody) {
          this.awaitingBody = true;
          document.addEventListener('DOMContentLoaded', this.bodyReady, { once: true });
        }
      } else {
        if (this.initTimeout === null) this.initTimeout = setTimeout(() => { this.initTimeout = null; this.init(); }, 100);
      }
      return;
    }

    this.container = new ToastContainer({});
    this.container.mount(document.body);
    logger.debug('[ToastService] Initialized');
  }

  /**
   * Show a success toast
   */
  public success(message: string, options?: ToastOptions): void {
    this.show('success', message, options);
  }

  /**
   * Show an error toast
   */
  public error(message: string, options?: ToastOptions): void {
    this.show('error', message, options);
  }

  /**
   * Show an info toast
   */
  public info(message: string, options?: ToastOptions): void {
    this.show('info', message, options);
  }

  /**
   * Show a warning toast
   */
  public warn(message: string, options?: ToastOptions): void {
    this.show('warning', message, options);
  }

  /**
   * Base method to show a toast
   */
  private show(type: ToastType, message: string, options: ToastOptions = {}): void {
    if (!this.container) {
      this.init();
    }

    if (this.destroyed) return;
    const generation = this.generation;
    const id = crypto.randomUUID();
    const duration = options.duration ?? (type === 'error' ? 8000 : this.DEFAULT_DURATION);

    this.container?.addToast({
      id,
      type,
      message,
      title: options.title,
      duration,
      mediaId: options.mediaId,
      progress: options.progress
    }, options.mediaId ? async (mId, note) => {
      if (this.destroyed || generation !== this.generation) throw new Error('Toast account changed');
      await this.calendarService.updateNotes(mId, options.progress ?? 0, note);
    } : undefined);
  }

  /**
   * Setup event listeners for automatic notifications
   */
  private setupEventListeners(): void {
    // Listen for global errors
    const lastErrorMessages = this.lastErrorMessages;
    const COOLDOWN = 3000; // 3 seconds cooldown for identical messages

    this.subscriptions.push(this.eventBus.on(EVENT_TYPES.ERROR_OCCURRED, (data) => {
      if (!data) return;
      const { error, context, severity } = data;
      const message = error.message || 'An unexpected error occurred';
      const now = Date.now();

      for (const [key, timestamp] of lastErrorMessages) {
        if (now - timestamp >= COOLDOWN) lastErrorMessages.delete(key);
      }
      // Check for duplicates
      if (lastErrorMessages.has(message) && (now - lastErrorMessages.get(message)! < COOLDOWN)) {
        return;
      }
      if (lastErrorMessages.size >= 100) lastErrorMessages.delete(lastErrorMessages.keys().next().value!);
      lastErrorMessages.set(message, now);
      
      // Only show toasts for High/Critical errors or if they have a specific context
      if (severity === 'high' || severity === 'critical' || context !== 'unknown') {
        this.error(message, {
          title: context ? `Error in ${context}` : 'Error'
        });
      }
    }));

    // Listen for Auth events
    this.subscriptions.push(this.eventBus.on(EVENT_TYPES.AUTH_REQUIRED, () => {
      this.warn('Authentication required to perform this action.', {
        title: 'Login Required',
        duration: 10000
      });
    }));

    // Listen for API errors
    this.subscriptions.push(this.eventBus.on(EVENT_TYPES.API_ERROR, (data) => {
      if (data?.statusCode === 429) {
        const now = Date.now();
        // API errors can originate from concurrent requests. One warning for
        // the 60-second cooldown is enough and avoids duplicate toast cards.
        if (this.lastRateLimitWarningAt !== null && now - this.lastRateLimitWarningAt < 60000) return;
        this.lastRateLimitWarningAt = now;
        this.warn('AniList rate limit hit. Retrying in 60 seconds...', {
          title: 'Rate Limited',
          duration: 5000
        });
      }
    }));
    this.subscriptions.push(this.eventBus.on(EVENT_TYPES.AUTH_STATE_CHANGED, () => {
      this.generation++;
      this.container?.clear();
      this.lastErrorMessages.clear();
      this.lastRateLimitWarningAt = null;
    }));
  }

  public destroy(): void {
    this.destroyed = true;
    this.generation++;
    for (const subscription of this.subscriptions.splice(0)) subscription.unsubscribe();
    document.removeEventListener('DOMContentLoaded', this.bodyReady);
    this.awaitingBody = false;
    if (this.initTimeout !== null) clearTimeout(this.initTimeout);
    this.initTimeout = null;
    this.container?.unmount();
    this.container = null;
    this.lastErrorMessages.clear();
  }
}
