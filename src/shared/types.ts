export type PageEventType =
  | 'start'
  | 'page-start'
  | 'page-text'
  | 'page-image'
  | 'page-error'
  | 'done';

export interface ExtractionConfig {
  timeoutMs: number;
  capture: boolean;
}

export interface PageProgress {
  type: PageEventType;
  page?: number;
  pages?: number;
  message?: string;
  durationMs?: number;
  base64Image?: string;
  text?: string;
  error?: string;
}

export interface PdfSelection {
  filePath: string;
}
