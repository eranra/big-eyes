// Builds the small native macOS helper (idle-helper) into build/native/idle-helper, as a universal binary.
// Needs the Xcode Command Line Tools (swiftc). On other systems, or without swiftc, it does nothing:
// the app then uses the combined system idle counter.
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'build/native');
if (process.platform !== 'darwin') process.exit(0);

const source = join(root, 'native/macos/idle-helper.swift');
mkdirSync(out, { recursive: true });
const parts = [];
try {
  for (const arch of ['arm64', 'x86_64']) {
    const file = join(out, `idle-helper-${arch}`);
    execFileSync('swiftc', ['-O', '-target', `${arch}-apple-macos13`, source, '-o', file], { stdio: 'inherit' });
    parts.push(file);
  }
  execFileSync('lipo', ['-create', ...parts, '-output', join(out, 'idle-helper')], { stdio: 'inherit' });
  for (const p of parts) rmSync(p);
  console.log('Built build/native/idle-helper');
} catch (error) {
  console.warn('Could not build the macOS idle helper (needs swiftc). The app will use the combined idle counter.');
  console.warn(String(error));
}
