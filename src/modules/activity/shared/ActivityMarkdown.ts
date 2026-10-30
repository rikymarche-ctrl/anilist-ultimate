/**
 * @file ActivityMarkdown.ts
 * @description Converts AniList server-rendered activity HTML (`text(asHtml: true)`) into safe DOM
 *
 * The markup is parsed in an inert document (no scripts, no image loads) and then walked
 * with a tag/attribute whitelist. Every output node is created fresh in the target document;
 * parsed nodes are never adopted or imported wholesale.
 *
 * Interactions (spoiler reveal, lazy YouTube embed) are delegated from a single container
 * listener so re-rendering never leaks per-element handlers.
 *
 * @see ActivityRenderer.ts for the custom-list feed that consumes this output
 * @see src/core/utils/WebUrl.ts for the URL policy shared with CSS image values
 */

import { parseWebUrl } from '@core/utils/WebUrl';

const MAX_HTML_LENGTH = 200_000;
const MAX_DEPTH = 64;
const MAX_SOURCE_URL_LENGTH = 2048;
const MAX_ALT_LENGTH = 300;
const ANILIST_ORIGIN = 'https://anilist.co';
const SPOILER_CLASS = 'markdown_spoiler';
const REVEALED_CLASS = 'au-spoiler-revealed';
const ACTIVATION_KEYS = new Set(['Enter', ' ']);

const DROPPED_TAGS = new Set([
  'script',
  'style',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'template',
  'noscript',
  'form',
  'input',
  'button',
  'textarea',
  'select',
  'option',
  'svg',
  'math',
  'link',
  'meta',
  'base',
  'title',
  'head',
  'audio',
  'canvas',
  'dialog',
]);

const ALLOWED_TAGS = new Set([
  'p',
  'br',
  'hr',
  'strong',
  'b',
  'em',
  'i',
  'del',
  's',
  'u',
  'a',
  'img',
  'video',
  'source',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'center',
  'blockquote',
  'code',
  'pre',
  'ul',
  'ol',
  'li',
  'span',
  'div',
  'sub',
  'sup',
]);

const HTTP_PREFIX = /^https?:\/\//i;
const HTTPS_PREFIX = /^https:\/\//i;
const SCHEME_PREFIX = /^[a-z][a-z0-9+.-]*:\/\//i;
const IMAGE_SIZE = /^\d{1,4}%?$/;
const VIDEO_TYPE = /^video\/[a-z0-9.+-]+$/i;
const LANGUAGE_CLASS = /^language-[\w-]{1,40}$/;
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be']);
const YOUTUBE_PATH = /^\/(?:embed|shorts)\/([^/]+)/;

interface SafeLink {
  href: string;
  external: boolean;
}

/** Entry point: sanitized DOM for one activity body. Never throws on hostile input. */
export function renderActivityMarkdown(html: string, doc: Document = document): DocumentFragment {
  const fragment = doc.createDocumentFragment();
  const source = typeof html === 'string' ? html : '';
  if (source.length > MAX_HTML_LENGTH) {
    fragment.appendChild(doc.createTextNode(source.slice(0, MAX_HTML_LENGTH)));
    return fragment;
  }
  const inert = doc.implementation.createHTMLDocument('');
  inert.body.innerHTML = source;
  appendChildren(inert.body, fragment, doc, 1);
  return fragment;
}

/**
 * Wires one delegated click + keydown listener to the container.
 * Returns a cleanup function; a second activation on the same container is a no-op.
 */
const activeContainers = new WeakSet<HTMLElement>();

export function activateMarkdownInteractions(container: HTMLElement): () => void {
  if (activeContainers.has(container)) return () => undefined;
  activeContainers.add(container);
  const onInteract = (event: Event): void => handleInteraction(container, event);
  container.addEventListener('click', onInteract);
  container.addEventListener('keydown', onInteract);
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    container.removeEventListener('click', onInteract);
    container.removeEventListener('keydown', onInteract);
    activeContainers.delete(container);
  };
}

function appendChildren(parent: Node, target: Node, doc: Document, depth: number): void {
  if (depth > MAX_DEPTH) return;
  for (const child of Array.from(parent.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      target.appendChild(doc.createTextNode(child.nodeValue ?? ''));
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      appendElement(child as Element, target, doc, depth);
    }
  }
}

function appendElement(source: Element, target: Node, doc: Document, depth: number): void {
  const tag = source.localName;
  if (DROPPED_TAGS.has(tag)) return;
  if (tag === 'div' && source.classList.contains('youtube')) {
    const card = buildYouTubeCard(source, doc);
    if (card) target.appendChild(card);
    return;
  }
  if (!ALLOWED_TAGS.has(tag)) {
    appendChildren(source, target, doc, depth + 1);
    return;
  }
  const element = buildElement(source, tag, doc);
  if (!element) return;
  appendChildren(source, element, doc, depth + 1);
  if (tag === 'video' && !element.querySelector('source')) return;
  target.appendChild(element);
}

function buildElement(source: Element, tag: string, doc: Document): HTMLElement | null {
  switch (tag) {
    case 'a': {
      const element = doc.createElement('a');
      const link = sanitizeHref(source.getAttribute('href'));
      if (link) {
        element.setAttribute('href', link.href);
        if (link.external) {
          element.setAttribute('target', '_blank');
          element.setAttribute('rel', 'noopener noreferrer nofollow');
        }
      }
      return element;
    }
    case 'img':
      return buildImage(source, doc);
    case 'source':
      return buildSource(source, doc);
    case 'video': {
      const element = doc.createElement('video');
      for (const name of ['muted', 'loop', 'playsinline']) {
        if (source.hasAttribute(name)) element.setAttribute(name, '');
      }
      element.setAttribute('controls', '');
      element.setAttribute('preload', 'metadata');
      return element;
    }
    case 'span': {
      const element = doc.createElement('span');
      if (source.classList.contains(SPOILER_CLASS)) element.className = SPOILER_CLASS;
      return element;
    }
    case 'code': {
      const element = doc.createElement('code');
      const className = source.getAttribute('class')?.trim() ?? '';
      if (LANGUAGE_CLASS.test(className)) element.className = className;
      return element;
    }
    default:
      return doc.createElement(tag);
  }
}

function buildImage(source: Element, doc: Document): HTMLElement | null {
  const src = sanitizeMediaUrl(source.getAttribute('src'));
  if (!src) return null;
  const image = doc.createElement('img');
  image.setAttribute('src', src);
  for (const name of ['width', 'height']) {
    const value = source.getAttribute(name)?.trim() ?? '';
    if (IMAGE_SIZE.test(value)) image.setAttribute(name, value);
  }
  const alt = source.getAttribute('alt');
  if (alt !== null && alt.length <= MAX_ALT_LENGTH) image.setAttribute('alt', alt);
  setMediaDefaults(image);
  image.setAttribute('decoding', 'async');
  return image;
}

function buildSource(source: Element, doc: Document): HTMLElement | null {
  const src = sanitizeMediaUrl(source.getAttribute('src'));
  if (!src) return null;
  const element = doc.createElement('source');
  element.setAttribute('src', src);
  const type = source.getAttribute('type')?.trim() ?? '';
  if (VIDEO_TYPE.test(type)) element.setAttribute('type', type);
  return element;
}

function buildYouTubeCard(source: Element, doc: Document): HTMLElement | null {
  const id = extractYouTubeId(source.getAttribute('id'));
  if (!id) return null;
  const card = doc.createElement('div');
  card.className = 'youtube au-youtube';
  card.dataset.videoId = id;
  card.setAttribute('role', 'button');
  card.setAttribute('tabindex', '0');
  card.setAttribute('aria-label', 'Play YouTube video');

  const thumb = doc.createElement('img');
  thumb.className = 'au-youtube-thumb';
  thumb.setAttribute('src', `https://i.ytimg.com/vi/${id}/hqdefault.jpg`);
  thumb.setAttribute('alt', 'YouTube video');
  setMediaDefaults(thumb);

  const play = doc.createElement('span');
  play.className = 'au-youtube-play';
  play.setAttribute('aria-hidden', 'true');

  card.append(thumb, play);
  return card;
}

function setMediaDefaults(element: HTMLElement): void {
  element.setAttribute('loading', 'lazy');
  element.setAttribute('referrerpolicy', 'no-referrer');
}

/** Relative paths stay on AniList; absolute http(s) links are kept and marked external. */
function sanitizeHref(raw: string | null): SafeLink | null {
  const value = raw?.trim() ?? '';
  if (!value) return null;
  if (value.startsWith('/')) {
    if (value.startsWith('//') || value.startsWith('/\\')) return null;
    const relative = parseWebUrl(value, ANILIST_ORIGIN);
    return relative?.origin === ANILIST_ORIGIN
      ? { href: toAnilistPath(relative), external: false }
      : null;
  }
  if (!HTTP_PREFIX.test(value)) return null;
  const url = parseWebUrl(value);
  if (!url || url.username || url.password) return null;
  if (url.origin === ANILIST_ORIGIN) return { href: toAnilistPath(url), external: false };
  return { href: url.href, external: true };
}

function toAnilistPath(url: URL): string {
  return `${url.pathname}${url.search}${url.hash}`;
}

/** Media (img/source) must be absolute https without credentials. */
function sanitizeMediaUrl(raw: string | null): string | null {
  const value = raw?.trim() ?? '';
  if (!value || value.length > MAX_SOURCE_URL_LENGTH || !HTTPS_PREFIX.test(value)) return null;
  const url = parseWebUrl(value);
  if (!url || url.protocol !== 'https:' || url.username || url.password) return null;
  return url.href;
}

/** Accepts a bare 11-char id, or a youtu.be / youtube.com watch, embed or shorts URL. */
function extractYouTubeId(raw: string | null): string | null {
  const value = raw?.trim() ?? '';
  if (YOUTUBE_ID.test(value)) return value;
  if (!value || value.length > MAX_SOURCE_URL_LENGTH) return null;
  const withScheme = SCHEME_PREFIX.test(value) ? value : `https://${value}`;
  const url = parseWebUrl(withScheme);
  if (!url || url.username || url.password || !YOUTUBE_HOSTS.has(url.hostname)) return null;
  const id = youTubeIdFromUrl(url);
  return id && YOUTUBE_ID.test(id) ? id : null;
}

function youTubeIdFromUrl(url: URL): string | null {
  if (url.hostname === 'youtu.be') return url.pathname.split('/')[1] ?? null;
  if (url.pathname === '/watch') return url.searchParams.get('v');
  return YOUTUBE_PATH.exec(url.pathname)?.[1] ?? null;
}

function handleInteraction(container: HTMLElement, event: Event): void {
  const target = event.target;
  if (!(target instanceof Element)) return;

  if (event.type === 'click') {
    const spoiler = target.closest<HTMLElement>(`.${SPOILER_CLASS}`);
    if (spoiler && container.contains(spoiler)) {
      toggleSpoiler(spoiler, event, target);
      return;
    }
  }

  const card = target.closest<HTMLElement>('.au-youtube[data-video-id]');
  if (!card || !container.contains(card)) return;
  if (event.type === 'keydown' && !ACTIVATION_KEYS.has((event as KeyboardEvent).key)) return;
  event.preventDefault();
  mountYouTube(card);
}

/** Hidden spoilers swallow the click; revealed spoilers let links inside keep working. */
function toggleSpoiler(spoiler: HTMLElement, event: Event, target: Element): void {
  if (!spoiler.classList.contains(REVEALED_CLASS)) {
    event.preventDefault();
    spoiler.classList.add(REVEALED_CLASS);
    return;
  }
  if (target.closest('a')) return;
  spoiler.classList.remove(REVEALED_CLASS);
}

function mountYouTube(card: HTMLElement): void {
  const id = card.dataset.videoId ?? '';
  if (!YOUTUBE_ID.test(id) || card.querySelector('iframe')) return;
  const iframe = card.ownerDocument.createElement('iframe');
  iframe.setAttribute('src', `https://www.youtube.com/embed/${id}?autoplay=1`);
  iframe.setAttribute('title', 'YouTube video');
  iframe.setAttribute('allow', 'autoplay; encrypted-media; picture-in-picture; fullscreen');
  iframe.setAttribute('allowfullscreen', '');
  iframe.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
  iframe.setAttribute('loading', 'lazy');
  card.replaceChildren(iframe);
  card.removeAttribute('role');
  card.removeAttribute('tabindex');
}
