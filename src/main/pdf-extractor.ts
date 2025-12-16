import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { createCanvas } from 'canvas';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { Image } = require('canvas') as typeof import('canvas');
import type { ExtractedContent, PageImage, PageText } from '../types';

type PdfJsModule = typeof import('pdfjs-dist');

/**
 * pdf.js will create Image instances when painting inline images. When running in
 * Node via node-canvas, we need to expose the canvas Image constructor on the
 * global object so drawImage receives a valid backing type instead of throwing
 * "Image or Canvas expected".
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).Image = Image;

let pdfjs: (PdfJsModule & { GlobalWorkerOptions: any }) | null = null;

function loadPdfJs(): PdfJsModule & { GlobalWorkerOptions: any } {
  if (pdfjs) return pdfjs;

  // Import the CommonJS build after the Image global is patched so pdf.js picks
  // up the correct constructor when decoding inline images.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const loaded = require('pdfjs-dist/legacy/build/pdf.js') as PdfJsModule & { GlobalWorkerOptions: any };

  const workerPath = path.join(__dirname, '../../node_modules/pdfjs-dist/legacy/build/pdf.worker.min.js');
  loaded.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href;
  const standardFontPath = path.join(__dirname, '../../node_modules/pdfjs-dist/standard_fonts/');
  loaded.GlobalWorkerOptions.standardFontDataUrl = `${pathToFileURL(standardFontPath).href}`;

  pdfjs = loaded;
  return loaded;
}

export interface TextExtractionResult {
  pages: PageText[];
  totalTimeMs: number;
  pageCount: number;
}

export async function extractPdfText(filePath: string): Promise<TextExtractionResult> {
  const startTime = performance.now();
  const { getDocument } = loadPdfJs();
  const loadingTask = getDocument({ url: pathToFileURL(filePath).href });
  const doc = await loadingTask.promise;

  const pages: PageText[] = [];

  for (let i = 1; i <= doc.numPages; i += 1) {
    const pageStart = performance.now();
    const page = await doc.getPage(i);
    const textContent = await page.getTextContent();
    const text = textContent.items.map((item: any) => item.str).join(' ');

    pages.push({
      pageNumber: i,
      text,
      extractionTimeMs: Math.round(performance.now() - pageStart),
    });
  }

  const totalTimeMs = Math.round(performance.now() - startTime);
  console.log(`Total extraction time: ${totalTimeMs}ms for ${doc.numPages} pages`);

  return {
    pages,
    totalTimeMs,
    pageCount: doc.numPages,
  };
}

async function renderPageImage(doc: any, pageNumber: number): Promise<PageImage> {
  const start = performance.now();
  const page = await doc.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 1.5 });
  const canvas = createCanvas(viewport.width, viewport.height);
  const context = canvas.getContext('2d');

  // Provide pdf.js with a concrete canvas factory so it doesn't attempt to
  // construct browser canvases internally (which would lack the Image type in
  // Node and trigger drawImage errors for inline images).
  const canvasFactory = {
    create(width: number, height: number) {
      const nodeCanvas = createCanvas(width, height);
      const ctx = nodeCanvas.getContext('2d');
      return { canvas: nodeCanvas, context: ctx };
    },
    reset(canvasAndContext: { canvas: any }, width: number, height: number) {
      canvasAndContext.canvas.width = width;
      canvasAndContext.canvas.height = height;
    },
    destroy(canvasAndContext: { canvas: any; context: any }) {
      canvasAndContext.canvas.width = 0;
      canvasAndContext.canvas.height = 0;
      canvasAndContext.canvas = null;
      canvasAndContext.context = null;
    },
  };

  await page.render({ canvasContext: context as any, viewport, canvasFactory }).promise;

  return {
    pageNumber,
    dataUrl: canvas.toDataURL(),
    captureTimeMs: Math.round(performance.now() - start),
  };
}

export async function extractPdfContent(filePath: string): Promise<ExtractedContent> {
  const startTime = performance.now();
  const { getDocument } = loadPdfJs();
  const loadingTask = getDocument({ url: pathToFileURL(filePath).href });
  const doc = await loadingTask.promise;

  const textPages: PageText[] = [];
  const images: PageImage[] = [];

  for (let i = 1; i <= doc.numPages; i += 1) {
    const pageStart = performance.now();
    const page = await doc.getPage(i);
    const textContent = await page.getTextContent();
    const text = textContent.items.map((item: any) => item.str).join(' ');

    textPages.push({
      pageNumber: i,
      text,
      extractionTimeMs: Math.round(performance.now() - pageStart),
    });

    const image = await renderPageImage(doc, i);
    images.push(image);
  }

  const totalTimeMs = Math.round(performance.now() - startTime);
  console.log(`Full extraction time: ${totalTimeMs}ms for ${doc.numPages} pages`);

  return {
    textPages,
    images,
    totalExtractionTimeMs: totalTimeMs,
  };
}
