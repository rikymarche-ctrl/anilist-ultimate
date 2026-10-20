/**
 * Keeps a stable Load More control available while AniList replaces its native
 * button during lazy loading and periodic feed refreshes.
 */
const CONTROL_CLASS = 'au-persistent-load-more';
const NATIVE_SELECTOR = '.load-more, .load-more-button, button[class*="load-more"]';
const HIDDEN_ATTRIBUTE = 'data-au-load-more-hidden';
const originalDisplays = new WeakMap<HTMLElement, { value: string; priority: string }>();

export function ensurePersistentLoadMore(feed: Element): void {
  const host = feed.closest<HTMLElement>('.activity-feed-wrap, .feed-container') || feed.parentElement;
  if (!host) return;

  const nativeControls = Array.from(host.querySelectorAll<HTMLElement>(NATIVE_SELECTOR)).filter(
    (control) => !control.classList.contains(CONTROL_CLASS)
  );

  // The native control is recreated inconsistently by AniList. Keep it in the
  // DOM for its click handler, but expose one stable extension-owned control.
  nativeControls.forEach((control) => {
    if (!originalDisplays.has(control)) {
      originalDisplays.set(control, { value: control.style.getPropertyValue('display'), priority: control.style.getPropertyPriority('display') });
      control.setAttribute(HIDDEN_ATTRIBUTE, '');
    }
    control.style.display = 'none';
  });

  let control = host.querySelector<HTMLButtonElement>(`.${CONTROL_CLASS}`);
  if (!control) {
    control = document.createElement('button');
    control.type = 'button';
    control.className = CONTROL_CLASS;
    control.textContent = 'Load More';
    control.addEventListener('click', () => {
      const native = Array.from(host.querySelectorAll<HTMLElement>(NATIVE_SELECTOR)).find(
        (element) => !element.classList.contains(CONTROL_CLASS)
      );

      if (native) {
        // Keep AniList's load handler, but suppress any native anchor/default
        // action that can jump the viewport during a soft-refreshed feed.
        native.addEventListener('click', (event) => event.preventDefault(), {
          capture: true,
          once: true,
        });
        native.dispatchEvent(new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          view: window,
        }));
        return;
      }

      // When AniList has removed its visual control, notify its infinite-scroll
      // listener at the current position without changing the viewport.
      window.dispatchEvent(new Event('scroll'));
    });
    // Mount inside the activity feed, not its grid wrapper. The social-page
    // wrapper stretches direct children to the column height.
    feed.appendChild(control);
  }
}

export function removePersistentLoadMore(scope: ParentNode = document): void {
  scope.querySelectorAll(`.${CONTROL_CLASS}`).forEach((control) => control.remove());
  scope.querySelectorAll<HTMLElement>(`[${HIDDEN_ATTRIBUTE}]`).forEach(control => {
    const original = originalDisplays.get(control);
    if (original) {
      if (original.value) control.style.setProperty('display', original.value, original.priority);
      else control.style.removeProperty('display');
      originalDisplays.delete(control);
    }
    control.removeAttribute(HIDDEN_ATTRIBUTE);
  });
}
