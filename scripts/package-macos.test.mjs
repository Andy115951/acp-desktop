import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { inspectBundle, validateVersions, validateLibraries } from './package-macos.mjs';

const version = '0.1.0-beta.1';
const pkg = { version };
const lock = { version, packages: { '': { version } } };
const config = { version, bundle: { resources: [], externalBin: [] } };
const cargo = `[package]\nversion = "${version}"`;

const cargoLock = `version = 4\n[[package]]\nname = "unrelated"\nversion = "1.0.0"\n[[package]]\nname = "acp-desktop"\nversion = "${version}"\n`;

test('release versions, tags and sidecars must be consistent', () => {
  assert.equal(validateVersions(pkg, lock, config, cargo, cargoLock, `v${version}`), version);
  assert.throws(() => validateVersions(pkg, lock, config, cargo, cargoLock, 'v0.2.0'));
  assert.throws(() => validateVersions(pkg, lock, { ...config, version: '0.2.0' }, cargo, cargoLock));
  assert.throws(() => validateVersions(pkg, { ...lock, packages: {} }, config, cargo, cargoLock));
  assert.throws(() => validateVersions(pkg, lock, { ...config, bundle: { externalBin: ['vendor'] } }, cargo, cargoLock));
});

test('bundle audit rejects unexpected credentials, binaries, symlinks and missing signature files', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'acp-bundle-audit-'));
  try {
    const expected = ['Contents/Info.plist', 'Contents/MacOS/acp-desktop', 'Contents/Resources/icon.icns', 'Contents/_CodeSignature/CodeResources'];
    for (const file of expected) { await mkdir(path.dirname(path.join(dir, file)), { recursive: true }); await writeFile(path.join(dir, file), 'fixture'); }
    assert.equal((await inspectBundle(dir)).length, 4);
    for (const file of ['Contents/Resources/.env', 'Contents/MacOS/fake-acp-agent', 'Contents/Resources/prefs.json']) {
      await writeFile(path.join(dir, file), 'must not ship');
      await assert.rejects(inspectBundle(dir), /Unexpected bundle content/);
      await rm(path.join(dir, file));
    }
    await symlink('/tmp', path.join(dir, 'Contents/Resources/link'));
    await assert.rejects(inspectBundle(dir), /Unexpected bundle symlink/);
    await rm(path.join(dir, 'Contents/Resources/link'));
    await rm(path.join(dir, 'Contents/_CodeSignature/CodeResources'));
    await assert.rejects(inspectBundle(dir), /Missing bundle file/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('binary must not rely on developer-local dynamic libraries', () => {
  validateLibraries('binary:\n /System/Library/Frameworks/WebKit.framework/Versions/A/WebKit (compatibility version 1)\n /usr/lib/libSystem.B.dylib (compatibility version 1)');
  for (const library of ['/opt/homebrew/lib/private.dylib', '@rpath/vendor.dylib']) {
    assert.throws(() => validateLibraries(`binary:\n ${library} (compatibility version 1)`));
  }
});

test('release audit rejects stale, missing or ambiguous Rust lockfile versions', () => {
  for (const invalid of [
    cargoLock.replace(`version = "${version}"`, 'version = "0.1.0"'),
    cargoLock.replace('name = "acp-desktop"', 'name = "other-app"'),
    cargoLock + `\n[[package]]\nname = "acp-desktop"\nversion = "${version}"\n`,
  ]) {
    assert.throws(() => validateVersions(pkg, lock, config, cargo, invalid), /Cargo.lock/);
  }
});
