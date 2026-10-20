import { BaseComponent } from '@ui/components/BaseComponent';
import { AuthLoginError, parseAuthFailureCode, type AuthFailureCode } from '@core/auth/AuthFailure';
import { logger } from '@core/logger';

const errors: Record<AuthFailureCode, { title: string; description: string }> = {
  AUTH_TRANSPORT: { title: 'Reconnect the extension', description: 'Reload this AniList tab, then try connecting again.' },
  AUTH_BACKGROUND: { title: 'The extension couldn’t start sign-in', description: 'Reload the extension and this tab, then try again.' },
  AUTH_STORAGE: { title: 'Your session couldn’t be saved', description: 'The browser couldn’t access extension storage. Please try again.' },
  AUTH_OPEN: { title: 'The sign-in window couldn’t open', description: 'Please try again to open AniList and connect your account.' },
  AUTH_PAGE_LOAD: { title: 'Couldn’t reach AniList', description: 'The sign-in page didn’t load. Please try again in a moment.' },
  AUTH_CANCELLED: { title: 'Sign-in wasn’t completed', description: 'You can try again whenever you’re ready to connect your account.' },
  AUTH_REDIRECT: { title: 'Sign-in couldn’t be verified', description: 'AniList returned an unexpected response. Please start sign-in again.' },
  AUTH_STATE: { title: 'Sign-in couldn’t be verified', description: 'The sign-in verification didn’t match. Please start again.' },
  AUTH_TOKEN: { title: 'AniList didn’t complete sign-in', description: 'Please try again and finish authorizing the extension on AniList.' },
  AUTH_VIEWER: { title: 'Your account couldn’t be verified', description: 'Authorization completed, but your account details couldn’t be loaded. Please try again.' },
  AUTH_REFRESH: { title: 'Your session couldn’t be confirmed', description: 'Please try connecting your account again.' },
  AUTH_UNKNOWN: { title: 'Login could not be completed', description: 'Please try again. If you just updated the extension, reload this tab first.' },
};

/** The calendar's signed-out, pending and recoverable-error states. */
export class CalendarAuthPrompt extends BaseComponent<{ onLogin: () => void | Promise<void> }> {
  private pending = false;

  protected render(): HTMLElement {
    const root = document.createElement('section');
    root.className = 'calendar-auth-prompt';
    root.dataset.state = 'idle';
    root.setAttribute('aria-labelledby', 'au-calendar-auth-title');
    root.innerHTML = `
      <div class="calendar-auth-prompt__layout">
        <div class="calendar-auth-prompt__icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M16 3v4M8 3v4M3 11h18M8 15h2M14 15h2"/></svg>
        </div>
        <div class="calendar-auth-prompt__content">
          <h3 id="au-calendar-auth-title">Your calendar starts here</h3>
          <p class="calendar-auth-prompt__description">Connect your AniList account to see your weekly schedule and keep track of your progress.</p>
          <button type="button" class="calendar-auth-prompt__btn">
            <span class="calendar-auth-prompt__spinner" aria-hidden="true"></span>
            <span class="calendar-auth-prompt__label">Connect AniList</span>
          </button>
          <p class="calendar-auth-prompt__status" role="status" hidden>Complete sign-in in the AniList window.</p>
          <div class="calendar-auth-prompt__error" role="alert" hidden>
            <strong class="calendar-auth-prompt__error-title"></strong>
            <p class="calendar-auth-prompt__error-description"></p>
            <details class="calendar-auth-prompt__details">
              <summary>Technical details</summary>
              <code class="calendar-auth-prompt__code"></code>
            </details>
          </div>
        </div>
      </div>`;
    return root;
  }

  protected override attachEvents(): void {
    this.addEventListener(this.element.querySelector('button')!, 'click', () => { void this.login(); });
  }

  private async login(): Promise<void> {
    const root = this.element;
    const current = () => this.mounted && root === this.element && root.isConnected;
    if (!current() || this.pending) return;
    const button = root.querySelector<HTMLButtonElement>('button')!;
    const label = root.querySelector<HTMLElement>('.calendar-auth-prompt__label')!;
    const status = root.querySelector<HTMLElement>('[role="status"]')!;
    const errorPanel = root.querySelector<HTMLElement>('[role="alert"]')!;
    const details = root.querySelector<HTMLDetailsElement>('details')!;
    this.pending = true;
    root.dataset.state = 'pending';
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    label.textContent = 'Connecting…';
    status.hidden = false;
    errorPanel.hidden = true;
    details.open = false;
    let failed = false;
    try {
      await this.props.onLogin();
    } catch (error) {
      logger.error('[CalendarAuthPrompt] Login action failed');
      if (current()) {
        failed = true;
        const code = error instanceof AuthLoginError ? parseAuthFailureCode(error.code) ?? 'AUTH_UNKNOWN' : 'AUTH_UNKNOWN';
        root.querySelector<HTMLElement>('.calendar-auth-prompt__error-title')!.textContent = errors[code].title;
        root.querySelector<HTMLElement>('.calendar-auth-prompt__error-description')!.textContent = errors[code].description;
        root.querySelector<HTMLElement>('code')!.textContent = code;
        errorPanel.hidden = false;
      }
    } finally {
      if (current()) {
        this.pending = false;
        root.dataset.state = failed ? 'error' : 'idle';
        status.hidden = true;
        button.disabled = false;
        button.removeAttribute('aria-busy');
        label.textContent = failed ? 'Try again' : 'Connect AniList';
      }
    }
  }

  protected override onUnmount(): void { this.pending = false; }
}
