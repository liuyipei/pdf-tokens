/**
 * Anthropic Provider Adapter
 *
 * Transforms canonical gateway format to/from Anthropic's Messages API.
 * Supports Claude 3+ vision models with image and PDF inputs.
 */

import {
  ProviderAdapter,
  ProviderCapabilities,
  ModelCapabilities,
  GatewayRequest,
  GatewayResponse,
  StreamChunk,
  ContentPart,
  TextPart,
  ImagePart,
  PDFPart,
  Message,
  GatewayError,
  TransformError,
} from '../types.js';

// ============================================================================
// Anthropic-specific types
// ============================================================================

interface AnthropicTextBlock {
  type: 'text';
  text: string;
}

interface AnthropicImageBlock {
  type: 'image';
  source: {
    type: 'base64';
    media_type: string;
    data: string;
  };
}

interface AnthropicDocumentBlock {
  type: 'document';
  source: {
    type: 'base64';
    media_type: 'application/pdf';
    data: string;
  };
}

type AnthropicContentBlock = AnthropicTextBlock | AnthropicImageBlock | AnthropicDocumentBlock;

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
}

interface AnthropicRequest {
  model: string;
  max_tokens: number;
  messages: AnthropicMessage[];
  system?: string;
  temperature?: number;
  stream?: boolean;
}

interface AnthropicResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  content: AnthropicContentBlock[];
  model: string;
  stop_reason: 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use';
  stop_sequence: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

// ============================================================================
// Model Capability Definitions
// ============================================================================

const CLAUDE_3_CAPABILITIES: ModelCapabilities = {
  vision: true,
  pdf: true, // Claude 3.5+ supports native PDF
  audio: false,
  video: false,
  tools: true,
  streaming: true,
  maxContextTokens: 200000,
  maxOutputTokens: 8192,
  contentOrdering: {
    imagesFirst: false, // Anthropic allows interleaved content
    separateSystem: true, // System prompt is a separate field
  },
  limits: {
    maxImageSize: 20 * 1024 * 1024, // 20MB
    maxImagesPerMessage: 20,
    maxPdfPages: 100,
    supportedImageFormats: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
  },
};

const CLAUDE_OPUS_CAPABILITIES: ModelCapabilities = {
  ...CLAUDE_3_CAPABILITIES,
  maxOutputTokens: 16384,
};

const MODEL_CAPABILITIES: Record<string, ModelCapabilities> = {
  // Claude 4 / Opus 4
  'claude-opus-4-20250514': CLAUDE_OPUS_CAPABILITIES,
  // Claude Sonnet 4
  'claude-sonnet-4-20250514': CLAUDE_3_CAPABILITIES,
  // Claude 3.7 Sonnet
  'claude-3-7-sonnet-20250219': CLAUDE_3_CAPABILITIES,
  'claude-3-7-sonnet-latest': CLAUDE_3_CAPABILITIES,
  // Claude 3.5 Sonnet
  'claude-3-5-sonnet-20241022': CLAUDE_3_CAPABILITIES,
  'claude-3-5-sonnet-latest': CLAUDE_3_CAPABILITIES,
  'claude-3-5-sonnet-20240620': CLAUDE_3_CAPABILITIES,
  // Claude 3.5 Haiku
  'claude-3-5-haiku-20241022': CLAUDE_3_CAPABILITIES,
  'claude-3-5-haiku-latest': CLAUDE_3_CAPABILITIES,
  // Claude 3 Opus
  'claude-3-opus-20240229': { ...CLAUDE_3_CAPABILITIES, pdf: false },
  'claude-3-opus-latest': { ...CLAUDE_3_CAPABILITIES, pdf: false },
  // Claude 3 Sonnet
  'claude-3-sonnet-20240229': { ...CLAUDE_3_CAPABILITIES, pdf: false },
  // Claude 3 Haiku
  'claude-3-haiku-20240307': { ...CLAUDE_3_CAPABILITIES, pdf: false, maxOutputTokens: 4096 },
};

// ============================================================================
// Anthropic Adapter Implementation
// ============================================================================

export class AnthropicAdapter implements ProviderAdapter {
  readonly id = 'anthropic';
  readonly name = 'Anthropic';

  private apiKey: string;
  private baseUrl: string;
  private defaultModel: string;

  constructor(config?: { apiKey?: string; baseUrl?: string; defaultModel?: string }) {
    this.apiKey = config?.apiKey || process.env.ANTHROPIC_API_KEY || '';
    this.baseUrl = config?.baseUrl || process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com';
    this.defaultModel = config?.defaultModel || 'claude-sonnet-4-20250514';
  }

  isConfigured(): boolean {
    return !!this.apiKey;
  }

  async getCapabilities(): Promise<ProviderCapabilities> {
    return {
      id: this.id,
      name: this.name,
      models: MODEL_CAPABILITIES,
      defaultModel: this.defaultModel,
      baseUrl: this.baseUrl,
    };
  }

  async getModelCapabilities(model: string): Promise<ModelCapabilities> {
    // Try exact match first
    if (MODEL_CAPABILITIES[model]) {
      return MODEL_CAPABILITIES[model];
    }

    // Try pattern matching for aliases
    if (model.includes('opus')) {
      return CLAUDE_OPUS_CAPABILITIES;
    }
    if (model.includes('claude-3')) {
      return CLAUDE_3_CAPABILITIES;
    }

    // Default to base Claude 3 capabilities
    return CLAUDE_3_CAPABILITIES;
  }

  async transformRequest(request: GatewayRequest): Promise<AnthropicRequest> {
    const capabilities = await this.getModelCapabilities(request.model);
    const transformedMessages: AnthropicMessage[] = [];
    let systemPrompt: string | undefined = request.system;

    for (const message of request.messages) {
      // Handle system messages specially
      if (message.role === 'system') {
        if (typeof message.content === 'string') {
          systemPrompt = systemPrompt ? `${systemPrompt}\n\n${message.content}` : message.content;
        }
        continue;
      }

      // Transform user/assistant messages
      const transformed = await this.transformMessage(message, capabilities);
      transformedMessages.push(transformed);
    }

    return {
      model: request.model || this.defaultModel,
      max_tokens: request.maxTokens || capabilities.maxOutputTokens,
      messages: transformedMessages,
      ...(systemPrompt && { system: systemPrompt }),
      ...(request.temperature !== undefined && { temperature: request.temperature }),
      ...(request.stream !== undefined && { stream: request.stream }),
    };
  }

  private async transformMessage(message: Message, capabilities: ModelCapabilities): Promise<AnthropicMessage> {
    // Simple string content
    if (typeof message.content === 'string') {
      return {
        role: message.role as 'user' | 'assistant',
        content: message.content,
      };
    }

    // Array of content parts
    const blocks: AnthropicContentBlock[] = [];

    for (const part of message.content) {
      const block = await this.transformContentPart(part, capabilities);
      if (block) {
        blocks.push(block);
      }
    }

    return {
      role: message.role as 'user' | 'assistant',
      content: blocks.length === 1 && blocks[0].type === 'text'
        ? (blocks[0] as AnthropicTextBlock).text
        : blocks,
    };
  }

  private async transformContentPart(
    part: ContentPart,
    capabilities: ModelCapabilities
  ): Promise<AnthropicContentBlock | null> {
    switch (part.type) {
      case 'text':
        return { type: 'text', text: part.text };

      case 'image':
        if (!capabilities.vision) {
          throw new TransformError(
            `Model does not support vision/image input`,
            this.id
          );
        }
        return {
          type: 'image',
          source: {
            type: 'base64',
            media_type: part.mediaType,
            data: part.data,
          },
        };

      case 'pdf':
        if (capabilities.pdf) {
          // Native PDF support
          return {
            type: 'document',
            source: {
              type: 'base64',
              media_type: 'application/pdf',
              data: part.data,
            },
          };
        } else {
          // For models without native PDF support, caller should pre-convert to images
          throw new TransformError(
            `Model does not support native PDF input. Convert to images first.`,
            this.id
          );
        }

      case 'audio':
        throw new TransformError(`Anthropic does not support audio input`, this.id);

      case 'video':
        throw new TransformError(`Anthropic does not support video input`, this.id);

      default:
        throw new TransformError(`Unknown content part type: ${(part as ContentPart).type}`, this.id);
    }
  }

  transformResponse(
    response: unknown,
    request: GatewayRequest,
    timing: { startTime: number; endTime: number }
  ): GatewayResponse {
    const anthResponse = response as AnthropicResponse;

    // Transform content blocks back to canonical format
    const content: ContentPart[] = anthResponse.content.map(block => {
      if (block.type === 'text') {
        return { type: 'text', text: block.text } as TextPart;
      }
      // Handle other block types if needed
      return { type: 'text', text: `[Unsupported block type: ${block.type}]` } as TextPart;
    });

    // Map stop reason
    const stopReasonMap: Record<string, GatewayResponse['stopReason']> = {
      'end_turn': 'end_turn',
      'max_tokens': 'max_tokens',
      'stop_sequence': 'stop_sequence',
      'tool_use': 'tool_use',
    };

    return {
      id: anthResponse.id,
      provider: this.id,
      model: anthResponse.model,
      content,
      stopReason: stopReasonMap[anthResponse.stop_reason] || 'end_turn',
      usage: {
        inputTokens: anthResponse.usage.input_tokens,
        outputTokens: anthResponse.usage.output_tokens,
      },
      timing: {
        startTime: timing.startTime,
        endTime: timing.endTime,
        durationMs: timing.endTime - timing.startTime,
      },
      raw: anthResponse,
    };
  }

  async send(request: GatewayRequest): Promise<GatewayResponse> {
    if (!this.isConfigured()) {
      throw new GatewayError('Anthropic API key not configured', 'NOT_CONFIGURED', this.id);
    }

    const startTime = Date.now();
    const anthropicRequest = await this.transformRequest(request);

    const response = await fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(anthropicRequest),
    });

    const endTime = Date.now();

    if (!response.ok) {
      const errorBody = await response.text();
      let errorMessage = `Anthropic API error: ${response.status}`;
      try {
        const errorJson = JSON.parse(errorBody);
        errorMessage = errorJson.error?.message || errorMessage;
      } catch {
        // Use default message
      }
      throw new GatewayError(errorMessage, 'API_ERROR', this.id, response.status, errorBody);
    }

    const anthropicResponse = await response.json();
    return this.transformResponse(anthropicResponse, request, { startTime, endTime });
  }

  async *sendStream(request: GatewayRequest): AsyncGenerator<StreamChunk, GatewayResponse, undefined> {
    if (!this.isConfigured()) {
      throw new GatewayError('Anthropic API key not configured', 'NOT_CONFIGURED', this.id);
    }

    const startTime = Date.now();
    const anthropicRequest = await this.transformRequest({ ...request, stream: true });

    const response = await fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(anthropicRequest),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new GatewayError(`Anthropic API error: ${response.status}`, 'API_ERROR', this.id, response.status, errorBody);
    }

    if (!response.body) {
      throw new GatewayError('No response body for streaming', 'STREAM_ERROR', this.id);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullResponse: AnthropicResponse | null = null;
    let inputTokens = 0;
    let outputTokens = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') continue;

            try {
              const event = JSON.parse(data);

              switch (event.type) {
                case 'message_start':
                  fullResponse = event.message;
                  if (event.message?.usage?.input_tokens) {
                    inputTokens = event.message.usage.input_tokens;
                  }
                  yield { type: 'message_start' };
                  break;

                case 'content_block_start':
                  yield { type: 'content_block_start' };
                  break;

                case 'content_block_delta':
                  if (event.delta?.type === 'text_delta') {
                    yield { type: 'text_delta', text: event.delta.text };
                  }
                  break;

                case 'content_block_stop':
                  yield { type: 'content_block_stop' };
                  break;

                case 'message_delta':
                  if (event.usage?.output_tokens) {
                    outputTokens = event.usage.output_tokens;
                  }
                  if (fullResponse && event.delta?.stop_reason) {
                    fullResponse.stop_reason = event.delta.stop_reason;
                  }
                  break;

                case 'message_stop':
                  yield { type: 'message_stop', usage: { inputTokens, outputTokens } };
                  break;
              }
            } catch {
              // Skip malformed JSON
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    const endTime = Date.now();

    // Return final response
    if (fullResponse) {
      fullResponse.usage = { input_tokens: inputTokens, output_tokens: outputTokens };
      return this.transformResponse(fullResponse, request, { startTime, endTime });
    }

    throw new GatewayError('Stream ended without complete response', 'STREAM_ERROR', this.id);
  }
}
