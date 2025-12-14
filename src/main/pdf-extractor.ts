import { readFile } from 'fs/promises';
import { getDocument, GlobalWorkerOptions, PDFDocumentProxy } from 'pdfjs-dist';
import { log } from './logging';
import { PageProgress, ExtractionConfig } from '../shared/types';

GlobalWorkerOptions.workerSrc = 'pdfjs-dist/build/pdf.worker.min.js';

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> => {
  return Promise.race<Promise<T>>([
    promise,
    new Promise<T>((_, reject) => {
      const timer = setTimeout(() => {
        clearTimeout(timer);
        reject(new Error(`${label} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    })
  ]);
};

export const extractPdf = async (
  filePath: string,
  config: ExtractionConfig,
  emit: (event: PageProgress) => void
): Promise<number> => {
  log({ scope: 'extractor', message: 'Starting extraction', data: { filePath } });
  emit({ type: 'start', message: 'starting extraction' });
  const pdfData = await readFile(filePath);
  const start = Date.now();
  const pdf: PDFDocumentProxy = await withTimeout(
    getDocument({
      data: new Uint8Array(pdfData),
      worker: false,
      useSystemFonts: true,
      disableAutoFetch: true,
      nativeImageDecoding: false
    }).promise,
    config.timeoutMs,
    'getDocument'
  );
  emit({ type: 'start', pages: pdf.numPages });
  for (let i = 1; i <= pdf.numPages; i++) {
    const pageStart = Date.now();
    emit({ type: 'page-start', page: i, pages: pdf.numPages });
    try {
      const page = await withTimeout(pdf.getPage(i), config.timeoutMs, `getPage ${i}`);
      const textContent = await withTimeout(page.getTextContent(), config.timeoutMs, `getTextContent ${i}`);
      const text = textContent.items
        .map((item) => ('str' in item ? (item as { str: string }).str : ''))
        .join(' ')
        .trim();
      emit({ type: 'page-text', page: i, pages: pdf.numPages, text });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      log({ scope: 'extractor', message: 'page error', data: { page: i, error: message } });
      emit({ type: 'page-error', page: i, pages: pdf.numPages, error: message });
    }
    emit({ type: 'page-start', page: i, pages: pdf.numPages, durationMs: Date.now() - pageStart });
  }
  emit({ type: 'done', pages: pdf.numPages, durationMs: Date.now() - start });
  log({ scope: 'extractor', message: 'Extraction complete', data: { durationMs: Date.now() - start } });
  return pdf.numPages;
};
