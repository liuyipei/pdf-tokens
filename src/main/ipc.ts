import { BrowserWindow, dialog, ipcMain } from 'electron';
import { capturePages } from './pdf-capture';
import { extractPdf } from './pdf-extractor';
import { log } from './logging';
import { ExtractionConfig, PageProgress, PdfSelection } from '../shared/types';

const defaultConfig: ExtractionConfig = {
  timeoutMs: 10000,
  capture: true
};

export const registerIpc = (window: BrowserWindow): void => {
  ipcMain.handle('select-pdf', async () => {
    const result = await dialog.showOpenDialog(window, {
      properties: ['openFile'],
      filters: [{ name: 'PDFs', extensions: ['pdf'] }]
    });
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    const payload: PdfSelection = { filePath: result.filePaths[0] };
    log({ scope: 'ipc', message: 'file selected', data: payload });
    return payload;
  });

  ipcMain.handle('start-extraction', async (_event, filePath: string, config?: Partial<ExtractionConfig>) => {
    const merged: ExtractionConfig = { ...defaultConfig, ...config };
    const send = (event: PageProgress) => {
      window.webContents.send('extraction-progress', event);
    };

    try {
      const pages = await extractPdf(filePath, merged, send);
      if (merged.capture) {
        await capturePages(
          window,
          { filePath, pages, timeoutMs: merged.timeoutMs },
          (page, image) => send({ type: 'page-image', page, base64Image: image })
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown extraction error';
      log({ scope: 'ipc', message: 'extraction error', data: { error: message } });
      send({ type: 'page-error', error: message });
    }
  });
};
