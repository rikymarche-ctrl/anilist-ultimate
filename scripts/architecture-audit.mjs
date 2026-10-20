import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root = process.cwd();
function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? files(full) : full.endsWith('.ts') ? [full] : [];
  });
}
const production = files(path.join(root, 'src')).filter(file => !/\.(test|spec)\.ts$/.test(file) && !file.includes(`${path.sep}test${path.sep}`));
const names = new Set(production);
const config = ts.readConfigFile('tsconfig.json', ts.sys.readFile);
const options = ts.parseJsonConfigFileContent(config.config, ts.sys, root).options;
const graph = new Map();
let anyCount = 0;
let lines = 0;
const largest = [];
for (const file of production) {
  const content = fs.readFileSync(file, 'utf8');
  const lineCount = content.split(/\r?\n/).length;
  lines += lineCount;
  largest.push({ file: path.relative(root, file).replaceAll('\\', '/'), lines: lineCount });
  const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true);
  const edges = new Set();
  function visit(node) {
    if (node.kind === ts.SyntaxKind.AnyKeyword) anyCount++;
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      // Type-only edges are excluded: this is a runtime-import graph, not DI resolution.
      if (ts.isImportDeclaration(node) && node.importClause?.isTypeOnly) return;
      if (ts.isExportDeclaration(node) && node.isTypeOnly) return;
      const bindings = ts.isImportDeclaration(node) ? node.importClause?.namedBindings : node.exportClause;
      if (bindings && (ts.isNamedImports(bindings) || ts.isNamedExports(bindings))
        && bindings.elements.length > 0 && bindings.elements.every(element => element.isTypeOnly)
        && (!ts.isImportDeclaration(node) || !node.importClause?.name)) return;
      const resolved = ts.resolveModuleName(node.moduleSpecifier.text, file, options, ts.sys).resolvedModule?.resolvedFileName;
      if (resolved && names.has(path.normalize(resolved))) edges.add(path.normalize(resolved));
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  graph.set(file, edges);
}
const indices = new Map(), low = new Map(), stack = [], onStack = new Set(), cycles = [];
let sequence = 0;
function connect(file) {
  indices.set(file, sequence); low.set(file, sequence++); stack.push(file); onStack.add(file);
  for (const target of graph.get(file)) {
    if (!indices.has(target)) { connect(target); low.set(file, Math.min(low.get(file), low.get(target))); }
    else if (onStack.has(target)) low.set(file, Math.min(low.get(file), indices.get(target)));
  }
  if (low.get(file) === indices.get(file)) {
    const component = [];
    let entry;
    do { entry = stack.pop(); onStack.delete(entry); component.push(path.relative(root, entry).replaceAll('\\', '/')); } while (entry !== file);
    if (component.length > 1) cycles.push(component.sort());
  }
}
for (const file of production) if (!indices.has(file)) connect(file);
const result = { date: new Date().toISOString(), productionFiles: production.length, lines, explicitAny: anyCount,
  runtimeImportCycles: cycles, largest: largest.sort((a, b) => b.lines - a.lines).slice(0, 10) };
fs.mkdirSync('.cache', { recursive: true });
fs.writeFileSync('.cache/architecture-audit.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
