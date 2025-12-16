# Minimal PDF-to-Image Electron App

## Purpose

Create a minimal Electron application to debug and validate PDF-to-image conversion approaches. This standalone app isolates PDF rendering from LLM integration complexity, allowing us to test different extraction strategies.

## Goals

1. Load PDF files from disk via file picker
2. Display PDF in WebContentsView using `<embed>` tag
3. Extract images of all PDF pages (not just visible ones)
4. Extract text from all PDF pages using `pdfjs-dist`
5. Display extracted content in the UI for verification
6. Measure and log performance metrics

## Tech Stack

- **Electron**: 39.x
- **Node.js**: 22.x
- **TypeScript**: Latest
- **pdfjs-dist**: 5.4.449 (Mozilla's PDF.js for Node.js)
- **canvas**: Node canvas for server-side PNG rendering of PDF pages
- **Build**: electron-builder

## Architecture

### Application Structure

```
minimal-pdf-debugger/
├── src/
│   ├── main/
│   │   ├── main.ts              # Electron main process entry
│   │   ├── pdf-extractor.ts     # PDF text/image extraction logic
│   │   └── preload.ts           # IPC bridge
│   ├── renderer/
│   │   ├── index.html           # Main window UI
│   │   ├── renderer.ts          # UI logic and IPC calls
│   │   └── styles.css           # Basic styling
│   └── types/
│       └── index.d.ts           # Shared TypeScript types
├── package.json
├── tsconfig.json
└── README.md
```

### Main Process Responsibilities

1. **Window Management**: Create BrowserWindow with WebContentsView for PDF display
2. **File Operations**: Handle file picker dialog and file path validation
3. **PDF Extraction**: Use `pdfjs-dist` to extract text from all pages
4. **Image Capture**: Render each page to PNGs in the main process via `pdfjs-dist` + `canvas`
5. **IPC Handlers**: Expose extraction functions to renderer process

### Renderer Process Responsibilities

1. **UI Controls**: File picker button, extraction trigger, results display
2. **PDF Display**: Show selected PDF in `<embed>` element
3. **Results Rendering**: Display extracted text and images with page numbers
4. **Progress Indication**: Show extraction status and timing

## Key Components

### 1. PDF Text + Image Extraction (Node.js)

Pages are parsed once in the main process using `pdfjs-dist`. Text and images are produced together so timing reflects the full pipeline and does not rely on the embedded PDF viewer.

```typescript
// src/main/pdf-extractor.ts
export async function extractPdfContent(filePath: string): Promise<ExtractedContent> {
  const loadingTask = getDocument({ url: pathToFileURL(filePath).href });
  const doc = await loadingTask.promise;

  for (let i = 1; i <= doc.numPages; i += 1) {
    const page = await doc.getPage(i);
    const textContent = await page.getTextContent();
    const text = textContent.items.map((item: any) => item.str).join(' ');

    const viewport = page.getViewport({ scale: 1.5 });
    const canvas = createCanvas(viewport.width, viewport.height);
    const context = canvas.getContext('2d');
    await page.render({ canvasContext: context as any, viewport }).promise;

    textPages.push({ pageNumber: i, text, extractionTimeMs: ... });
    images.push({ pageNumber: i, dataUrl: canvas.toDataURL(), captureTimeMs: ... });
  }

  return { textPages, images, totalExtractionTimeMs };
}
```

### 3. Main Window UI

```html
<!-- src/renderer/index.html -->
<!DOCTYPE html>
<html>
<head>
  <title>PDF to Image Debugger</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <div class="container">
    <header>
      <h1>PDF Extraction Debugger</h1>
      <button id="selectFile">Select PDF</button>
      <button id="extract" disabled>Extract Content</button>
    </header>

    <div class="content">
      <div class="preview">
        <h2>PDF Preview</h2>
        <div id="pdfContainer"></div>
      </div>

      <div class="results">
        <h2>Extraction Results</h2>
        <div id="status"></div>
        <div id="textResults"></div>
        <div id="imageResults"></div>
      </div>
    </div>
  </div>

  <script src="renderer.ts"></script>
</body>
</html>
```

### 4. IPC Communication

```typescript
// src/main/main.ts - Register handlers
ipcMain.handle('select-pdf', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'PDFs', extensions: ['pdf'] }]
  });
  return result.filePaths[0];
});

ipcMain.handle('extract-pdf-content', async (event, filePath: string) => {
  const textPages = await extractPdfText(filePath);
  const images = await captureAllPages(pdfView, textPages.length);
  return { textPages, images };
});
```

```typescript
// src/renderer/renderer.ts - Call handlers
document.getElementById('selectFile')?.addEventListener('click', async () => {
  const filePath = await window.electron.selectPdf();
  if (filePath) {
    displayPdf(filePath);
    document.getElementById('extract').disabled = false;
  }
});

document.getElementById('extract')?.addEventListener('click', async () => {
  const content = await window.electron.extractPdfContent(currentFilePath);
  displayResults(content);
});
```

## Troubleshooting

### Why the **Select PDF** button was unresponsive

The renderer script is loaded directly in the browser context without a bundler. Earlier, the renderer imported shared TypeScript types, which turned the file into a CommonJS module under the project-wide `module: "CommonJS"` setting. When compiled, TypeScript emitted `exports` boilerplate that expected a Node-like module system. Because that helper ran as soon as the page loaded (and `exports` is undefined in the renderer), the script threw before it could register the click handlers, leaving the **Select PDF** button inert. After inlining the renderer-only types and keeping the file free of imports/exports, the compiled script now executes as a plain browser script and attaches the button listeners normally.

## What We're Testing

### Primary Questions

1. **Does `pdfjs-dist` hang on certain PDFs?**
   - Test with 1-page, 3-page, 10-page, 50-page PDFs
   - Log extraction time per page
   - Identify if specific pages cause hangs

2. **Can we capture all pages via navigation?**
   - Test programmatic `#page=N` navigation
   - Measure render delay needed between pages
   - Verify images match page content

3. **What causes the "Streaming" hang?**
   - Extract content and display in simple UI
   - Verify extracted text is well-formed
   - Check if image buffers are corrupted

4. **Performance characteristics**
   - Measure text extraction time per page
   - Measure image capture time per page
   - Identify bottlenecks for optimization

### Success Criteria

- [ ] Extract text from all pages of multi-page PDF
- [ ] Capture images of all pages (not just page 1)
- [ ] No hanging or silent failures
- [ ] Extraction completes in reasonable time (<1s per page)
- [ ] Text and images display correctly in UI

## Implementation Phases

### Phase 1: Basic PDF Loading
- Create Electron window with WebContentsView
- Implement file picker
- Display PDF in embed tag
- Verify single-page PDFs work

### Phase 2: Text Extraction
- Integrate `pdfjs-dist`
- Extract text from all pages
- Display text with page numbers
- Log performance metrics

### Phase 3: Image Capture Experiments
- Test Approach A (visible page only)
- Test Approach B (navigation + capture)
- Compare results and performance
- Document findings

### Phase 4: Edge Cases
- Test large PDFs (50+ pages)
- Test PDFs with complex layouts
- Test scanned PDFs (images only, no text)
- Test password-protected PDFs

## Expected Learnings

This minimal app will help us determine:

1. **Root cause of hanging**: Is it `pdfjs-dist`, image capture, or our integration?
2. **Best capture strategy**: Which approach reliably captures all pages?
3. **Performance limits**: How many pages can we handle efficiently?
4. **Integration patterns**: How to properly use `pdfjs-dist` in Electron

## Differences from Main App

- **No LLM integration**: Eliminates API calls, streaming, token counting
- **No database**: No persistence, pure in-memory processing
- **Minimal UI**: Focus on debugging, not polish
- **Synchronous flow**: Simple button clicks, immediate results
- **Verbose logging**: Console output for every step

This isolation makes it easy to identify whether issues are in PDF handling or LLM integration.

## Getting Started

1. Install dependencies (Node.js 22.x recommended):

   ```bash
   npm install
   ```

2. Start the Electron app:

   ```bash
   npm start
   ```

3. Use **Select PDF** to choose a file, then **Extract Content** to run text extraction and page captures. Results and timings are shown in the main window while the PDF renders in the WebContentsView sidebar.
