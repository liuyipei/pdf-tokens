import { app, BrowserWindow } from 'electron';
import { join } from 'path';
import { registerIpc } from './ipc';
import { log } from './logging';

const createWindow = () => {
  const window = new BrowserWindow({
    width: 1200,
    height: 900,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false
    }
  });

  const url = `file://${join(__dirname, '../renderer/index.html')}`;
  window.loadURL(url);
  registerIpc(window);
};

app.on('ready', () => {
  log({ scope: 'app', message: 'App ready' });
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
