/**
 * @file Service worker MV3 per gestione OAuth tramite chrome.identity
 * @author ExAstra
 * @version 2.0.0
 *
 * Gestisce il flusso OAuth con AniList in modo nativo Chrome, salvando
 * il token in chrome.storage.local (accessibile da tutti i contesti).
 * Non dipende da tsyringe o DOM - standalone.
 */

import {
  MSG,
  AUTH_STORAGE_KEY,
  AUTH_USER_CACHE_KEY,
  type AuthLoginResponse,
  type AuthLogoutResponse,
  type AuthStatusResponse,
  type UserCache,
} from './shared/messages';

/**
 * Configurazione OAuth AniList
 */
const OAUTH_CONFIG = {
  CLIENT_ID: import.meta.env.VITE_ANILIST_CLIENT_ID || '35100',
  AUTH_URL: 'https://anilist.co/api/v2/oauth/authorize',
  API_URL: 'https://graphql.anilist.co',
};

/**
 * Query GraphQL per ottenere i dati dell'utente loggato
 */
const VIEWER_QUERY = `
  query {
    Viewer {
      id
      name
    }
  }
`;

/**
 * Gestisce il flusso di login OAuth
 */
async function handleLogin(): Promise<AuthLoginResponse> {
  try {
    // 1. Richiedi l'Access Token tramite Implicit Grant
    // IMPORTANTE: Per AniList non includiamo redirect_uri nell'URL di richiesta
    const authURL = new URL(OAUTH_CONFIG.AUTH_URL);
    authURL.searchParams.set('client_id', OAUTH_CONFIG.CLIENT_ID);
    authURL.searchParams.set('response_type', 'token');

    console.log('[Background] Starting secure OAuth flow (Implicit)');
    
    let responseURL: string | undefined;
    try {
      responseURL = await chrome.identity.launchWebAuthFlow({
        url: authURL.toString(),
        interactive: true,
      });
    } catch (launchError: any) {
      if (launchError.message === 'The user did not approve access') {
        console.log('[Background] Login cancelled by user.');
        return { success: false, error: 'Login cancelled by user.' };
      }
      console.error('[Background] launchWebAuthFlow error:', launchError);
      throw new Error(`Chrome could not load the auth page: ${launchError.message}`);
    }

    if (!responseURL) {
      throw new Error('No response URL from OAuth flow');
    }

    console.log('[Background] Full Response URL:', responseURL);

    const url = new URL(responseURL);
    
    // 1. Controlla se c'è un errore nella query string o nel fragment
    const errorParam = url.searchParams.get('error') || new URLSearchParams(url.hash.substring(1)).get('error');
    if (errorParam) {
      console.log('[Background] Auth error from server:', errorParam);
      return { 
        success: false, 
        error: errorParam === 'access_denied' ? 'Access denied by user.' : `OAuth Error: ${errorParam}`
      };
    }

    // 2. Estrae il token dall'URL di risposta (nel fragment #)
    const fragment = url.hash.substring(1);
    console.log('[Background] URL Fragment:', fragment);
    
    const params = new URLSearchParams(fragment);
    const token = params.get('access_token');

    if (!token) {
      throw new Error('No access token in OAuth response');
    }

    console.log('[Background] OAuth token obtained successfully');

    // 3. Fetcha i dati utente da AniList
    const response = await fetch(OAUTH_CONFIG.API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ query: VIEWER_QUERY }),
    });

    if (!response.ok) {
      throw new Error(`GraphQL request failed: ${response.status}`);
    }

    const data = await response.json();
    const viewer = data?.data?.Viewer;

    if (!viewer) {
      throw new Error('No viewer data in GraphQL response');
    }

    const userCache: UserCache = {
      userId: viewer.id,
      userName: viewer.name,
    };

    // Salva token e user cache in chrome.storage.local
    await chrome.storage.local.set({
      [AUTH_STORAGE_KEY]: token,
      [AUTH_USER_CACHE_KEY]: userCache,
    });

    console.log('[Background] Login successful for user:', viewer.name);

    return {
      success: true,
      token,
      userId: viewer.id,
      userName: viewer.name,
    };
  } catch (error) {
    console.error('[Background] Login failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Gestisce il logout (rimuove token e cache)
 */
async function handleLogout(): Promise<AuthLogoutResponse> {
  try {
    await chrome.storage.local.remove([AUTH_STORAGE_KEY, AUTH_USER_CACHE_KEY]);
    console.log('[Background] Logout successful');
    return { success: true };
  } catch (error) {
    console.error('[Background] Logout failed:', error);
    return { success: false };
  }
}

/**
 * Restituisce lo status di autenticazione corrente
 */
async function handleGetStatus(): Promise<AuthStatusResponse> {
  try {
    const result = await chrome.storage.local.get([
      AUTH_STORAGE_KEY,
      AUTH_USER_CACHE_KEY,
    ]);

    const token = result[AUTH_STORAGE_KEY] as string | undefined;
    const userCache = result[AUTH_USER_CACHE_KEY] as UserCache | undefined;

    if (token && userCache) {
      return {
        authenticated: true,
        token,
        userId: userCache.userId,
        userName: userCache.userName,
      };
    }

    return { authenticated: false };
  } catch (error) {
    console.error('[Background] Get status failed:', error);
    return { authenticated: false };
  }
}

/**
 * Listener messaggi da popup e content script
 */
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  console.log('[Background] Received message:', message.type);

  switch (message.type) {
    case MSG.AUTH_LOGIN:
      handleLogin().then(sendResponse);
      return true; // Async response

    case MSG.AUTH_LOGOUT:
      handleLogout().then(sendResponse);
      return true; // Async response

    case MSG.AUTH_STATUS:
      handleGetStatus().then(sendResponse);
      return true; // Async response

    default:
      console.warn('[Background] Unknown message type:', message.type);
      sendResponse({ success: false, error: 'Unknown message type' });
      return false;
  }
});

console.log('[Background] Service worker initialized');

// Stampa redirect URI per configurazione OAuth su AniList
const redirectURL = chrome.identity.getRedirectURL();
console.log('='.repeat(80));
console.log('ANILIST OAUTH CONFIGURATION');
console.log('='.repeat(80));
console.log('Per configurare OAuth su AniList:');
console.log('1. Vai a: https://anilist.co/settings/developer');
console.log(`2. Modifica l\'app con Client ID: ${OAUTH_CONFIG.CLIENT_ID}`);
console.log('3. Aggiungi questo Redirect URI:');
console.log('');
console.log(`   ${redirectURL}`);
console.log('');
console.log('4. Salva le modifiche');
console.log('='.repeat(80));
