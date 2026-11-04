// Downloads the MediaPipe Face Landmarker model (Apache-2.0, by Google) into assets/models.
// The file is about 3.7 MB. We check its SHA-256 so a changed or broken download is detected.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const URL_ =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const SHA256 = '64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff';
const target = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets/models/face_landmarker.task');

const sha = (data) => createHash('sha256').update(data).digest('hex');

try {
  if (sha(await readFile(target)) === SHA256) {
    console.log('Face model already present.');
    process.exit(0);
  }
} catch {
  // Not downloaded yet.
}

console.log(`Downloading ${URL_}`);
const response = await fetch(URL_);
if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}`);
const data = Buffer.from(await response.arrayBuffer());
if (sha(data) !== SHA256) throw new Error('Downloaded model has an unexpected SHA-256. Not saving it.');
await mkdir(dirname(target), { recursive: true });
await writeFile(target, data);
console.log(`Saved ${target} (${(data.length / 1e6).toFixed(1)} MB)`);
