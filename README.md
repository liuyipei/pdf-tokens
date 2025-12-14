# Electron PDF Capture Prototype Repo Design

## Goal
Create a small, self-contained repository that exercises PDF text and image capture in Electron (no LLM calls) so we can iterate quickly on extraction issues without touching the main app. The prototype should simulate real-world PDF usage patterns, stress suspected failure cases, and surface timing/logging that help us debug hangs or silent failures.

## Scope
- Runs in Electron main and renderer processes with Node.js 22 (aligning with the target stack).
- Opens local PDF files and captures per-page images plus optional text extraction for debugging.
- Exposes clear logging/metrics to detect hangs, long-running steps, and malformed content.
- No network calls to LLMs; everything remains local/offline.

## High-Level Architecture
- **Electron main process**
  - Launches a BrowserWindow hosting a simple UI.
  - Manages PDF selection via `dialog.showOpenDialog` and passes file paths to renderer via IPC.
  - Provides main-process PDF extraction utilities using `pdfjs-dist` with worker disabled (`worker: false`) and `GlobalWorkerOptions.workerSrc` set explicitly.
  - Captures page images using a hidden `BrowserView` that loads the PDF via `file://` URL and uses `capturePage`.
- **Renderer process**
  - Minimal UI: file picker button, log area, thumbnails area for captured images.
  - Sends IPC requests to main to start extraction and displays progress/results streamed from main.
- **Shared utilities**
  - Typed IPC channels for progress events (`start`, `page-start`, `page-text`, `page-image`, `page-error`, `done`).
  - Configurable timeouts per step to surface hangs.

## Key User Flows
1. **Open PDF**
   - User clicks “Open PDF”; renderer requests main to show open dialog; selected file path returns to renderer and triggers extraction.
2. **Extract**
   - Main reads PDF bytes into `Uint8Array`, calls `pdfjs.getDocument({ data, worker: false, useSystemFonts: true, disableAutoFetch: true, nativeImageDecoding: false })`.
   - Iterates pages sequentially, emitting progress after each `getPage` and `getTextContent`.
   - For each page, loads it into a hidden `BrowserView` and calls `capturePage` to generate PNG buffers.
3. **Display**
   - Renderer receives text snippets and base64-encoded PNGs, showing thumbnails and text preview with timing metadata.

## Error & Hang Detection (Suspected Sources)
- **Worker misconfiguration**: enforce `worker: false`; log if worker tries to start.
- **Path handling**: normalize `file://` URIs; percent-encode spaces; prefer `data` buffer fallback.
- **Page fetch timeouts**: wrap `getPage`, `getTextContent`, and capture calls in `Promise.race` with configurable timeout; log and continue on timeout.
- **Large assets**: detect images/fonts fetch attempts and log `autoFetch`/`nativeImageDecoding` usage.
- **Renderer crash**: monitor `BrowserView`/`webContents` `did-fail-load`, `crashed`, and `render-process-gone` events; retry or bail with diagnostic info.
- **Memory pressure**: per-page cleanup (destroy `BrowserView`, `nativeImage` buffers) and optional concurrency limit (default 1) to mimic problematic 3-page reproduction.
- **Invisible hangs**: timestamp every major step; emit heartbeat events so UI can flag stalled operations.

## Repository Structure
```
/ (new repo root)
  package.json (Electron app scripts)
  electron-builder.yml (minimal packaging, optional)
  src/
    main/
      index.ts (app entry, window creation)
      ipc.ts (channel wiring)
      pdf-extractor.ts (pdfjs-dist text extraction with timeouts)
      pdf-capture.ts (BrowserView setup + capturePage per page)
      logging.ts (structured logging with timestamps)
      preload.ts (secure context bridge for renderer)
      cli.ts (headless text extraction helper)
    renderer/
      index.html (minimal UI shell)
      main.ts (UI logic)
      ipc.ts (typed channel helpers)
      styles.css (basic styling)
    shared/
      types.ts (IPC contracts, event payloads)
  design/
    scenarios.md (test cases and reproduction steps)
  tests/
    pdf-extractor.spec.ts (node-based unit tests with fixture PDFs)
  fixtures/
    sample-3page.pdf
```

## Test Scenarios to Cover
- **Baseline 3-page PDF**: ensure extraction completes with text and images; verify timings logged and no hangs.
- **File path edge cases**: spaces, unicode paths; compare `file://` URL vs `data` buffer input.
- **Worker off vs on**: flag if worker accidentally starts; ensure `worker: false` path works.
- **Large image pages**: capturePage under memory pressure; check for slowdowns or timeouts.
- **Fonts/unicode**: confirm `useSystemFonts: true` resolves text; log glyph fallback issues.
- **Renderer crash simulation**: intentionally destroy the BrowserView mid-extraction to verify error handling.

## Instrumentation & Observability
- Structured logs with step names, page numbers, start/end timestamps, and durations.
- In-UI timeline showing each step per page; highlight any step exceeding threshold.
- Optional disk trace: write JSON log per run containing the configuration, timings, and any errors.

## Scripts
- `npm run build`: compile TypeScript and copy renderer HTML/CSS into `dist/`.
- `npm run dev`: build and launch Electron pointed at the compiled renderer assets.
- `npm run test`: run node-based extractor tests.
- `npm run capture -- --file path/to.pdf`: CLI trigger for headless extraction (no renderer) to speed iteration.

## Open Questions / Follow-ups
- Should we prefer headless canvas rendering (via `pdfjs-dist` + `canvas`) instead of `BrowserView.capturePage` for determinism? Start with BrowserView to mirror prod behavior.
- Do we need Windows/macOS CI builds to catch platform-specific worker issues? Start with Linux GitHub Actions runner.
- How to bundle fonts for consistent text extraction? Consider packaging a small font set for CI runs.
