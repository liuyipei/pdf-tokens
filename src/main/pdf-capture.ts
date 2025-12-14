import { BrowserView, BrowserWindow } from 'electron';
import { pathToFileURL } from 'url';
import { log } from './logging';

interface CaptureOptions {
  filePath: string;
  pages: number;
  timeoutMs: number;
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const capturePages = async (
  window: BrowserWindow,
  { filePath, pages, timeoutMs }: CaptureOptions,
  emit: (page: number, base64: string) => void
): Promise<void> => {
  const view = new BrowserView();
  window.setBrowserView(view);
  view.setBounds({ x: 0, y: 0, width: 1280, height: 720 });

  const baseUrl = pathToFileURL(filePath).href;

  for (let i = 1; i <= pages; i++) {
    const start = Date.now();
    const pageUrl = `${baseUrl}#page=${i}`;
    log({ scope: 'capture', message: 'loading page', data: { page: i, url: pageUrl } });
    await view.webContents.loadURL(pageUrl, { timeout: timeoutMs });
    await delay(150);
    const image = await view.webContents.capturePage();
    emit(i, image.toPNG().toString('base64'));
    log({ scope: 'capture', message: 'captured page', data: { page: i, durationMs: Date.now() - start } });
  }

  window.removeBrowserView(view);
  view.destroy();
};
