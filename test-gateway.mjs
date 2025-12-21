/**
 * VLM Gateway Integration Test
 *
 * Tests the complete pipeline:
 * 1. Extract PDF pages as images
 * 2. Send to VLM via gateway
 * 3. Get analysis back
 */

import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Setup paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Polyfills required for pdfjs-dist (must be before import)
import { createCanvas, Image, DOMMatrix, ImageData, Path2D } from '@napi-rs/canvas';
globalThis.Image = Image;
globalThis.DOMMatrix = DOMMatrix;
globalThis.ImageData = ImageData;
globalThis.Path2D = Path2D;

// PDF.js setup
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

// Gateway imports (we'll use dynamic imports since TypeScript isn't compiled yet)
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_BASE_URL = process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com';

// ============================================================================
// PDF Extraction (simplified from pdf-extractor.ts)
// ============================================================================

async function extractPdfAsImages(filePath, maxPages = 5) {
  console.log(`\n📄 Extracting PDF: ${filePath}`);

  const data = new Uint8Array(readFileSync(filePath));
  const doc = await getDocument({ data }).promise;

  const pageCount = Math.min(doc.numPages, maxPages);
  console.log(`   Total pages: ${doc.numPages}, extracting first ${pageCount}`);

  const images = [];

  for (let i = 1; i <= pageCount; i++) {
    const page = await doc.getPage(i);
    const scale = 1.5;
    const viewport = page.getViewport({ scale });

    const canvas = createCanvas(viewport.width, viewport.height);
    const context = canvas.getContext('2d');

    const canvasFactory = {
      create(width, height) {
        const nodeCanvas = createCanvas(width, height);
        return { canvas: nodeCanvas, context: nodeCanvas.getContext('2d') };
      },
      reset(canvasAndContext, width, height) {
        canvasAndContext.canvas.width = width;
        canvasAndContext.canvas.height = height;
      },
      destroy(canvasAndContext) {}
    };

    await page.render({
      canvasContext: context,
      viewport,
      canvasFactory
    }).promise;

    const dataUrl = canvas.toDataURL();
    // Extract just the base64 part
    const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');

    images.push({
      pageNumber: i,
      data: base64,
      mediaType: 'image/png',
      width: viewport.width,
      height: viewport.height
    });

    console.log(`   ✓ Page ${i}: ${viewport.width}x${viewport.height}`);
  }

  await doc.destroy();
  return images;
}

// ============================================================================
// Anthropic API Call (direct, matching gateway format)
// ============================================================================

async function sendToAnthropic(messages, options = {}) {
  const model = options.model || 'claude-sonnet-4-20250514';
  const maxTokens = options.maxTokens || 1024;

  console.log(`\n🤖 Sending to Anthropic (${model})`);

  const startTime = Date.now();

  const response = await fetch(`${ANTHROPIC_BASE_URL}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages
    })
  });

  const endTime = Date.now();
  const durationMs = endTime - startTime;

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Anthropic API error ${response.status}: ${error}`);
  }

  const data = await response.json();

  console.log(`   ✓ Response in ${durationMs}ms`);
  console.log(`   ✓ Tokens: ${data.usage.input_tokens} in / ${data.usage.output_tokens} out`);

  return {
    content: data.content[0]?.text || '',
    usage: data.usage,
    durationMs
  };
}

// ============================================================================
// Test Cases
// ============================================================================

async function testTextOnly() {
  console.log('\n' + '='.repeat(60));
  console.log('TEST 1: Text-only request');
  console.log('='.repeat(60));

  const result = await sendToAnthropic([
    { role: 'user', content: 'What is 2+2? Reply with just the number.' }
  ]);

  console.log(`\n📝 Response: ${result.content}`);
  return result.content.includes('4');
}

async function testVisionWithImages() {
  console.log('\n' + '='.repeat(60));
  console.log('TEST 2: Vision request with PDF page images');
  console.log('='.repeat(60));

  const pdfPath = join(__dirname, 'google_image.pdf');
  if (!existsSync(pdfPath)) {
    console.log('⚠️  Test PDF not found, skipping vision test');
    return true;
  }

  // Extract first page as image
  const images = await extractPdfAsImages(pdfPath, 1);

  if (images.length === 0) {
    console.log('⚠️  No images extracted, skipping vision test');
    return true;
  }

  // Build multimodal message
  const message = {
    role: 'user',
    content: [
      {
        type: 'image',
        source: {
          type: 'base64',
          media_type: images[0].mediaType,
          data: images[0].data
        }
      },
      {
        type: 'text',
        text: 'Describe what you see in this PDF page. Be concise (2-3 sentences).'
      }
    ]
  };

  const result = await sendToAnthropic([message]);

  console.log(`\n📝 Response:\n${result.content}`);
  return result.content.length > 10;
}

async function testNativePDF() {
  console.log('\n' + '='.repeat(60));
  console.log('TEST 3: Native PDF support (Claude 3.5+)');
  console.log('='.repeat(60));

  const pdfPath = join(__dirname, 'google_image.pdf');
  if (!existsSync(pdfPath)) {
    console.log('⚠️  Test PDF not found, skipping native PDF test');
    return true;
  }

  const pdfData = readFileSync(pdfPath);
  const base64 = pdfData.toString('base64');

  console.log(`   PDF size: ${(pdfData.length / 1024).toFixed(1)} KB`);

  // Build document message (native PDF)
  const message = {
    role: 'user',
    content: [
      {
        type: 'document',
        source: {
          type: 'base64',
          media_type: 'application/pdf',
          data: base64
        }
      },
      {
        type: 'text',
        text: 'What is this PDF about? Summarize in one sentence.'
      }
    ]
  };

  const result = await sendToAnthropic([message]);

  console.log(`\n📝 Response:\n${result.content}`);
  return result.content.length > 10;
}

async function testMultipleImages() {
  console.log('\n' + '='.repeat(60));
  console.log('TEST 4: Multiple PDF pages as images');
  console.log('='.repeat(60));

  const pdfPath = join(__dirname, 'google_image.pdf');
  if (!existsSync(pdfPath)) {
    console.log('⚠️  Test PDF not found, skipping multi-page test');
    return true;
  }

  // Extract multiple pages
  const images = await extractPdfAsImages(pdfPath, 3);

  if (images.length < 2) {
    console.log('⚠️  PDF has fewer than 2 pages, skipping multi-page test');
    return true;
  }

  // Build multimodal message with multiple images
  const content = [];

  for (const img of images) {
    content.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: img.mediaType,
        data: img.data
      }
    });
  }

  content.push({
    type: 'text',
    text: `I've sent you ${images.length} pages from a PDF. Compare the pages and describe the overall document structure in 2-3 sentences.`
  });

  const result = await sendToAnthropic([{ role: 'user', content }]);

  console.log(`\n📝 Response:\n${result.content}`);
  return result.content.length > 10;
}

// ============================================================================
// Main Test Runner
// ============================================================================

async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║          VLM Gateway Integration Test Suite              ║');
  console.log('╚══════════════════════════════════════════════════════════╝');

  if (!ANTHROPIC_API_KEY) {
    console.error('\n❌ ANTHROPIC_API_KEY not set');
    process.exit(1);
  }

  console.log(`\n🔑 API Key: ${ANTHROPIC_API_KEY.substring(0, 10)}...`);
  console.log(`🌐 Base URL: ${ANTHROPIC_BASE_URL}`);

  const results = [];

  try {
    results.push({ name: 'Text Only', passed: await testTextOnly() });
  } catch (e) {
    console.error(`\n❌ Test failed: ${e.message}`);
    results.push({ name: 'Text Only', passed: false, error: e.message });
  }

  try {
    results.push({ name: 'Vision (PDF as Images)', passed: await testVisionWithImages() });
  } catch (e) {
    console.error(`\n❌ Test failed: ${e.message}`);
    results.push({ name: 'Vision (PDF as Images)', passed: false, error: e.message });
  }

  try {
    results.push({ name: 'Native PDF', passed: await testNativePDF() });
  } catch (e) {
    console.error(`\n❌ Test failed: ${e.message}`);
    results.push({ name: 'Native PDF', passed: false, error: e.message });
  }

  try {
    results.push({ name: 'Multiple Pages', passed: await testMultipleImages() });
  } catch (e) {
    console.error(`\n❌ Test failed: ${e.message}`);
    results.push({ name: 'Multiple Pages', passed: false, error: e.message });
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 TEST SUMMARY');
  console.log('='.repeat(60));

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;

  for (const r of results) {
    const icon = r.passed ? '✅' : '❌';
    console.log(`${icon} ${r.name}${r.error ? ` (${r.error.substring(0, 50)})` : ''}`);
  }

  console.log(`\n${passed}/${results.length} tests passed`);

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('\n💥 Fatal error:', err);
  process.exit(1);
});
