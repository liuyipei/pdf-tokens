const fs = require('node:fs');
const path = require('node:path');

const sourceDir = path.resolve(__dirname, '../src/renderer');
const destDir = path.resolve(__dirname, '../dist/renderer');

const STATIC_EXTENSIONS = new Set(['.html', '.css']);

function copyStaticAssets(src, dest) {
  const stats = fs.statSync(src);
  if (stats.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      copyStaticAssets(path.join(src, entry), path.join(dest, entry));
    }
    return;
  }

  if (!STATIC_EXTENSIONS.has(path.extname(src))) {
    return;
  }

  fs.copyFileSync(src, dest);
}

fs.mkdirSync(destDir, { recursive: true });
copyStaticAssets(sourceDir, destDir);
