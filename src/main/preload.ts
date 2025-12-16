import { contextBridge, ipcRenderer } from 'electron';
import type { ElectronAPI, ExtractedContent } from '../types';

const api: ElectronAPI = {
  selectPdf: () => ipcRenderer.invoke('select-pdf'),
  displayPdf: (filePath: string) => ipcRenderer.invoke('display-pdf', filePath),
  extractPdfContent: (filePath: string): Promise<ExtractedContent> => ipcRenderer.invoke('extract-pdf-content', filePath),
  onPdfViewSize: (callback: (width: number) => void) => {
    ipcRenderer.on('pdf-view-size', (_event, width: number) => callback(width));
  },
};

contextBridge.exposeInMainWorld('electron', api);
