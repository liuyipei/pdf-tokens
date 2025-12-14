import { contextBridge, ipcRenderer } from 'electron';
import { ExtractionConfig, PageProgress, PdfSelection } from '../shared/types';

type ProgressCallback = (event: PageProgress) => void;

contextBridge.exposeInMainWorld('electronAPI', {
  selectPdf: async (): Promise<PdfSelection | null> => ipcRenderer.invoke('select-pdf'),
  startExtraction: async (filePath: string, config?: Partial<ExtractionConfig>) =>
    ipcRenderer.invoke('start-extraction', filePath, config),
  onProgress: (callback: ProgressCallback) => {
    const handler = (_: unknown, event: PageProgress) => callback(event);
    ipcRenderer.on('extraction-progress', handler);
    return () => ipcRenderer.removeListener('extraction-progress', handler);
  }
});

declare global {
  interface Window {
    electronAPI: {
      selectPdf: () => Promise<PdfSelection | null>;
      startExtraction: (filePath: string, config?: Partial<ExtractionConfig>) => Promise<void>;
      onProgress: (callback: ProgressCallback) => () => void;
    };
  }
}
