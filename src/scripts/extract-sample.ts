import fs from 'node:fs';
import path from 'node:path';
import { extractPdfContent } from '../main/pdf-extractor';

async function main(): Promise<void> {
  const target = process.argv[2] || path.resolve(__dirname, '../../google_image.pdf');

  const content = await extractPdfContent(target);

  console.log(`Pages: ${content.textPages.length}`);
  console.log(`Total extraction time: ${content.totalExtractionTimeMs}ms`);

  const [firstImage] = content.images;
  if (firstImage) {
    const outPath = path.resolve(__dirname, `../../dist/page-${firstImage.pageNumber}.png`);
    const base64 = firstImage.dataUrl.split(',')[1];
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, Buffer.from(base64, 'base64'));
    console.log(`Wrote preview image to ${outPath}`);
  }
}

main().catch((error) => {
  console.error('Extraction failed:', error);
  process.exitCode = 1;
});
