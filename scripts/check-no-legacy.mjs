import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// Keep negative regression fixtures and historical documentation out of the
// runtime audit: they deliberately name formats and commands that must fail.
const removed = /\blegacy\w*|@deprecated|\b(?:manualOverride|VITE_ASTRA_CLAIM_LEGACY|claimLegacy|exportLegacy|au_best_friends|au_custom_user_lists|MEDIA_LIST_UPDATE|SYNC_QUEUE_PROCESS|fetchInitialData|hydrateCustomListsFromStoredWorks|watchPageNavigation|_skipPersist|GlobalEvents)\b|v4-shims|\/oauth\/pin|export const (?:log|storage|syncStorage|localStorage)\b/;
const violations = [];
let checked = 0;
function audit(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'test') audit(file);
    } else if (/\.(?:ts|tsx|css|html)$/.test(file) && !/\.(?:test|spec)\.tsx?$/.test(file)) {
      checked++;
      readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, index) => {
        if (removed.test(line)) violations.push(`${file}:${index + 1}`);
      });
    }
  }
}
audit('src');
audit('public');
if (violations.length) throw new Error(`Removed runtime contracts found:\n${violations.join('\n')}`);
console.log(`Runtime audit: ${checked} source/style/resource files; no removed contracts found.`);
