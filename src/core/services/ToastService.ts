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
import type { IEventBus } from '@core/interfaces/IEventBus';
import { ToastContainer } from '@ui/components/ToastContainer';
import { log } from '@core/logger';
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
    if (this.container) return;

    this.container = new ToastContainer({});
    this.container.mount(document.body);
    log.debug('[ToastService] Initialized');
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

    const id = Math.random().toString(36).substring(2, 11);
    const duration = options.duration ?? (type === 'error' ? 8000 : this.DEFAULT_DURATION);

    this.container?.addToast({
      id,
      type,
      message,
      title: options.title,
      duration,
      mediaId: options.mediaId,
      progress: options.progress
    }, options.mediaId ? (mId, note) => this.calendarService.updateNotes(mId, options.progress || 0, note) : undefined);
  }

  /**
   * Setup event listeners for automatic notifications
   */
  private setupEventListeners(): void {
    // Listen for global errors
    const lastErrorMessages = new Map<string, number>();
    const COOLDOWN = 3000; // 3 seconds cooldown for identical messages

    this.eventBus.on(EVENT_TYPES.ERROR_OCCURRED, (data: any) => {
      const { error, context, severity } = data;
      const message = error.message || 'An unexpected error occurred';
      const now = Date.now();

      // Check for duplicates
      if (lastErrorMessages.has(message) && (now - lastErrorMessages.get(message)! < COOLDOWN)) {
        return;
      }
      lastErrorMessages.set(message, now);
      
      // Only show toasts for High/Critical errors or if they have a specific context
      if (severity === 'high' || severity === 'critical' || context !== 'unknown') {
        this.error(message, {
          title: context ? `Error in ${context}` : 'Error'
        });
      }
    });

    // Listen for Auth events
    this.eventBus.on(EVENT_TYPES.AUTH_REQUIRED, () => {
      this.warn('Authentication required to perform this action.', {
        title: 'Login Required',
        duration: 10000
      });
    });

    // Listen for API errors
    this.eventBus.on(EVENT_TYPES.API_ERROR, (data: any) => {
      if (data.statusCode === 429) {
        this.warn('AniList rate limit hit. Retrying in 60 seconds...', {
          title: 'Rate Limited',
          duration: 5000
        });
      }
    });
  }
}
