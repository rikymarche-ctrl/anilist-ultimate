import 'reflect-metadata';
import { logger } from '@core/logger';
import { APP_VERSION } from '@core/constants';
/**
 * @file popup.ts
 * @description Controller UI per il popup dell'estensione (login/logout)
 * @author ExAstra
 * @version 1.0.3
 *
 * Comunica con il background service worker tramite chrome.runtime.sendMessage
 * per gestire login/logout OAuth e visualizzare lo stato di autenticazione.
 */

import {
  MSG,
  type AuthLoginResponse,
  type AuthLogoutResponse,
  type AuthStatusResponse,
} from '../shared/messages';
import '@fortawesome/fontawesome-free/css/all.min.css';
// Self-hosted fonts: extension pages make no third-party font requests.
import '@fontsource/outfit/latin-400.css';
import '@fontsource/outfit/latin-500.css';
import '@fontsource/outfit/latin-700.css';
import '@core/ui/Icons';
import { AuthLoginError, authFailureMessage, parseAuthFailureCode } from '@core/auth/AuthFailure';

// Elementi DOM
const loginBtn = document.getElementById('login-btn') as HTMLButtonElement;
const logoutBtn = document.getElementById('logout-btn') as HTMLButtonElement;
const authCard = document.getElementById('auth-card') as HTMLElement;
const userInfo = document.getElementById('user-info') as HTMLDivElement;
const loginContainer = document.getElementById('login-container') as HTMLDivElement;
const userNameText = document.getElementById('user-name') as HTMLDivElement;
const appVersionText = document.getElementById('app-version') as HTMLSpanElement | null;
if (appVersionText) appVersionText.textContent = APP_VERSION;

/**
 * Controlla lo status di autenticazione corrente e aggiorna la UI
 */
async function checkAuthStatus(): Promise<void> {
  try {
    const response = (await chrome.runtime.sendMessage({
      type: MSG.AUTH_STATUS,
    })) as AuthStatusResponse;

    updateUI(response);
  } catch (error) {
    logger.error('[Popup] Failed to check auth status:', error);
    updateUI({ authenticated: false });
  }
}

/**
 * Gestisce il login OAuth
 */
async function handleLogin(): Promise<void> {
  try {
    // Disabilita bottone e mostra spinner
    loginBtn.disabled = true;
    loginBtn.innerHTML = '<span class="spinner"></span> Connecting…';

    const response = (await chrome.runtime.sendMessage({
      type: MSG.AUTH_LOGIN,
    })) as AuthLoginResponse;

    if (response.success) {
      logger.debug('[Popup] Login successful');
      await checkAuthStatus(); // Aggiorna UI
    } else {
      logger.error('[Popup] Login failed');
      alert(
        authFailureMessage(
          new AuthLoginError(parseAuthFailureCode(response.code) ?? 'AUTH_UNKNOWN')
        )
      );
      loginBtn.disabled = false;
      loginBtn.innerHTML =
        '<i class="fa-solid fa-arrow-right-to-bracket"></i> <span>Continue with AniList</span>';
    }
  } catch (error) {
    logger.error('[Popup] Login error:', error);
    alert('Login failed. Please try again.');
    loginBtn.disabled = false;
    loginBtn.innerHTML =
      '<i class="fa-solid fa-arrow-right-to-bracket"></i> <span>Continue with AniList</span>';
  }
}

/** Ripristina il bottone di logout allo stato iniziale (abilitato, etichetta standard). */
function resetLogoutButton(): void {
  logoutBtn.disabled = false;
  logoutBtn.innerHTML =
    '<i class="fa-solid fa-arrow-right-from-bracket"></i> <span>Log out</span>';
}

/**
 * Gestisce il logout
 */
async function handleLogout(): Promise<void> {
  try {
    // Conferma logout
    if (!confirm('Are you sure you want to logout?')) {
      return;
    }

    logoutBtn.disabled = true;
    logoutBtn.innerHTML = '<span class="spinner"></span> Logging out...';

    const response = (await chrome.runtime.sendMessage({
      type: MSG.AUTH_LOGOUT,
    })) as AuthLogoutResponse;

    if (response.success) {
      logger.debug('[Popup] Logout successful');
      resetLogoutButton();
      await checkAuthStatus(); // Aggiorna UI
    } else {
      logger.error('[Popup] Logout failed');
      alert('Logout failed. Please try again.');
      resetLogoutButton();
    }
  } catch (error) {
    logger.error('[Popup] Logout error:', error);
    alert('Logout failed. Please try again.');
    resetLogoutButton();
  }
}

/**
 * Aggiorna la UI in base allo stato di autenticazione
 */
function updateUI(status: AuthStatusResponse): void {
  if (status.authenticated && status.userName) {
    // Utente autenticato
    authCard.classList.add('authenticated');
    userNameText.textContent = status.userName;
    userInfo.classList.remove('hidden');
    loginContainer.classList.add('hidden');
    resetLogoutButton();
  } else {
    // Utente non autenticato
    authCard.classList.remove('authenticated');
    userInfo.classList.add('hidden');
    loginContainer.classList.remove('hidden');

    // Ripristina bottone login
    loginBtn.disabled = false;
    loginBtn.innerHTML =
      '<i class="fa-solid fa-arrow-right-to-bracket"></i> <span>Continue with AniList</span>';
  }
}

// Event listeners
loginBtn.addEventListener('click', () => {
  void handleLogin().catch((error: unknown) => logger.error('[Popup] Login handler failed', error));
});
logoutBtn.addEventListener('click', () => {
  void handleLogout().catch((error: unknown) => logger.error('[Popup] Logout handler failed', error));
});

const settingsBtn = document.getElementById('settings-btn') as HTMLButtonElement;
if (settingsBtn) {
  settingsBtn.addEventListener('click', () => {
    void chrome.runtime.openOptionsPage().catch((error: unknown) => logger.error('[Popup] Failed to open options page', error));
  });
}

// Controlla status al caricamento
void checkAuthStatus().catch((error: unknown) => logger.error('[Popup] Auth status check failed', error));
