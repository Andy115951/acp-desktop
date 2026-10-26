import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, readdir, lstat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const allowedFiles = new Set([
  'Contents/Info.plist',
  'Contents/MacOS/acp-desktop',
  'Contents/Resources/icon.icns',
  'Contents/_CodeSignature/CodeResources',
]);

export async function inspectBundle(app) {
  const files = [];
  async function walk(directory, prefix = '') {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const full = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Unexpected bundle symlink: ${relative}`);
      if (entry.isDirectory()) await walk(full, relative);
      else if (entry.isFile() && allowedFiles.has(relative)) files.push(relative);
      else throw new Error(`Unexpected bundle content: ${relative}`);
    }
  }
  await walk(app);
  for (const required of allowedFiles) {
    if (!files.includes(required)) throw new Error(`Missing bundle file: ${required}`);
  }
  return files.sort();
}

export function validateVersions(pkg, lock, config, cargo, cargoLock, tag) {
  const version = pkg.version;
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error('Invalid application version');
  const cargoVersion = cargo.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
  if ([lock.version, lock.packages?.['']?.version, config.version, cargoVersion].some((value) => value !== version)) {
    throw new Error('package.json, package-lock.json, Cargo.toml and Tauri versions must agree');
  }
  const lockedApp = cargoLock.split(/^\[\[package\]\]\s*$/m)
    .filter((block) => /^name\s*=\s*"acp-desktop"\s*$/m.test(block));
  if (lockedApp.length !== 1 || lockedApp[0].match(/^version\s*=\s*"([^"]+)"/m)?.[1] !== version) {
    throw new Error('Cargo.lock must contain the matching acp-desktop version');
  }
  if (tag && tag !== `v${version}`) throw new Error('Tag must match the application version');
  if (config.bundle.resources?.length || config.bundle.externalBin?.length) throw new Error('Bundled resources/sidecars require a new release audit');
  return version;
}

export function validateLibraries(output) {
  for (const line of output.trim().split('\n').slice(1)) {
    const library = line.trim().split(' (')[0];
    if (!library.startsWith('/System/Library/') && !library.startsWith('/usr/lib/')) {
      throw new Error('Application links a non-system library; audit the release bundle');
    }
  }
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const run = (command, args) => execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

async function main() {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('This artifact pipeline requires native macOS arm64');
  // A fixed checkout and committed locks identify what is actually being packaged.
  run('git', ['diff', '--quiet', 'HEAD']);
  if (run('git', ['ls-files', '--others', '--exclude-standard'])) throw new Error('Commit or remove untracked source files before packaging');
  const commit = run('git', ['rev-parse', 'HEAD']);
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error('Invalid Git commit');
  const pkg = JSON.parse(await readFile('package.json', 'utf8'));
  const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
  const config = JSON.parse(await readFile('src-tauri/tauri.conf.json', 'utf8'));
  const cargo = await readFile('src-tauri/Cargo.toml', 'utf8');
  const cargoLock = await readFile('Cargo.lock', 'utf8');
  const version = validateVersions(pkg, lock, config, cargo, cargoLock,
    process.env.GITHUB_REF_TYPE === 'tag' ? process.env.GITHUB_REF_NAME : undefined);
  const app = path.resolve('target/aarch64-apple-darwin/release/bundle/macos/ACP Desktop.app');
  const files = await inspectBundle(app);
  const plist = (key) => run('/usr/libexec/PlistBuddy', ['-c', `Print ${key}`, path.join(app, 'Contents/Info.plist')]);
  if (plist('CFBundleShortVersionString') !== version || plist('CFBundleIdentifier') !== config.identifier) throw new Error('Bundle identity/version does not match source');
  const executable = path.join(app, 'Contents/MacOS/acp-desktop');
  if (run('/usr/bin/lipo', ['-archs', executable]) !== 'arm64') throw new Error('Unexpected binary architecture');
  validateLibraries(run('/usr/bin/otool', ['-L', executable]));
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
  // codesign writes its informational output to stderr even on success.
  const { spawnSync } = await import('node:child_process');
  const signature = spawnSync('/usr/bin/codesign', ['-dv', '--verbose=4', app], { encoding: 'utf8' });
  if (signature.status !== 0 || !signature.stderr.includes('Signature=adhoc')) throw new Error('Expected ad-hoc signature; update release trust metadata before changing signing');
  const directory = path.resolve('release-artifacts');
  await mkdir(directory, { recursive: true });
  if ((await readdir(directory)).length) throw new Error('Use an empty release-artifacts directory');
  const stem = `acp-desktop-${version}-macos-arm64-${commit.slice(0, 12)}`;
  const zip = `${stem}.app.zip`;
  run('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', app, path.join(directory, zip)]);
  const archiveHash = sha256(await readFile(path.join(directory, zip)));
  const manifest = {
    schemaVersion: 1, product: config.productName, version, commit,
    target: 'aarch64-apple-darwin', architecture: 'arm64',
    signing: 'ad-hoc', notarized: false, nativeInstallVerified: false,
    configuredMinimumMacOS: config.bundle.macOS.minimumSystemVersion,
    build: { macOS: run('/usr/bin/sw_vers', ['-productVersion']), node: process.version,
      rust: run('rustc', ['--version']), npm: run('npm', ['--version']),
      tauriCli: lock.packages['node_modules/@tauri-apps/cli'].version },
    lockfiles: { 'Cargo.lock': sha256(await readFile('Cargo.lock')), 'package-lock.json': sha256(await readFile('package-lock.json')) },
    archive: { name: zip, sha256: archiveHash, bytes: (await lstat(path.join(directory, zip))).size },
    files: await Promise.all(files.map(async (name) => ({ name, sha256: sha256(await readFile(path.join(app, name))) }))),
  };
  const metadata = `${stem}.json`;
  const metadataBytes = `${JSON.stringify(manifest, null, 2)}\n`;
  await writeFile(path.join(directory, metadata), metadataBytes);
  await writeFile(path.join(directory, 'SHA256SUMS'), `${archiveHash}  ${zip}\n${sha256(metadataBytes)}  ${metadata}\n`);
  console.log(`Validated ${files.length} bundle files. Prepared ${zip} (ad-hoc signed; not notarized or install-verified).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
