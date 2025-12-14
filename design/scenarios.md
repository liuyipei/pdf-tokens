# Scenarios

- **Baseline 3-page PDF**: Use `fixtures/sample-3page.pdf` to verify text extraction and thumbnails populate. Expect three `page-text` events and three `page-image` events.
- **Timeout behavior**: Increase the timeout input to a low value (e.g., 10ms) and confirm `page-error` events log when `getPage` races the timeout.
- **Capture toggle**: Uncheck "Capture images" and confirm only text events stream while capture IPC remains idle.
