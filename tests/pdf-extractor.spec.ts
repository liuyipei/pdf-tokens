import { describe, expect, it } from 'vitest';
import { extractPdf } from '../src/main/pdf-extractor';
import { PageProgress } from '../src/shared/types';
import { join } from 'path';

describe('extractPdf', () => {
  it('extracts text from sample PDF', async () => {
    const fixture = join(__dirname, '../fixtures/sample-3page.pdf');
    const events: PageProgress[] = [];
    const pages = await extractPdf(
      fixture,
      { timeoutMs: 5000, capture: false },
      (event) => events.push(event)
    );
    const textPages = events.filter((e) => e.type === 'page-text');
    expect(pages).toBe(3);
    expect(textPages).toHaveLength(3);
    expect(textPages[0].text).toContain('Sample page one');
    expect(textPages[1].text).toContain('Sample page two');
    expect(textPages[2].text).toContain('Sample page three');
  });
});
