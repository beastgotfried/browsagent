/**
 * sample.ts — read the sample of the project for the context pass.
 *
 * The context pass must not read the whole repository. This file collects the
 * tree, the manifests, the config files, the entry points, the route files,
 * and the API calls. Every part has a hard cap. The pass never reads a file
 * over 200 KB and never follows a symbolic link.
 */
import type { Dirent } from 'node:fs';
import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

/** These directories hold build data or tool data. The sample skips them. */
const SKIP_DIRS = new Set(['node_modules', 'dist', '.output', '.git', '.wxt', '.browsagent']);

/** The largest file the sample reads. A larger file is build data. */
const MAX_FILE_BYTES = 200 * 1024;

const TREE_DEPTH = 3;
const TREE_MAX_LINES = 400;
const PACKAGE_MAX_LINES = 120;
const CONFIG_MAX_LINES = 80;
const ENTRY_MAX_LINES = 150;
const ROUTE_FILE_LIMIT = 10;
const ROUTE_MAX_LINES = 80;
const API_MAX_LINES = 100;
const API_LINE_MAX_CHARS = 300;

/** The source files of the API search. */
const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte'];

/** One file or directory below the root. */
interface WalkEntry {
  /** The path relative to the root. */
  path: string;
  /** The last part of the path. */
  name: string;
  /** The depth below the root. A file in the root has depth 1. */
  depth: number;
  directory: boolean;
}

/** One file name with text, ready for the sample. */
interface SampleFile {
  path: string;
  text: string;
}

/** One line of the API search. */
interface ApiCall {
  path: string;
  line: number;
  text: string;
}

function byPath(a: { path: string }, b: { path: string }): number {
  if (a.path < b.path) return -1;
  if (a.path > b.path) return 1;
  return 0;
}

/**
 * Walk the tree. Return every file and directory below the root.
 *
 * The walk skips a symbolic link. A link can point out of the root, and the
 * sample must stay inside the project.
 */
async function walk(root: string): Promise<WalkEntry[]> {
  const entries: WalkEntry[] = [];

  async function visit(dir: string, dirDepth: number): Promise<void> {
    let found: Dirent[];
    try {
      found = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of found) {
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        entries.push({
          path: relative(root, join(dir, entry.name)),
          name: entry.name,
          depth: dirDepth + 1,
          directory: true,
        });
        await visit(join(dir, entry.name), dirDepth + 1);
        continue;
      }
      if (entry.isFile()) {
        entries.push({
          path: relative(root, join(dir, entry.name)),
          name: entry.name,
          depth: dirDepth + 1,
          directory: false,
        });
      }
    }
  }

  await visit(root, 0);
  return entries;
}

/** Keep the first lines of a text. Name the number of the left lines. */
function capLines(text: string, cap: number): string {
  const clean = text.endsWith('\n') ? text.slice(0, -1) : text;
  const lines = clean.split('\n');
  if (lines.length <= cap) return clean;
  return [...lines.slice(0, cap), `... (${lines.length - cap} more lines)`].join('\n');
}

/** Read one small file. Return null for a large file and for a bad file. */
async function readSmall(path: string): Promise<string | null> {
  try {
    const info = await stat(path);
    if (!info.isFile() || info.size > MAX_FILE_BYTES) return null;
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
}

/** Read the named files. Cap the lines of each file. */
async function readFiles(root: string, entries: WalkEntry[], cap: number): Promise<SampleFile[]> {
  const files: SampleFile[] = [];
  for (const entry of entries) {
    const text = await readSmall(join(root, entry.path));
    if (text === null) continue;
    files.push({ path: entry.path, text: capLines(text, cap) });
  }
  return files;
}

function isConfigName(name: string): boolean {
  if (name === 'tsconfig.json') return true;
  return (
    name.startsWith('vite.config.') ||
    name.startsWith('next.config.') ||
    name.startsWith('tailwind.config.') ||
    name.startsWith('postcss.config.')
  );
}

function isEntryPoint(entry: WalkEntry): boolean {
  const parts = entry.path.split(sep);
  const parent = parts[parts.length - 2];
  if (parent === 'src') return entry.name.startsWith('main.') || entry.name.startsWith('App.');
  if (parent === 'app') return entry.name.startsWith('page.');
  if (parent === 'pages') return entry.name.startsWith('index.');
  return false;
}

function isRouteFile(entry: WalkEntry): boolean {
  const parts = entry.path.split(sep);
  for (const part of parts.slice(0, -1)) {
    if (part === 'routes' || part === 'app' || part === 'pages') return true;
  }
  return false;
}

/** Find every line that calls an API. Search packages/ and examples/ only. */
async function findApiCalls(root: string, entries: WalkEntry[]): Promise<ApiCall[]> {
  const calls: ApiCall[] = [];
  for (const entry of entries) {
    if (entry.directory) continue;
    const top = entry.path.split(sep)[0];
    if (top !== 'packages' && top !== 'examples') continue;
    if (!SOURCE_EXTENSIONS.some((extension) => entry.name.endsWith(extension))) continue;
    const text = await readSmall(join(root, entry.path));
    if (text === null) continue;
    text.split('\n').forEach((line, index) => {
      if (/fetch\(|axios|\/api\//.test(line)) {
        calls.push({ path: entry.path, line: index + 1, text: line.trim() });
      }
    });
  }
  calls.sort((a, b) => (a.path === b.path ? a.line - b.line : byPath(a, b)));
  return calls.slice(0, API_MAX_LINES);
}

function section(title: string, body: string[]): string {
  return `## ${title}\n${body.length === 0 ? '(none)' : body.join('\n')}`;
}

function fileLines(files: SampleFile[]): string[] {
  const lines: string[] = [];
  for (const file of files) {
    lines.push(`--- ${file.path} ---`);
    lines.push(file.text);
  }
  return lines;
}

function callLines(calls: ApiCall[]): string[] {
  return calls.map((call) => {
    const text =
      call.text.length > API_LINE_MAX_CHARS
        ? `${call.text.slice(0, API_LINE_MAX_CHARS)}...`
        : call.text;
    return `${call.path}:${call.line}: ${text}`;
  });
}

/**
 * Read the sample of the project. Return one text with six parts.
 *
 * The context pass sends this text to the model. The caps keep the input
 * small. The caller checks the size against the token budget.
 */
export async function readSample(root: string): Promise<string> {
  const realRoot = await realpath(root);
  const entries = await walk(realRoot);

  const tree = entries
    .filter((entry) => entry.depth <= TREE_DEPTH)
    .sort(byPath)
    .map((entry) => (entry.directory ? `${entry.path}/` : entry.path));

  const manifests = await readFiles(
    realRoot,
    entries.filter((entry) => !entry.directory && entry.name === 'package.json').sort(byPath),
    PACKAGE_MAX_LINES,
  );
  const configs = await readFiles(
    realRoot,
    entries.filter((entry) => !entry.directory && isConfigName(entry.name)).sort(byPath),
    CONFIG_MAX_LINES,
  );
  const entryPoints = await readFiles(
    realRoot,
    entries.filter((entry) => !entry.directory && isEntryPoint(entry)).sort(byPath),
    ENTRY_MAX_LINES,
  );
  const routes = await readFiles(
    realRoot,
    entries.filter((entry) => !entry.directory && isRouteFile(entry)).sort(byPath).slice(0, ROUTE_FILE_LIMIT),
    ROUTE_MAX_LINES,
  );
  const calls = await findApiCalls(realRoot, entries);

  const treeLines = tree.length === 0 ? [] : capLines(tree.join('\n'), TREE_MAX_LINES).split('\n');

  return [
    section('1 THE FILE TREE, DEPTH 3', treeLines),
    section('2 EVERY package.json', fileLines(manifests)),
    section('3 THE CONFIG FILES', fileLines(configs)),
    section('4 THE ENTRY POINTS', fileLines(entryPoints)),
    section('5 THE ROUTE FILES', fileLines(routes)),
    section('6 THE API CALLS', callLines(calls)),
  ].join('\n\n');
}
