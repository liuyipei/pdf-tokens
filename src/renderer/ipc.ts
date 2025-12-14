import { ExtractionConfig, PageProgress, PdfSelection } from '../shared/types';

type ProgressListener = (event: PageProgress) => void;

export const selectPdf = async (): Promise<PdfSelection | null> => {
  return window.electronAPI.selectPdf();
};

export const startExtraction = async (filePath: string, config: Partial<ExtractionConfig>): Promise<void> => {
  return window.electronAPI.startExtraction(filePath, config);
};

export const listenForProgress = (listener: ProgressListener): (() => void) => {
  return window.electronAPI.onProgress(listener);
};
