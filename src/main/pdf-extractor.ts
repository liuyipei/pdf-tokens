import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PageText } from '../types';

const workerSrc = path.join(__dirname, '../../node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs');
GlobalWorkerOptions.workerSrc = workerSrc;

export interface TextExtractionResult {
  pages: PageText[];
  totalTimeMs: number;
  pageCount: number;
}

export async function extractPdfText(filePath: string): Promise<TextExtractionResult> {
  const startTime = performance.now();
  const loadingTask = getDocument({ url: filePath });
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
