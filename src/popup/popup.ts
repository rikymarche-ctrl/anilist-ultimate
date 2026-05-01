/**
 * @file popup.ts
 * @description Controller UI per il popup dell'estensione (login/logout)
 * @author ExAstra
 * @version 2.0.0
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

// Elementi DOM
const loginBtn = document.getElementById('login-btn') as HTMLButtonElement;
const logoutBtn = document.getElementById('logout-btn') as HTMLButtonElement;
const authStatus = document.getElementById('auth-status') as HTMLDivElement;
const statusIndicator = document.getElementById(
  'status-indicator'
) as HTMLSpanElement;
const userNameEl = document.getElementById('user-name') as HTMLDivElement;
const authStatusText = document.getElementById('auth-status-text') as HTMLSpanElement;

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
    console.error('[Popup] Failed to check auth status:', error);
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
    loginBtn.innerHTML =
      '<span class="spinner"></span> Logging in...';

    const response = (await chrome.runtime.sendMessage({
      type: MSG.AUTH_LOGIN,
    })) as AuthLoginResponse;

    if (response.success) {
      console.log('[Popup] Login successful');
      await checkAuthStatus(); // Aggiorna UI
    } else {
      console.error('[Popup] Login failed:', response.error);
      alert(`Login failed: ${response.error || 'Unknown error'}`);
      loginBtn.disabled = false;
      loginBtn.innerHTML = '<i class="fa-solid fa-right-to-bracket" style="margin-right: 8px;"></i> Login with AniList';
    }
  } catch (error) {
    console.error('[Popup] Login error:', error);
    alert('Login failed. Please try again.');
    loginBtn.disabled = false;
    loginBtn.innerHTML = '<i class="fa-solid fa-right-to-bracket" style="margin-right: 8px;"></i> Login with AniList';
  }
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
      console.log('[Popup] Logout successful');
      await checkAuthStatus(); // Aggiorna UI
    } else {
      console.error('[Popup] Logout failed');
      alert('Logout failed. Please try again.');
      logoutBtn.disabled = false;
      logoutBtn.innerHTML = '<i class="fa-solid fa-right-from-bracket" style="margin-right: 8px;"></i> Logout';
    }
  } catch (error) {
    console.error('[Popup] Logout error:', error);
    alert('Logout failed. Please try again.');
    // Ripristina bottone
    logoutBtn.disabled = false;
    logoutBtn.textContent = 'Logout';
  }
}

/**
 * Aggiorna la UI in base allo stato di autenticazione
 */
function updateUI(status: AuthStatusResponse): void {
  if (status.authenticated && status.userName) {
    // Utente autenticato
    authStatus.classList.remove('not-authenticated');
    authStatus.classList.add('authenticated');
    authStatusText.textContent = 'Authenticated';

    statusIndicator.classList.remove('not-authenticated');
    statusIndicator.classList.add('authenticated');

    userNameEl.textContent = status.userName;
    userNameEl.classList.remove('hidden');

    loginBtn.classList.add('hidden');
    logoutBtn.classList.remove('hidden');
  } else {
    // Utente non autenticato
    authStatus.classList.remove('authenticated');
    authStatus.classList.add('not-authenticated');
    authStatusText.textContent = 'Not authenticated';

    statusIndicator.classList.remove('authenticated');
    statusIndicator.classList.add('not-authenticated');

    userNameEl.classList.add('hidden');

    loginBtn.classList.remove('hidden');
    logoutBtn.classList.add('hidden');

    // Ripristina bottone login
    loginBtn.disabled = false;
    loginBtn.innerHTML = '<i class="fa-solid fa-right-to-bracket" style="margin-right: 8px;"></i> Login with AniList';
  }
}

// Event listeners
loginBtn.addEventListener('click', handleLogin);
logoutBtn.addEventListener('click', handleLogout);

const settingsBtn = document.getElementById('settings-btn') as HTMLButtonElement;
if (settingsBtn) {
  settingsBtn.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
}

// Controlla status al caricamento
checkAuthStatus();
