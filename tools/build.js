// Copies the static game into dist/ (the Capacitor webDir). No bundler required.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });
for (const f of ['index.html', 'styles.css', 'manifest.webmanifest', 'icon.svg']) fs.copyFileSync(path.join(root, f), path.join(dist, f));
fs.cpSync(path.join(root, 'src'), path.join(dist, 'src'), { recursive: true });
console.log(`Built to ${dist}`);
