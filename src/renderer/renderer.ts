import type { ExtractedContent, PageImage, PageText } from '../types';

let currentFilePath: string | undefined;

const selectButton = document.getElementById('selectFile') as HTMLButtonElement;
const extractButton = document.getElementById('extract') as HTMLButtonElement;
const statusEl = document.getElementById('status') as HTMLDivElement;
const textResults = document.getElementById('textResults') as HTMLDivElement;
const imageResults = document.getElementById('imageResults') as HTMLDivElement;

function setStatus(message: string): void {
  statusEl.textContent = message;
}

function renderTextPages(pages: PageText[]): void {
  textResults.innerHTML = '';
  pages.forEach((page) => {
    const container = document.createElement('div');
    container.className = 'text-block';
    const heading = document.createElement('h3');
    heading.textContent = `Page ${page.pageNumber} (${page.extractionTimeMs}ms)`;
    const para = document.createElement('p');
    para.textContent = page.text || '[No text extracted]';

    container.appendChild(heading);
    container.appendChild(para);
    textResults.appendChild(container);
  });
}

function renderImages(images: PageImage[]): void {
  imageResults.innerHTML = '';
  images.forEach((image) => {
    const container = document.createElement('div');
    container.className = 'image-block';
    const heading = document.createElement('h3');
    heading.textContent = `Page ${image.pageNumber} (${image.captureTimeMs}ms)`;
    const img = document.createElement('img');
    img.src = image.dataUrl;
    img.alt = `Page ${image.pageNumber}`;

    container.appendChild(heading);
    container.appendChild(img);
    imageResults.appendChild(container);
  });
}

async function handleSelectFile(): Promise<void> {
  const filePath = await window.electron.selectPdf();
  if (!filePath) return;

  currentFilePath = filePath;
  setStatus(`Loaded ${filePath}`);
  await window.electron.displayPdf(filePath);
  extractButton.disabled = false;
}

async function handleExtraction(): Promise<void> {
  if (!currentFilePath) return;
  extractButton.disabled = true;
  setStatus('Extracting text and capturing images...');
  const start = performance.now();

  try {
    const content: ExtractedContent = await window.electron.extractPdfContent(currentFilePath);
    renderTextPages(content.textPages);
    renderImages(content.images);
    const totalTime = Math.round(performance.now() - start);
    setStatus(`Extraction complete in ${totalTime}ms (reported total ${content.totalExtractionTimeMs}ms).`);
  } catch (error) {
    console.error(error);
    setStatus('Extraction failed. Check console for details.');
  } finally {
    extractButton.disabled = false;
  }
}

function initializeLayout(): void {
  window.electron.onPdfViewSize((width) => {
    document.documentElement.style.setProperty('--pdf-view-width', `${width}px`);
  });
}

selectButton?.addEventListener('click', () => {
  handleSelectFile();
});

extractButton?.addEventListener('click', () => {
  handleExtraction();
});

initializeLayout();
