/**
 * VLM Gateway
 *
 * Unified API gateway for Vision-Language Models across providers.
 * Handles routing, capability detection, content transformation, and fallbacks.
 */

import {
  ProviderAdapter,
  ProviderCapabilities,
  ModelCapabilities,
  GatewayRequest,
  GatewayResponse,
  StreamChunk,
  GatewayConfig,
  GatewayError,
  CapabilityError,
  ContentPart,
  ImagePart,
  PDFPart,
} from './types.js';
import { AnthropicAdapter } from './adapters/anthropic.js';
import { OpenAIAdapter } from './adapters/openai.js';

// ============================================================================
// Gateway Implementation
// ============================================================================

export class VLMGateway {
  private adapters: Map<string, ProviderAdapter> = new Map();
  private capabilityCache: Map<string, ProviderCapabilities> = new Map();
  private config: GatewayConfig;

  constructor(config?: Partial<GatewayConfig>) {
    this.config = {
      providers: config?.providers || {},
      defaultProvider: config?.defaultProvider || 'anthropic',
      debug: config?.debug || false,
      retry: config?.retry || {
        maxRetries: 3,
        backoffMs: 1000,
        backoffMultiplier: 2,
      },
    };

    this.initializeAdapters();
  }

  private initializeAdapters(): void {
    // Initialize Anthropic adapter
    const anthropicConfig = this.config.providers.anthropic || {};
    this.adapters.set('anthropic', new AnthropicAdapter({
      apiKey: anthropicConfig.apiKey,
      baseUrl: anthropicConfig.baseUrl,
      defaultModel: anthropicConfig.defaultModel,
    }));

    // Initialize OpenAI adapter
    const openaiConfig = this.config.providers.openai || {};
    this.adapters.set('openai', new OpenAIAdapter({
      apiKey: openaiConfig.apiKey,
      baseUrl: openaiConfig.baseUrl,
      defaultModel: openaiConfig.defaultModel,
    }));
  }

  /**
   * Get a provider adapter by ID
   */
  getAdapter(providerId: string): ProviderAdapter | undefined {
    return this.adapters.get(providerId);
  }

  /**
   * List all available providers
   */
  listProviders(): string[] {
    return Array.from(this.adapters.keys());
  }

  /**
   * List configured (ready to use) providers
   */
  listConfiguredProviders(): string[] {
    return this.listProviders().filter(id => {
      const adapter = this.adapters.get(id);
      return adapter?.isConfigured() ?? false;
    });
  }

  /**
   * Get capabilities for a provider
   */
  async getProviderCapabilities(providerId: string): Promise<ProviderCapabilities> {
    // Check cache first
    if (this.capabilityCache.has(providerId)) {
      return this.capabilityCache.get(providerId)!;
    }

    const adapter = this.adapters.get(providerId);
    if (!adapter) {
      throw new GatewayError(`Unknown provider: ${providerId}`, 'UNKNOWN_PROVIDER');
    }

    const capabilities = await adapter.getCapabilities();
    this.capabilityCache.set(providerId, capabilities);
    return capabilities;
  }

  /**
   * Get capabilities for a specific model
   */
  async getModelCapabilities(providerId: string, model: string): Promise<ModelCapabilities> {
    const adapter = this.adapters.get(providerId);
    if (!adapter) {
      throw new GatewayError(`Unknown provider: ${providerId}`, 'UNKNOWN_PROVIDER');
    }
    return adapter.getModelCapabilities(model);
  }

  /**
   * Validate request against model capabilities
   */
  async validateRequest(request: GatewayRequest): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];
    const capabilities = await this.getModelCapabilities(request.provider, request.model);

    // Check for content types that require specific capabilities
    for (const message of request.messages) {
      if (typeof message.content === 'string') continue;

      for (const part of message.content) {
        switch (part.type) {
          case 'image':
            if (!capabilities.vision) {
              errors.push(`Model ${request.model} does not support image input`);
            }
            break;
          case 'pdf':
            if (!capabilities.pdf) {
              errors.push(`Model ${request.model} does not support native PDF input`);
            }
            break;
          case 'audio':
            if (!capabilities.audio) {
              errors.push(`Model ${request.model} does not support audio input`);
            }
            break;
          case 'video':
            if (!capabilities.video) {
              errors.push(`Model ${request.model} does not support video input`);
            }
            break;
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Find a provider that can handle the given content types
   */
  async findCapableProvider(
    contentTypes: Array<ContentPart['type']>,
    preferredProvider?: string
  ): Promise<{ provider: string; model: string } | null> {
    const providers = this.listConfiguredProviders();

    // Try preferred provider first
    if (preferredProvider && providers.includes(preferredProvider)) {
      const caps = await this.getProviderCapabilities(preferredProvider);
      const model = await this.findCapableModel(preferredProvider, contentTypes);
      if (model) {
        return { provider: preferredProvider, model };
      }
    }

    // Try other providers
    for (const providerId of providers) {
      if (providerId === preferredProvider) continue;
      const model = await this.findCapableModel(providerId, contentTypes);
      if (model) {
        return { provider: providerId, model };
      }
    }

    return null;
  }

  private async findCapableModel(
    providerId: string,
    contentTypes: Array<ContentPart['type']>
  ): Promise<string | null> {
    const capabilities = await this.getProviderCapabilities(providerId);

    for (const [modelId, modelCaps] of Object.entries(capabilities.models)) {
      let capable = true;
      for (const type of contentTypes) {
        switch (type) {
          case 'image':
            if (!modelCaps.vision) capable = false;
            break;
          case 'pdf':
            if (!modelCaps.pdf) capable = false;
            break;
          case 'audio':
            if (!modelCaps.audio) capable = false;
            break;
          case 'video':
            if (!modelCaps.video) capable = false;
            break;
        }
      }
      if (capable) return modelId;
    }

    return null;
  }

  /**
   * Send a request to a provider
   */
  async send(request: GatewayRequest): Promise<GatewayResponse> {
    const adapter = this.adapters.get(request.provider);
    if (!adapter) {
      throw new GatewayError(`Unknown provider: ${request.provider}`, 'UNKNOWN_PROVIDER');
    }

    if (!adapter.isConfigured()) {
      throw new GatewayError(
        `Provider ${request.provider} is not configured`,
        'NOT_CONFIGURED',
        request.provider
      );
    }

    // Validate request
    const validation = await this.validateRequest(request);
    if (!validation.valid) {
      throw new CapabilityError(
        validation.errors.join('; '),
        'vision', // Most common capability issue
        request.model,
        request.provider
      );
    }

    if (this.config.debug) {
      console.log(`[VLM Gateway] Sending request to ${request.provider}/${request.model}`);
    }

    // Send with retry logic
    let lastError: Error | null = null;
    const { maxRetries, backoffMs, backoffMultiplier } = this.config.retry!;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await adapter.send(request);

        if (this.config.debug) {
          console.log(`[VLM Gateway] Response received in ${response.timing.durationMs}ms`);
          console.log(`[VLM Gateway] Tokens: ${response.usage.inputTokens} in / ${response.usage.outputTokens} out`);
        }

        return response;
      } catch (error) {
        lastError = error as Error;

        // Don't retry client errors (4xx)
        if (error instanceof GatewayError && error.statusCode && error.statusCode < 500) {
          throw error;
        }

        if (attempt < maxRetries) {
          const delay = backoffMs * Math.pow(backoffMultiplier, attempt);
          if (this.config.debug) {
            console.log(`[VLM Gateway] Retry ${attempt + 1}/${maxRetries} after ${delay}ms`);
          }
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError;
  }

  /**
   * Send a streaming request
   */
  async *sendStream(request: GatewayRequest): AsyncGenerator<StreamChunk, GatewayResponse, undefined> {
    const adapter = this.adapters.get(request.provider);
    if (!adapter) {
      throw new GatewayError(`Unknown provider: ${request.provider}`, 'UNKNOWN_PROVIDER');
    }

    if (!adapter.isConfigured()) {
      throw new GatewayError(
        `Provider ${request.provider} is not configured`,
        'NOT_CONFIGURED',
        request.provider
      );
    }

    // Validate request
    const validation = await this.validateRequest(request);
    if (!validation.valid) {
      throw new CapabilityError(
        validation.errors.join('; '),
        'vision',
        request.model,
        request.provider
      );
    }

    if (this.config.debug) {
      console.log(`[VLM Gateway] Starting stream to ${request.provider}/${request.model}`);
    }

    const generator = adapter.sendStream(request);
    let result: GatewayResponse;

    while (true) {
      const { value, done } = await generator.next();
      if (done) {
        result = value;
        break;
      }
      yield value;
    }

    if (this.config.debug) {
      console.log(`[VLM Gateway] Stream completed in ${result.timing.durationMs}ms`);
    }

    return result;
  }

  /**
   * Helper: Create a simple text request
   */
  createTextRequest(
    prompt: string,
    options?: {
      provider?: string;
      model?: string;
      system?: string;
      maxTokens?: number;
      temperature?: number;
    }
  ): GatewayRequest {
    return {
      provider: options?.provider || this.config.defaultProvider,
      model: options?.model || '',
      messages: [{ role: 'user', content: prompt }],
      system: options?.system,
      maxTokens: options?.maxTokens,
      temperature: options?.temperature,
    };
  }

  /**
   * Helper: Create a vision request with images
   */
  createVisionRequest(
    prompt: string,
    images: Array<{ data: string; mediaType: ImagePart['mediaType'] }>,
    options?: {
      provider?: string;
      model?: string;
      system?: string;
      maxTokens?: number;
    }
  ): GatewayRequest {
    const content: ContentPart[] = [
      ...images.map(img => ({
        type: 'image' as const,
        data: img.data,
        mediaType: img.mediaType,
      })),
      { type: 'text' as const, text: prompt },
    ];

    return {
      provider: options?.provider || this.config.defaultProvider,
      model: options?.model || '',
      messages: [{ role: 'user', content }],
      system: options?.system,
      maxTokens: options?.maxTokens,
    };
  }

  /**
   * Helper: Create a PDF analysis request
   */
  createPDFRequest(
    prompt: string,
    pdf: { data: string; filename?: string; pageRange?: { start: number; end: number } },
    options?: {
      provider?: string;
      model?: string;
      system?: string;
      maxTokens?: number;
    }
  ): GatewayRequest {
    const content: ContentPart[] = [
      {
        type: 'pdf' as const,
        data: pdf.data,
        filename: pdf.filename,
        pageRange: pdf.pageRange,
      },
      { type: 'text' as const, text: prompt },
    ];

    return {
      provider: options?.provider || this.config.defaultProvider,
      model: options?.model || '',
      messages: [{ role: 'user', content }],
      system: options?.system,
      maxTokens: options?.maxTokens,
    };
  }
}

// ============================================================================
// Convenience exports
// ============================================================================

export { GatewayRequest, GatewayResponse, ContentPart, Message } from './types.js';
