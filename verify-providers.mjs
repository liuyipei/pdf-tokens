/**
 * VLM Provider Connectivity Verification Script
 * Tests connectivity and basic vision capabilities across providers
 */

const providers = {
  anthropic: {
    name: 'Anthropic (Claude)',
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
    apiKey: process.env.ANTHROPIC_API_KEY,
    testModel: 'claude-sonnet-4-20250514'
  },
  openai: {
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com',
    apiKey: process.env.OPENAI_API_KEY,
    modelsEndpoint: '/v1/models',
    testModel: 'gpt-4o-mini'
  },
  fireworks: {
    name: 'Fireworks AI',
    baseUrl: 'https://api.fireworks.ai',
    apiKey: process.env.FIREWORKS_API_KEY,
    modelsEndpoint: '/inference/v1/models',
    testModel: 'accounts/fireworks/models/llama-v3p1-8b-instruct'
  },
  openrouter: {
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api',
    apiKey: process.env.OPENROUTER_API_KEY,
    modelsEndpoint: '/v1/models',
    testModel: 'anthropic/claude-3.5-sonnet'
  }
};

async function testProvider(id, config) {
  const divider = '='.repeat(60);
  console.log(`\n${divider}`);
  console.log(`Testing: ${config.name}`);
  console.log(divider);

  if (!config.apiKey) {
    console.log(`❌ No API key found for ${config.name}`);
    return { provider: id, status: 'no_key', models: [] };
  }

  console.log(`✓ API key present`);
  console.log(`  Base URL: ${config.baseUrl}`);

  try {
    // For Anthropic, we need to test differently since they don't have a models list endpoint
    if (id === 'anthropic') {
      const response = await fetch(`${config.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': config.apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: config.testModel,
          max_tokens: 10,
          messages: [{ role: 'user', content: 'Say "hello"' }]
        })
      });

      if (response.ok) {
        const data = await response.json();
        console.log(`✓ Connection successful!`);
        console.log(`  Model: ${config.testModel}`);
        const text = data.content?.[0]?.text || 'OK';
        console.log(`  Response: ${text.substring(0, 50)}`);
        return { provider: id, status: 'connected', models: [config.testModel] };
      } else {
        const error = await response.text();
        console.log(`❌ Connection failed: ${response.status}`);
        console.log(`  Error: ${error.substring(0, 200)}`);
        return { provider: id, status: 'error', error: error.substring(0, 100) };
      }
    }

    // For OpenAI-compatible APIs
    const headers = {
      'Authorization': `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json'
    };

    if (id === 'openrouter') {
      headers['HTTP-Referer'] = 'https://github.com/pdf-tokens';
    }

    const modelsUrl = `${config.baseUrl}${config.modelsEndpoint}`;
    console.log(`  Fetching models from: ${modelsUrl}`);

    const response = await fetch(modelsUrl, { headers });

    if (response.ok) {
      const data = await response.json();
      const models = data.data || data.models || [];
      const visionModels = models.filter(m => {
        const modelId = (m.id || '').toLowerCase();
        return modelId.includes('vision') || modelId.includes('4o') ||
               modelId.includes('gpt-4-turbo') || modelId.includes('llava') ||
               modelId.includes('claude-3') || modelId.includes('gemini') ||
               modelId.includes('pixtral') || modelId.includes('llama-3.2');
      });

      console.log(`✓ Connection successful!`);
      console.log(`  Total models: ${models.length}`);
      console.log(`  Vision-capable (estimated): ${visionModels.length}`);
      if (visionModels.length > 0) {
        console.log(`  Sample vision models:`);
        visionModels.slice(0, 5).forEach(m => console.log(`    - ${m.id}`));
      }

      return {
        provider: id,
        status: 'connected',
        totalModels: models.length,
        visionModels: visionModels.map(m => m.id).slice(0, 10)
      };
    } else {
      const error = await response.text();
      console.log(`❌ Connection failed: ${response.status}`);
      console.log(`  Error: ${error.substring(0, 200)}`);
      return { provider: id, status: 'error', error: error.substring(0, 100) };
    }
  } catch (err) {
    console.log(`❌ Network error: ${err.message}`);
    return { provider: id, status: 'network_error', error: err.message };
  }
}

async function main() {
  console.log('VLM Provider Connectivity Verification');
  console.log('======================================\n');

  const results = [];

  for (const [id, config] of Object.entries(providers)) {
    results.push(await testProvider(id, config));
  }

  const divider = '='.repeat(60);
  console.log(`\n\n📊 SUMMARY`);
  console.log(divider);

  const connected = results.filter(r => r.status === 'connected');
  const failed = results.filter(r => r.status !== 'connected');

  console.log(`\n✓ Connected: ${connected.length}/${results.length} providers`);
  connected.forEach(r => console.log(`  - ${r.provider}`));

  if (failed.length > 0) {
    console.log(`\n❌ Failed: ${failed.length}/${results.length} providers`);
    failed.forEach(r => console.log(`  - ${r.provider}: ${r.status}`));
  }

  console.log('\n');
  return results;
}

main().catch(console.error);
