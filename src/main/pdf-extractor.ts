import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { createCanvas } from 'canvas';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { ExtractedContent, PageImage, PageText } from '../types';

const workerPath = path.join(__dirname, '../../node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs');
GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href;
const standardFontPath = path.join(__dirname, '../../node_modules/pdfjs-dist/standard_fonts/');
GlobalWorkerOptions.standardFontDataUrl = `${pathToFileURL(standardFontPath).href}`;

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

  await page.render({ canvasContext: context as any, viewport }).promise;

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
