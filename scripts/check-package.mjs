import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('dist');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const resources = [manifest.background?.service_worker, manifest.action?.default_popup, manifest.options_page,
  manifest.options_ui?.page, ...Object.values(manifest.icons ?? {}), ...Object.values(manifest.action?.default_icon ?? {}),
  ...(manifest.content_scripts ?? []).flatMap(script => [...(script.js ?? []), ...(script.css ?? [])])].filter(Boolean);
function requireFile(relative) {
  const file = path.resolve(root, relative.replace(/^\//, ''));
  if (!file.startsWith(root + path.sep) || !fs.statSync(file, { throwIfNoEntry: false })?.isFile()) throw new Error(`Missing packaged resource: ${relative}`);
}
for (const file of resources) requireFile(file);
for (const html of ['popup.html', 'settings.html']) {
  requireFile(html);
  const text = fs.readFileSync(path.join(root, html), 'utf8');
  if (/rel=["']modulepreload["']/.test(text)) throw new Error(`Unexpected extension modulepreload: ${html}`);
  for (const match of text.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
    if (!/^(?:https?:|data:|#)/.test(match[1])) requireFile(match[1].split(/[?#]/)[0]);
  }
}
for (const group of manifest.web_accessible_resources ?? []) {
  for (const resource of group.resources) if (!resource.includes('*')) requireFile(resource);
}
const removedContracts = /\b(?:legacyScore|manualOverride|VITE_ASTRA_CLAIM_LEGACY|claimLegacy|exportLegacy|au_best_friends|au_custom_user_lists|MEDIA_LIST_UPDATE|SYNC_QUEUE_PROCESS|fetchInitialData)\b/;
function auditRuntime(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) auditRuntime(file);
    else if (file.endsWith('.js') && removedContracts.test(fs.readFileSync(file, 'utf8'))) {
      throw new Error(`Removed contract found in packaged runtime: ${path.relative(root, file)}`);
    }
  }
}
auditRuntime(root);
console.log(`Packaging verified: ${resources.length} manifest resources; popup/settings without modulepreload.`);
