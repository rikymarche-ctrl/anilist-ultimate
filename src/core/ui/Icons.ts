import '@fortawesome/fontawesome-free/js/fontawesome.min.js';
import { iconDefinitions } from './IconDefinitions';

// Load the current SVG renderer and only the inventoried canonical glyphs.
declare global {
  interface Window {
    FontAwesome: { library: { add(...definitions: unknown[]): void }; dom: { watch(): void } };
  }
}
// Font Awesome calls `window.requestAnimationFrame` detached from `window`. Firefox content
// scripts reject that ("does not implement interface Window"), so give this isolated world a
// bound copy; it keeps Font Awesome's async batching and is invisible to the page.
window.requestAnimationFrame = window.requestAnimationFrame.bind(window);
const api = window.FontAwesome;
api.library.add(...iconDefinitions);
api.dom.watch();
