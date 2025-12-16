import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { app, BrowserWindow, dialog, ipcMain, WebContentsView } from 'electron';
import { extractPdfText } from './pdf-extractor';
import type { ExtractedContent, PageImage } from '../types';

const PDF_VIEW_WIDTH = 520;

let mainWindow: BrowserWindow | null = null;
let pdfView: WebContentsView | null = null;
let currentPdfPath: string | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const rendererHtmlPath = app.isPackaged
    ? path.join(process.resourcesPath, 'dist', 'renderer', 'index.html')
    : path.join(__dirname, '../renderer/index.html');

  mainWindow.loadFile(rendererHtmlPath);
  mainWindow.webContents.openDevTools({ mode: 'detach' });

  pdfView = new WebContentsView({
    webPreferences: {
      javascript: true,
    },
  });

  mainWindow.contentView.addChildView(pdfView);
  layoutPdfView();

  mainWindow.on('resize', layoutPdfView);
  mainWindow.on('closed', () => {
    mainWindow = null;
    pdfView = null;
  });
}

function layoutPdfView(): void {
  if (!mainWindow || !pdfView) return;
  const { width, height } = mainWindow.getContentBounds();
  pdfView.setBounds({
    x: width - PDF_VIEW_WIDTH,
    y: 0,
    width: PDF_VIEW_WIDTH,
    height,
  });

  mainWindow.webContents.send('pdf-view-size', PDF_VIEW_WIDTH);
}

async function loadPdfInView(filePath: string): Promise<void> {
  if (!pdfView) return;
  currentPdfPath = filePath;
  const encodedPath = filePath.replace(/#/g, '%23');
  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;background:#111;color:#fff;">
  <embed id="pdf-embed" src="file://${encodedPath}#page=1" type="application/pdf" style="width:100%;height:100%;" />
</body>
</html>`;
  const dataUrl = `data:text/html;base64,${Buffer.from(html).toString('base64')}`;
  await pdfView.webContents.loadURL(dataUrl);
}

async function captureAllPages(pageCount: number): Promise<PageImage[]> {
  if (!pdfView) return [];

  const images: PageImage[] = [];

  for (let i = 1; i <= pageCount; i += 1) {
    const captureStart = performance.now();
    const navigationScript = `(() => {
      const embed = document.getElementById('pdf-embed');
      if (!embed) return false;
      const base = embed.dataset.base || embed.src.split('#')[0];
      embed.dataset.base = base;
      embed.src = base + '#page=${i}';
      return true;
    })();`;
    await pdfView.webContents.executeJavaScript(navigationScript);

    // give the pdf renderer a moment to update
    await pdfView.webContents.executeJavaScript('new Promise(resolve => setTimeout(resolve, 400));');

    const image = await pdfView.webContents.capturePage();
    images.push({
      pageNumber: i,
      dataUrl: image.toDataURL(),
      captureTimeMs: Math.round(performance.now() - captureStart),
    });
  }

  return images;
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

ipcMain.handle('select-pdf', async () => {
  if (!mainWindow) return undefined;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'PDFs', extensions: ['pdf'] }],
  });

  if (result.canceled || result.filePaths.length === 0) return undefined;
  return result.filePaths[0];
});

ipcMain.handle('display-pdf', async (_event, filePath: string) => {
  await loadPdfInView(filePath);
});

ipcMain.handle('extract-pdf-content', async (_event, filePath: string): Promise<ExtractedContent> => {
  if (!filePath) throw new Error('No PDF selected');
  if (filePath !== currentPdfPath) {
    await loadPdfInView(filePath);
  }

  const textResult = await extractPdfText(filePath);
  const images = await captureAllPages(textResult.pageCount);

  return {
    textPages: textResult.pages,
    images,
    totalExtractionTimeMs: textResult.totalTimeMs + images.reduce((sum, img) => sum + img.captureTimeMs, 0),
  };
});
