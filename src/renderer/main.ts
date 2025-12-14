import { listenForProgress, selectPdf, startExtraction } from './ipc';
import { PageProgress } from '../shared/types';

const pickButton = document.getElementById('pick') as HTMLButtonElement;
const startButton = document.getElementById('start') as HTMLButtonElement;
const selectedSpan = document.getElementById('selected') as HTMLSpanElement;
const logDiv = document.getElementById('log') as HTMLDivElement;
const textPre = document.getElementById('text') as HTMLPreElement;
const thumbs = document.getElementById('thumbs') as HTMLDivElement;
const timeoutInput = document.getElementById('timeout') as HTMLInputElement;
const captureCheckbox = document.getElementById('capture') as HTMLInputElement;

let selectedFile: string | null = null;

const addLog = (message: string) => {
  const time = new Date().toLocaleTimeString();
  const line = document.createElement('div');
  line.textContent = `[${time}] ${message}`;
  logDiv.appendChild(line);
  logDiv.scrollTop = logDiv.scrollHeight;
};

const addThumb = (page: number, base64: string) => {
  const wrapper = document.createElement('div');
  wrapper.className = 'thumb';
  const label = document.createElement('div');
  label.textContent = `Page ${page}`;
  const img = document.createElement('img');
  img.src = `data:image/png;base64,${base64}`;
  wrapper.append(label, img);
  thumbs.appendChild(wrapper);
};

const appendText = (page: number, text: string) => {
  const current = textPre.textContent ?? '';
  const next = `${current}\n[Page ${page}] ${text}`.trim();
  textPre.textContent = next;
};

const handleProgress = (event: PageProgress) => {
  switch (event.type) {
    case 'start':
      addLog(`Extraction started for ${event.pages ?? '?'} pages`);
      thumbs.innerHTML = '';
      textPre.textContent = '';
      break;
    case 'page-start':
      addLog(`Page ${event.page} started${event.durationMs ? ` (${event.durationMs}ms)` : ''}`);
      break;
    case 'page-text':
      addLog(`Page ${event.page} text extracted`);
      if (typeof event.page === 'number' && event.text) {
        appendText(event.page, event.text);
      }
      break;
    case 'page-image':
      if (typeof event.page === 'number' && event.base64Image) {
        addLog(`Page ${event.page} image captured`);
        addThumb(event.page, event.base64Image);
      }
      break;
    case 'page-error':
      addLog(`Error on page ${event.page ?? '?'}: ${event.error ?? 'unknown'}`);
      break;
    case 'done':
      addLog(`Extraction finished in ${event.durationMs ?? 0}ms`);
      startButton.disabled = false;
      break;
    default:
      break;
  }
};

pickButton.addEventListener('click', async () => {
  const result = await selectPdf();
  if (result?.filePath) {
    selectedFile = result.filePath;
    selectedSpan.textContent = result.filePath;
    startButton.disabled = false;
    addLog(`Selected ${result.filePath}`);
  }
});

startButton.addEventListener('click', async () => {
  if (!selectedFile) return;
  startButton.disabled = true;
  const timeoutMs = Number(timeoutInput.value) || 10000;
  const capture = captureCheckbox.checked;
  await startExtraction(selectedFile, { timeoutMs, capture });
});

listenForProgress(handleProgress);
