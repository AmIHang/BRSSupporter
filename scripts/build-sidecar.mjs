// Builds the runtime the Tauri app ships (as in BRSOrganizer):
//   src-tauri/binaries/brssupporter-node-<triple>.exe   Node.js (externalBin, next to the app exe)
//   src-tauri/resources/runtime/daemon.mjs              bundled daemon
//   src-tauri/resources/runtime/drizzle/                SQL migrations
//   src-tauri/resources/runtime/node_modules/           native modules, playwright-core
//
// Native modules are compiled for the Node ABI of the node.exe running this script,
// which is also the node.exe that gets shipped, so they always match.
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tauriDir = join(root, 'packages', 'app', 'src-tauri');
const out = join(tauriDir, 'resources', 'runtime');
const TRIPLE = 'x86_64-pc-windows-msvc';

if (process.platform !== 'win32' || process.arch !== 'x64') {
  throw new Error('The sidecar runtime is built on Windows x64 only.');
}

try {
  rmSync(out, { recursive: true, force: true });
} catch (e) {
  throw new Error(
    `cannot clean ${out} (${e.code}): a daemon started from this runtime is probably still ` +
      'running and locks better_sqlite3.node. Stop brssupporter-node.exe and retry.',
  );
}
mkdirSync(out, { recursive: true });

await build({
  entryPoints: { daemon: join(root, 'packages', 'daemon', 'src', 'main.ts') },
  outdir: out,
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  // playwright-core (BSM/OTMA via Edge) loads its own files at runtime: shipped as is.
  external: ['better-sqlite3', '@napi-rs/keyring', 'playwright-core'],
  alias: { '@brssupporter/core': join(root, 'packages', 'core', 'src', 'index.ts') },
  // CommonJS dependencies (express, ...) call require().
  banner: {
    js: "import { createRequire as __brsCreateRequire } from 'node:module'; const require = __brsCreateRequire(import.meta.url);",
  },
  legalComments: 'none',
  logLevel: 'info',
});

/** Copies selected parts of an installed package into runtime/node_modules. */
function copyPackage(name, fromDir, parts) {
  const require = createRequire(join(fromDir, 'package.json'));
  const pkgDir = dirname(require.resolve(`${name}/package.json`));
  const target = join(out, 'node_modules', ...name.split('/'));
  mkdirSync(target, { recursive: true });
  for (const part of parts) {
    const src = join(pkgDir, part);
    if (!existsSync(src)) throw new Error(`${name}: missing ${part}`);
    cpSync(src, join(target, part), { recursive: true });
  }
  return pkgDir;
}

const coreDir = join(root, 'packages', 'core');
const sqliteDir = copyPackage('better-sqlite3', coreDir, [
  'package.json',
  'lib',
  'build/Release/better_sqlite3.node',
]);
const bindingsDir = copyPackage('bindings', sqliteDir, ['package.json', 'bindings.js']);
copyPackage('file-uri-to-path', bindingsDir, ['package.json', 'index.js']);

const keyringDir = copyPackage('@napi-rs/keyring', coreDir, ['package.json', 'index.js']);
const keyringNative = '@napi-rs/keyring-win32-x64-msvc';
const nativeRequire = createRequire(join(keyringDir, 'package.json'));
const nativeDir = dirname(nativeRequire.resolve(`${keyringNative}/package.json`));
cpSync(nativeDir, join(out, 'node_modules', '@napi-rs', 'keyring-win32-x64-msvc'), {
  recursive: true,
});

// playwright-core has no dependencies; it drives the installed Edge (no browser download).
copyPackage('playwright-core', join(root, 'packages', 'daemon'), [
  'package.json',
  'index.js',
  'index.mjs',
  'browsers.json',
  'lib',
  'LICENSE',
  'NOTICE',
  'ThirdPartyNotices.txt',
]);

cpSync(join(coreDir, 'drizzle'), join(out, 'drizzle'), { recursive: true });

const binDir = join(tauriDir, 'binaries');
mkdirSync(binDir, { recursive: true });
cpSync(process.execPath, join(binDir, `brssupporter-node-${TRIPLE}.exe`));

console.log(`sidecar runtime ready (Node ${process.version}) in ${out}`);
