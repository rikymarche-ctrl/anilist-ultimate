import '@fortawesome/fontawesome-free/js/fontawesome.min.js';
import { iconDefinitions } from './IconDefinitions';

// Load the current SVG renderer and only the inventoried canonical glyphs.
declare global { interface Window { FontAwesome: { library: { add(...definitions: unknown[]): void }; dom: { watch(): void } } } }
const api = window.FontAwesome;
api.library.add(...iconDefinitions);
api.dom.watch();
