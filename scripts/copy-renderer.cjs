const fs = require('node:fs');
const path = require('node:path');

const sourceDir = path.resolve(__dirname, '../src/renderer');
const destDir = path.resolve(__dirname, '../dist/renderer');

function copyRecursive(src, dest) {
  const stats = fs.statSync(src);
  if (stats.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      copyRecursive(path.join(src, entry), path.join(dest, entry));
    }
    return;
  }

  fs.copyFileSync(src, dest);
}

fs.rmSync(destDir, { recursive: true, force: true });
fs.mkdirSync(destDir, { recursive: true });
copyRecursive(sourceDir, destDir);
