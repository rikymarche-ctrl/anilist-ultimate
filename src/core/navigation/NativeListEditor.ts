/** Narrow bridge from extension controls to AniList's own list editor. */
const OPEN_NATIVE_LIST_EDITOR = 'au:open-native-list-editor';

function isMediaId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= 2147483647;
}

export function openNativeListEditor(mediaId: number): void {
  if (!isMediaId(mediaId)) throw new Error('Invalid AniList media ID');
  const request = new CustomEvent(OPEN_NATIVE_LIST_EDITOR, { detail: mediaId, cancelable: true });
  if (document.dispatchEvent(request)) {
    throw new Error('AniList editor is unavailable. Reload the page and try again.');
  }
}

/** Installed in MAIN world: Vue's store is unavailable to isolated content scripts. */
export function installNativeListEditorBridge(): () => void {
  const onOpen = (event: Event) => {
    const mediaId: unknown = (event as CustomEvent<unknown>).detail;
    if (!isMediaId(mediaId)) return;
    const app = document.getElementById('app') as (HTMLElement & {
      __vue__?: { $store?: { dispatch(action: string, id: number): Promise<unknown> } };
    }) | null;
    const store = app?.__vue__?.$store;
    if (typeof store?.dispatch !== 'function') return;
    try {
      // This opens AniList's dialog; editing and saving remain in AniList's UI.
      void Promise.resolve(store.dispatch('medialistEditor/open', mediaId)).catch(() => {});
      event.preventDefault();
    } catch {
      // Keep the request unacknowledged so the caller can report the failure.
    }
  };
  document.addEventListener(OPEN_NATIVE_LIST_EDITOR, onOpen);
  return () => document.removeEventListener(OPEN_NATIVE_LIST_EDITOR, onOpen);
}
