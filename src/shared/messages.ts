/**
 * @file Protocollo messaggi per comunicazione cross-context (popup ↔ background ↔ content script)
 * @author ExAstra
 * @version 1.0.0
 */

/**
 * Tipi di messaggio supportati per l'autenticazione
 */
export const MSG = {
  AUTH_LOGIN: 'auth:login',
  AUTH_LOGOUT: 'auth:logout',
  AUTH_STATUS: 'auth:status',
} as const;

/**
 * Chiavi storage per token e cache utente
 */
export const AUTH_STORAGE_KEY = 'anilist_auth_token';
export const AUTH_USER_CACHE_KEY = 'anilist_user_cache';

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
  token?: string;
  userId?: number;
  userName?: string;
  error?: string;
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
  token?: string;
  userId?: number;
  userName?: string;
}

/**
 * Cache utente salvata in chrome.storage
 */
export interface UserCache {
  userId: number;
  userName: string;
}
