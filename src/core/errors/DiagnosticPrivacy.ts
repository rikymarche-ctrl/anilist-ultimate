import { ApiError, AppError, AuthError, ConfigError, ModuleError, StorageError, ValidationError } from './ErrorTypes';

const privateKeys = /^(?:authorization|access[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|token|password|cookie|state|headers|variables|request|response|body|notes|episodeNotes|originalError|cause|value)$/i;
const credentialKeys = /^(?:authorization|access[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|token|password|cookie|state|code)$/i;
const errorPrototypes: object[] = [ApiError.prototype, AppError.prototype, AuthError.prototype, ConfigError.prototype, ModuleError.prototype, StorageError.prototype, ValidationError.prototype, Error.prototype, TypeError.prototype, RangeError.prototype, SyntaxError.prototype, ReferenceError.prototype, URIError.prototype, EvalError.prototype];

function redactUrl(text: string): string {
  try {
    const url = new URL(text);
    let changed = false;
    if (url.username || url.password) {
      url.username = '[redacted]';
      url.password = '';
      changed = true;
    }
    for (const key of [...url.searchParams.keys()]) {
      if (!credentialKeys.test(key)) continue;
      url.searchParams.set(key, '[redacted]');
      changed = true;
    }
    let hash = url.hash.slice(1);
    // OAuth redirect fragments may themselves be encoded as a URL parameter.
    if (!hash.includes('=') && /%3d/i.test(hash)) {
      try { hash = decodeURIComponent(hash); } catch { /* Keep the original fragment on malformed encoding. */ }
    }
    const params = new URLSearchParams(hash);
    let changedHash = false;
    for (const key of [...params.keys()]) {
      if (!credentialKeys.test(key)) continue;
      params.set(key, '[redacted]');
      changedHash = true;
    }
    if (changedHash) { url.hash = params.toString(); changed = true; }
    return changed ? url.toString() : text;
  } catch {
    // Invalid URLs still pass through the plain-text credential sanitizer.
    return text;
  }
}

/** Redact transport payloads before diagnostics enter logs/history/events. */
export function diagnosticText(text: string): string {
  if (/(?:variables|headers|request|response|body|notes|episodeNotes)["']?\s*[:=]/i.test(text)
    || /\b(?:query|mutation)\s*(?:\w+\s*)?[({]/.test(text)) return '[redacted diagnostic payload]';
  return text.replace(/\b[a-z][a-z\d+.-]*:\/\/[^\s"'<>]+/gi, redactUrl)
    .replace(/Bearer\s+[^\s,;"']+/gi, 'Bearer [redacted]')
    .replace(/((?:access[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|token|password|cookie|state)["']?\s*[:=]\s*["']?)[^\s&;,"']+/gi, '$1[redacted]')
    .slice(0, 2000);
}

export function diagnosticError(error: Error): Error {
  try {
    // Preserve application classification without retaining arbitrary subclass
    // accessors, serializers, causes or transport payloads on its prototype.
    let prototype = Object.getPrototypeOf(error) as object | null;
    const seen = new Set<object>();
    while (prototype && !errorPrototypes.includes(prototype)) {
      if (seen.has(prototype)) { prototype = null; break; }
      seen.add(prototype);
      prototype = Object.getPrototypeOf(prototype) as object | null;
    }
    const safe = Object.create(prototype ?? Error.prototype) as Error;
    const define = (key: string, value: unknown) => Object.defineProperty(safe, key, { value, writable: true, configurable: true, enumerable: true });
    const name = descriptorValue(error, 'name');
    const message = descriptorValue(error, 'message');
    const stack = descriptorValue(error, 'stack');
    define('name', typeof name === 'string' ? diagnosticText(name) : 'Error');
    define('message', typeof message === 'string' ? diagnosticText(message) : 'Unknown error');
    define('stack', typeof stack === 'string' ? stack.split('\n').slice(0, 8).map(diagnosticText).join('\n') : undefined);
    for (const key of ['statusCode', 'retryCount', 'endpoint', 'context', 'moduleName', 'operation', 'key', 'configKey', 'reason', 'field']) {
      const value = descriptorValue(error, key);
      if (typeof value === 'string') define(key, diagnosticText(value));
      else if (typeof value === 'number' && Number.isFinite(value)) define(key, value);
    }
    return safe;
  } catch {
    return new Error('Unavailable diagnostic error');
  }
}

function descriptorValue(value: object, key: string): unknown {
  let current: object | null = value;
  const seen = new Set<object>();
  while (current && !seen.has(current)) {
    seen.add(current);
    const descriptor = Object.getOwnPropertyDescriptor(current, key);
    if (descriptor) return 'value' in descriptor ? descriptor.value : '[omitted accessor]';
    current = Object.getPrototypeOf(current) as object | null;
  }
  return undefined;
}

export function diagnosticValue(value: unknown, depth = 0): unknown {
  try {
    if (value instanceof Error) return diagnosticError(value);
    if (typeof value === 'string') return diagnosticText(value);
    // A copied toJSON function would run against the sanitized object later.
    if (typeof value === 'function') return '[omitted function]';
    if (value === null || typeof value !== 'object') return value;
    if (depth >= 3) return '[omitted nested data]';
    if (Array.isArray(value)) return Array.from({ length: Math.min(value.length, 20) }, (_, index) => diagnosticValue(descriptorValue(value, String(index)), depth + 1));
    return Object.fromEntries(Object.keys(value).slice(0, 20).map(key => [diagnosticText(key), privateKeys.test(key) ? '[redacted]' : diagnosticValue(descriptorValue(value, key), depth + 1)]));
  } catch {
    return '[unavailable diagnostic data]';
  }
}
