import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MSG } from '@shared/messages';

// Module loading under CPU contention can exceed the 5s default in jsdom.
vi.setConfig({ testTimeout: 20_000 });

vi.mock('@core/ui/Icons', () => ({}));

interface Backend {
  authenticated: boolean;
  logoutSucceeds: boolean;
  /** When true, the status check still reports a signed-in user after logout. */
  statusStaysAuthenticated?: boolean;
}

const SPINNER = 'spinner';

function renderPopup(): void {
  document.body.innerHTML = `
    <div id="auth-card">
      <div id="login-container">
        <button id="login-btn"><i class="fa-solid fa-arrow-right-to-bracket"></i> <span>Continue with AniList</span></button>
      </div>
      <div id="user-info" class="hidden">
        <div id="user-name"></div>
        <button id="logout-btn"><i class="fa-solid fa-arrow-right-from-bracket"></i> <span>Log out</span></button>
      </div>
    </div>`;
}

function mockBackend(backend: Backend): void {
  vi.mocked(chrome.runtime.sendMessage).mockImplementation((async (message: { type: string }) => {
    if (message.type === MSG.AUTH_STATUS) {
      return backend.authenticated
        ? { authenticated: true, userName: 'ricca' }
        : { authenticated: false };
    }
    if (message.type === MSG.AUTH_LOGOUT) {
      if (!backend.logoutSucceeds) return { success: false };
      if (!backend.statusStaysAuthenticated) backend.authenticated = false;
      return { success: true };
    }
    throw new Error(`unexpected message ${message.type}`);
  }) as never);
}

/** Loads a fresh popup controller, which binds to the current DOM. */
async function openPopup(): Promise<void> {
  vi.resetModules();
  await import('./popup');
  await vi.waitFor(() =>
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: MSG.AUTH_STATUS })
  );
  await vi.waitFor(() =>
    expect(document.getElementById('user-info')!.classList.contains('hidden')).toBe(false)
  );
}

function logoutButton(): HTMLButtonElement {
  return document.getElementById('logout-btn') as HTMLButtonElement;
}

describe('popup logout button', () => {
  beforeEach(() => {
    renderPopup();
    vi.mocked(chrome.runtime.sendMessage).mockReset();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.spyOn(window, 'alert').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it('re-enables the logout button after a successful logout', async () => {
    mockBackend({ authenticated: true, logoutSucceeds: true });
    await openPopup();

    logoutButton().click();

    await vi.waitFor(() => expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(3));
    await vi.waitFor(() => expect(logoutButton().disabled).toBe(false));
    expect(logoutButton().innerHTML).not.toContain(SPINNER);
    expect(logoutButton().textContent).toContain('Log out');
  });

  it('keeps the logout button usable when the status still reports a signed-in user after logout', async () => {
    mockBackend({ authenticated: true, logoutSucceeds: true, statusStaysAuthenticated: true });
    await openPopup();

    logoutButton().click();

    await vi.waitFor(() => expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(3));
    await vi.waitFor(() => expect(logoutButton().disabled).toBe(false));
    expect(logoutButton().innerHTML).not.toContain(SPINNER);
  });

  it('re-enables the logout button after a failed logout', async () => {
    mockBackend({ authenticated: true, logoutSucceeds: false });
    await openPopup();

    logoutButton().click();

    await vi.waitFor(() =>
      expect(window.alert).toHaveBeenCalledWith('Logout failed. Please try again.')
    );
    expect(logoutButton().disabled).toBe(false);
    expect(logoutButton().innerHTML).not.toContain(SPINNER);
  });

  it('does nothing when the logout confirmation is dismissed', async () => {
    mockBackend({ authenticated: true, logoutSucceeds: true });
    vi.mocked(window.confirm).mockReturnValue(false);
    await openPopup();

    logoutButton().click();

    expect(logoutButton().disabled).toBe(false);
    expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);
  });
});
