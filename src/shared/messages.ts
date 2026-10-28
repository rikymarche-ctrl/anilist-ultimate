/**
 * @file Protocollo messaggi per comunicazione cross-context (popup ↔ background ↔ content script)
 * @author ExAstra
 * @version 1.0.3
 */

/**
 * Tipi di messaggio supportati per l'autenticazione
 */
export const MSG = {
  AUTH_LOGIN: 'auth:login',
  AUTH_LOGOUT: 'auth:logout',
  AUTH_STATUS: 'auth:status',
  SYNC_ENQUEUE: 'sync:enqueue',
  SYNC_PROCESS: 'sync:process',
  SYNC_GET: 'sync:get',
  SYNC_SNAPSHOT: 'sync:snapshot',
  SYNC_CLEAR: 'sync:clear',
  SYNC_PROGRESS: 'sync:progress',
  SYNC_NOTE: 'sync:note',
  SYNC_RECOVERY: 'sync:recovery',
  CUSTOM_LISTS: 'lists:command',
  FRIEND_ALERTS: 'friend-alerts:command',
  ASTRA_COMMAND: 'astra:command',
  ASTRA_RECOVERY: 'astra:recovery',
  API_REQUEST: 'api:request',
  MEDIA_MUSIC_THEMES: 'media:music-themes',
  MEDIA_MUSIC_SEARCH: 'media:music-search',
  MEDIA_MUSIC_VIDEOS: 'media:music-videos',
  MEDIA_METADATA_SCORE: 'media:metadata-score',
  LOCAL_STORAGE: 'storage:local',
  LOCAL_CHANGED: 'storage:changed',
  CONFIG_COMMAND: 'config:command',
  CALENDAR_CACHE: 'calendar:cache',
} as const;

/**
 * Chiavi storage per token e cache utente
 */
export const AUTH_STORAGE_KEY = 'anilist_ultimate_auth_token';
export const AUTH_USER_CACHE_KEY = 'anilist_ultimate_user_cache';
export const AUTH_SESSION_KEY = 'anilist_ultimate_auth_session';

/**
 * Messaggio di richiesta login
 */
export interface AuthLoginRequest {
  type: typeof MSG.AUTH_LOGIN;
}

/**
 * Risposta al login (successo o errore)
 */
export interface AuthLoginResponse {
  success: boolean;
  userId?: number;
  userName?: string;
  error?: string;
  code?: string;
}

/**
 * Messaggio di richiesta logout
 */
export interface AuthLogoutRequest {
  type: typeof MSG.AUTH_LOGOUT;
}

/**
 * Risposta al logout
 */
export interface AuthLogoutResponse {
  success: boolean;
}

/**
 * Messaggio di richiesta status
 */
export interface AuthStatusRequest {
  type: typeof MSG.AUTH_STATUS;
}

/**
 * Risposta con status autenticazione corrente
 */
export interface AuthStatusResponse {
  authenticated: boolean;
  userId?: number;
  userName?: string;
  sessionId?: string;
}

/**
 * Cache utente salvata in chrome.storage
 */
export interface UserCache {
  userId: number;
  userName: string;
}
