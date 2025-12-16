export interface PageText {
  pageNumber: number;
  text: string;
  extractionTimeMs: number;
}

export interface PageImage {
  pageNumber: number;
  dataUrl: string;
  captureTimeMs: number;
}

export interface ExtractedContent {
  textPages: PageText[];
  images: PageImage[];
  totalExtractionTimeMs: number;
}

export interface ElectronAPI {
  selectPdf: () => Promise<string | undefined>;
  displayPdf: (filePath: string) => Promise<void>;
  extractPdfContent: (filePath: string) => Promise<ExtractedContent>;
  onPdfViewSize: (callback: (width: number) => void) => void;
}

declare global {
  interface Window {
    electron: ElectronAPI;
  }
}
