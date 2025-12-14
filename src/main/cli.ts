import { argv, exit } from 'process';
import { extractPdf } from './pdf-extractor';
import { log } from './logging';
import { PageProgress } from '../shared/types';

const args = argv.slice(2);
const fileIndex = args.findIndex((arg) => arg === '--file');
const filePath = fileIndex >= 0 ? args[fileIndex + 1] : undefined;

if (!filePath) {
  // eslint-disable-next-line no-console
  console.error('Usage: npm run capture -- --file path/to.pdf');
  exit(1);
}

const events: PageProgress[] = [];
extractPdf(
  filePath,
  { timeoutMs: 10000, capture: false },
  (event) => {
    events.push(event);
    if (event.type === 'page-error') {
      log({ scope: 'cli', message: 'page error', data: event });
    }
  }
)
  .then(() => {
    const summary = events.filter((e) => e.type === 'page-text').map((e) => ({ page: e.page, text: e.text }));
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ pages: summary.length, pagesDetailed: summary }, null, 2));
  })
  .catch((error) => {
    log({ scope: 'cli', message: 'extraction failed', data: { error: error instanceof Error ? error.message : String(error) } });
    exit(1);
  });
