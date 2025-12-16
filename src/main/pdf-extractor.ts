import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { createCanvas, Image, DOMMatrix, ImageData, Path2D } from '@napi-rs/canvas';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { ExtractedContent, PageImage, PageText } from '../types';

/**
 * pdfjs-dist 5.x expects @napi-rs/canvas and these browser globals to be available.
 * We polyfill them here to ensure PDF rendering with embedded images works correctly.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const g = globalThis as any;
if (!g.Image) g.Image = Image;
if (!g.DOMMatrix) g.DOMMatrix = DOMMatrix;
if (!g.ImageData) g.ImageData = ImageData;
if (!g.Path2D) g.Path2D = Path2D;

const workerPath = path.join(__dirname, '../../node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs');
GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href;
const standardFontPath = path.join(__dirname, '../../node_modules/pdfjs-dist/standard_fonts/');
(GlobalWorkerOptions as any).standardFontDataUrl = `${pathToFileURL(standardFontPath).href}`;

export interface TextExtractionResult {
  pages: PageText[];
  totalTimeMs: number;
  pageCount: number;
}

export async function extractPdfText(filePath: string): Promise<TextExtractionResult> {
  const startTime = performance.now();
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
