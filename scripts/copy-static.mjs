import { cpSync, existsSync, mkdirSync } from 'fs';
import { dirname, resolve } from 'path';

const sources = [
  ['src/renderer/index.html', 'dist/renderer/index.html'],
  ['src/renderer/styles.css', 'dist/renderer/styles.css']
];

for (const [src, dest] of sources) {
  const resolvedSrc = resolve(src);
  const resolvedDest = resolve(dest);
  const folder = dirname(resolvedDest);
  if (!existsSync(resolvedSrc)) continue;
  if (!existsSync(folder)) {
    mkdirSync(folder, { recursive: true });
  }
  cpSync(resolvedSrc, resolvedDest);
}
