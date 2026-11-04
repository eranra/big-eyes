// Builds the app into ./build with esbuild.
//   build/main/main.js         Electron main process
//   build/preload/preload.js   preload script (sandboxed, CommonJS)
//   build/renderer/*           pages, scripts, MediaPipe wasm files and the face model
import { build } from 'esbuild';
import { cp, mkdir, rm, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'build');
const production = process.env.NODE_ENV === 'production';

await rm(out, { recursive: true, force: true });

const common = { bundle: true, sourcemap: !production, minify: production, logLevel: 'warning' };

await Promise.all([
  build({
    ...common,
    entryPoints: [join(root, 'src/main/main.ts')],
    outfile: join(out, 'main/main.js'),
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    external: ['electron'],
  }),
  build({
    ...common,
    entryPoints: [join(root, 'src/preload/preload.ts')],
    outfile: join(out, 'preload/preload.js'),
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    external: ['electron'],
  }),
  build({
    ...common,
    entryPoints: ['overlay', 'settings', 'snapshot', 'about', 'blur'].map((n) => join(root, `src/renderer/${n}.ts`)),
    outdir: join(out, 'renderer'),
    platform: 'browser',
    format: 'iife',
    target: 'chrome130',
  }),
]);

const renderer = join(out, 'renderer');
for (const file of ['overlay.html', 'settings.html', 'settings.css', 'snapshot.html', 'about.html', 'blur.html']) {
  await cp(join(root, 'src/renderer', file), join(renderer, file));
}
await cp(join(root, 'node_modules/@mediapipe/tasks-vision/wasm'), join(renderer, 'wasm'), { recursive: true });

const model = join(root, 'assets/models/face_landmarker.task');
try {
  await access(model);
} catch {
  console.error('Missing face model. Run: npm run fetch-model');
  process.exit(1);
}
await mkdir(join(renderer, 'models'), { recursive: true });
await cp(model, join(renderer, 'models/face_landmarker.task'));
console.log('Built into ./build');
