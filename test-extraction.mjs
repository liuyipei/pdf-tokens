/**
 * Test script to debug PDF image extraction
 * Run with: node test-extraction.mjs
 */
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import fs from 'node:fs';

// Set up polyfills BEFORE importing pdfjs
import { createCanvas, Image, DOMMatrix, ImageData, Path2D } from '@napi-rs/canvas';

// Polyfill browser globals that pdf.js expects
console.log('Setting up globalThis polyfills...');
globalThis.Image = Image;
globalThis.DOMMatrix = DOMMatrix;
globalThis.ImageData = ImageData;
globalThis.Path2D = Path2D;
console.log('Polyfills set up:', {
  Image: typeof globalThis.Image,
  DOMMatrix: typeof globalThis.DOMMatrix,
  ImageData: typeof globalThis.ImageData,
  Path2D: typeof globalThis.Path2D,
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Configure pdfjs worker path
const workerPath = path.join(__dirname, 'node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs');
const standardFontPath = path.join(__dirname, 'node_modules/pdfjs-dist/standard_fonts/');

// Test file
const testPdfPath = path.join(__dirname, 'google_image.pdf');
console.log('Test PDF path:', testPdfPath);
console.log('File exists:', fs.existsSync(testPdfPath));

async function renderPageImage(doc, pageNumber) {
  console.log(`\nRendering page ${pageNumber}...`);
  const page = await doc.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 1.5 });

  console.log(`Viewport: ${viewport.width}x${viewport.height}`);

  const canvas = createCanvas(viewport.width, viewport.height);
  const context = canvas.getContext('2d');

  // Canvas factory for pdf.js - creates canvases using @napi-rs/canvas
  const canvasFactory = {
    create(width, height) {
      console.log(`canvasFactory.create called: ${width}x${height}`);
      const nodeCanvas = createCanvas(width, height);
      const ctx = nodeCanvas.getContext('2d');
      return { canvas: nodeCanvas, context: ctx };
    },
    reset(canvasAndContext, width, height) {
      console.log(`canvasFactory.reset called: ${width}x${height}`);
      canvasAndContext.canvas.width = width;
      canvasAndContext.canvas.height = height;
    },
    destroy(canvasAndContext) {
      console.log('canvasFactory.destroy called');
      canvasAndContext.canvas.width = 0;
      canvasAndContext.canvas.height = 0;
      canvasAndContext.canvas = null;
      canvasAndContext.context = null;
    },
  };

  try {
    console.log('Starting page.render()...');
    await page.render({
      canvasContext: context,
      viewport,
      canvasFactory
    }).promise;
    console.log('Render complete!');

    const dataUrl = canvas.toDataURL('image/png');
    console.log(`Data URL length: ${dataUrl.length}`);
    return dataUrl;
  } catch (error) {
    console.error('Render error:', error);
    throw error;
  }
}

async function main() {
  console.log('\n=== PDF Image Extraction Test ===\n');

  // Dynamic import of pdfjs after polyfills are set
  const { getDocument, GlobalWorkerOptions } = await import('pdfjs-dist/legacy/build/pdf.mjs');

  // Configure worker
  GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href;
  GlobalWorkerOptions.standardFontDataUrl = `${pathToFileURL(standardFontPath).href}/`;

  try {
    console.log('Loading PDF document...');
    const loadingTask = getDocument({
      url: pathToFileURL(testPdfPath).href,
      isOffscreenCanvasSupported: false,
    });
    const doc = await loadingTask.promise;
    console.log(`Document loaded: ${doc.numPages} page(s)`);

    for (let i = 1; i <= doc.numPages; i++) {
      const dataUrl = await renderPageImage(doc, i);

      // Save the rendered image to verify it worked
      const outputPath = path.join(__dirname, `test-output-page-${i}.png`);
      const base64Data = dataUrl.replace(/^data:image\/png;base64,/, '');
      fs.writeFileSync(outputPath, base64Data, 'base64');
      console.log(`Saved: ${outputPath}`);
    }

    console.log('\n=== SUCCESS ===\n');
  } catch (error) {
    console.error('\n=== FAILED ===');
    console.error(error);
    process.exit(1);
  }
}

main();
