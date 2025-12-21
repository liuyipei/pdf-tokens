/**
 * OpenAI Provider Adapter
 *
 * Transforms canonical gateway format to/from OpenAI's Chat Completions API.
 * Supports GPT-4 Vision models with image inputs.
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
  Message,
  GatewayError,
  TransformError,
} from '../types.js';

// ============================================================================
// OpenAI-specific types
// ============================================================================

interface OpenAITextContent {
  type: 'text';
  text: string;
}

interface OpenAIImageContent {
  type: 'image_url';
  image_url: {
    url: string;
    detail?: 'auto' | 'low' | 'high';
  };
}

type OpenAIContent = OpenAITextContent | OpenAIImageContent;

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | OpenAIContent[];
}

interface OpenAIRequest {
  model: string;
  messages: OpenAIMessage[];
  max_tokens?: number;
  temperature?: number;
  stream?: boolean;
}

interface OpenAIResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: 'assistant';
      content: string;
    };
    finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter';
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// ============================================================================
// Model Capability Definitions
// ============================================================================

const GPT4_VISION_CAPABILITIES: ModelCapabilities = {
  vision: true,
  pdf: false, // OpenAI doesn't support native PDF
  audio: false, // GPT-4o has audio but different API
  video: false,
  tools: true,
  streaming: true,
  maxContextTokens: 128000,
  maxOutputTokens: 4096,
  contentOrdering: {
    imagesFirst: false, // OpenAI allows interleaved content
    separateSystem: false, // System is a message role
  },
  limits: {
    maxImageSize: 20 * 1024 * 1024, // 20MB
    maxImagesPerMessage: 10,
    supportedImageFormats: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
  },
};

const GPT4O_CAPABILITIES: ModelCapabilities = {
  ...GPT4_VISION_CAPABILITIES,
  maxOutputTokens: 16384,
};

const GPT4O_MINI_CAPABILITIES: ModelCapabilities = {
  ...GPT4_VISION_CAPABILITIES,
  maxContextTokens: 128000,
  maxOutputTokens: 16384,
};

const MODEL_CAPABILITIES: Record<string, ModelCapabilities> = {
  // GPT-4o family
  'gpt-4o': GPT4O_CAPABILITIES,
  'gpt-4o-2024-11-20': GPT4O_CAPABILITIES,
  'gpt-4o-2024-08-06': GPT4O_CAPABILITIES,
  'gpt-4o-2024-05-13': GPT4O_CAPABILITIES,
  // GPT-4o mini
  'gpt-4o-mini': GPT4O_MINI_CAPABILITIES,
  'gpt-4o-mini-2024-07-18': GPT4O_MINI_CAPABILITIES,
  // GPT-4 Turbo Vision
  'gpt-4-turbo': GPT4_VISION_CAPABILITIES,
  'gpt-4-turbo-2024-04-09': GPT4_VISION_CAPABILITIES,
  'gpt-4-vision-preview': GPT4_VISION_CAPABILITIES,
  // o1 models (limited vision)
  'o1': { ...GPT4O_CAPABILITIES, maxOutputTokens: 100000, maxContextTokens: 200000 },
  'o1-preview': { ...GPT4O_CAPABILITIES, maxOutputTokens: 32768 },
  'o1-mini': { ...GPT4O_MINI_CAPABILITIES, vision: false },
};

// ============================================================================
// OpenAI Adapter Implementation
// ============================================================================

export class OpenAIAdapter implements ProviderAdapter {
  readonly id = 'openai';
  readonly name = 'OpenAI';

  private apiKey: string;
  private baseUrl: string;
  private defaultModel: string;

  constructor(config?: { apiKey?: string; baseUrl?: string; defaultModel?: string }) {
    this.apiKey = config?.apiKey || process.env.OPENAI_API_KEY || '';
    this.baseUrl = config?.baseUrl || 'https://api.openai.com';
    this.defaultModel = config?.defaultModel || 'gpt-4o-mini';
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
    if (MODEL_CAPABILITIES[model]) {
      return MODEL_CAPABILITIES[model];
    }

    // Pattern matching for model families
    if (model.startsWith('gpt-4o-mini')) {
      return GPT4O_MINI_CAPABILITIES;
    }
    if (model.startsWith('gpt-4o') || model.startsWith('gpt-4-turbo')) {
      return GPT4O_CAPABILITIES;
    }
    if (model.startsWith('o1')) {
      return GPT4O_CAPABILITIES;
    }

    // Default to basic vision capabilities
    return GPT4_VISION_CAPABILITIES;
  }

  async transformRequest(request: GatewayRequest): Promise<OpenAIRequest> {
    const capabilities = await this.getModelCapabilities(request.model);
    const messages: OpenAIMessage[] = [];

    // Add system message if present
    if (request.system) {
      messages.push({ role: 'system', content: request.system });
    }

    for (const message of request.messages) {
      const transformed = await this.transformMessage(message, capabilities);
      messages.push(transformed);
    }

    return {
      model: request.model || this.defaultModel,
      messages,
      ...(request.maxTokens && { max_tokens: request.maxTokens }),
      ...(request.temperature !== undefined && { temperature: request.temperature }),
      ...(request.stream !== undefined && { stream: request.stream }),
    };
  }

  private async transformMessage(message: Message, capabilities: ModelCapabilities): Promise<OpenAIMessage> {
    // Simple string content
    if (typeof message.content === 'string') {
      return {
        role: message.role as 'system' | 'user' | 'assistant',
        content: message.content,
      };
    }

    // Array of content parts
    const parts: OpenAIContent[] = [];

    for (const part of message.content) {
      const transformed = await this.transformContentPart(part, capabilities);
      if (transformed) {
        parts.push(transformed);
      }
    }

    // OpenAI allows string content for simple messages
    if (parts.length === 1 && parts[0].type === 'text') {
      return {
        role: message.role as 'system' | 'user' | 'assistant',
        content: parts[0].text,
      };
    }

    return {
      role: message.role as 'system' | 'user' | 'assistant',
      content: parts,
    };
  }

  private async transformContentPart(
    part: ContentPart,
    capabilities: ModelCapabilities
  ): Promise<OpenAIContent | null> {
    switch (part.type) {
      case 'text':
        return { type: 'text', text: part.text };

      case 'image':
        if (!capabilities.vision) {
          throw new TransformError(`Model does not support vision/image input`, this.id);
        }
        // OpenAI expects data URLs
        const dataUrl = `data:${part.mediaType};base64,${part.data}`;
        return {
          type: 'image_url',
          image_url: { url: dataUrl, detail: 'auto' },
        };

      case 'pdf':
        throw new TransformError(
          `OpenAI does not support native PDF input. Convert to images first.`,
          this.id
        );

      case 'audio':
        throw new TransformError(`OpenAI Chat API does not support audio input`, this.id);

      case 'video':
        throw new TransformError(`OpenAI does not support video input`, this.id);

      default:
        throw new TransformError(`Unknown content part type: ${(part as ContentPart).type}`, this.id);
    }
  }

  transformResponse(
    response: unknown,
    request: GatewayRequest,
    timing: { startTime: number; endTime: number }
  ): GatewayResponse {
    const oaiResponse = response as OpenAIResponse;
    const choice = oaiResponse.choices[0];

    const content: ContentPart[] = [
      { type: 'text', text: choice?.message?.content || '' } as TextPart,
    ];

    const stopReasonMap: Record<string, GatewayResponse['stopReason']> = {
      'stop': 'end_turn',
      'length': 'max_tokens',
      'tool_calls': 'tool_use',
      'content_filter': 'end_turn',
    };

    return {
      id: oaiResponse.id,
      provider: this.id,
      model: oaiResponse.model,
      content,
      stopReason: stopReasonMap[choice?.finish_reason] || 'end_turn',
      usage: {
        inputTokens: oaiResponse.usage?.prompt_tokens || 0,
        outputTokens: oaiResponse.usage?.completion_tokens || 0,
      },
      timing: {
        startTime: timing.startTime,
        endTime: timing.endTime,
        durationMs: timing.endTime - timing.startTime,
      },
      raw: oaiResponse,
    };
  }

  async send(request: GatewayRequest): Promise<GatewayResponse> {
    if (!this.isConfigured()) {
      throw new GatewayError('OpenAI API key not configured', 'NOT_CONFIGURED', this.id);
    }

    const startTime = Date.now();
    const openaiRequest = await this.transformRequest(request);

    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(openaiRequest),
    });

    const endTime = Date.now();

    if (!response.ok) {
      const errorBody = await response.text();
      let errorMessage = `OpenAI API error: ${response.status}`;
      try {
        const errorJson = JSON.parse(errorBody);
        errorMessage = errorJson.error?.message || errorMessage;
      } catch {
        // Use default message
      }
      throw new GatewayError(errorMessage, 'API_ERROR', this.id, response.status, errorBody);
    }

    const openaiResponse = await response.json();
    return this.transformResponse(openaiResponse, request, { startTime, endTime });
  }

  async *sendStream(request: GatewayRequest): AsyncGenerator<StreamChunk, GatewayResponse, undefined> {
    if (!this.isConfigured()) {
      throw new GatewayError('OpenAI API key not configured', 'NOT_CONFIGURED', this.id);
    }

    const startTime = Date.now();
    const openaiRequest = await this.transformRequest({ ...request, stream: true });

    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(openaiRequest),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new GatewayError(`OpenAI API error: ${response.status}`, 'API_ERROR', this.id, response.status, errorBody);
    }

    if (!response.body) {
      throw new GatewayError('No response body for streaming', 'STREAM_ERROR', this.id);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullContent = '';
    let finishReason = 'stop';

    try {
      yield { type: 'message_start' };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();
            if (data === '[DONE]') continue;

            try {
              const chunk = JSON.parse(data);
              const delta = chunk.choices?.[0]?.delta;

              if (delta?.content) {
                fullContent += delta.content;
                yield { type: 'text_delta', text: delta.content };
              }

              if (chunk.choices?.[0]?.finish_reason) {
                finishReason = chunk.choices[0].finish_reason;
              }
            } catch {
              // Skip malformed JSON
            }
          }
        }
      }

      yield { type: 'message_stop' };
    } finally {
      reader.releaseLock();
    }

    const endTime = Date.now();

    // Construct synthetic response
    const syntheticResponse: OpenAIResponse = {
      id: `stream-${startTime}`,
      object: 'chat.completion',
      created: Math.floor(startTime / 1000),
      model: request.model || this.defaultModel,
      choices: [{
        index: 0,
        message: { role: 'assistant', content: fullContent },
        finish_reason: finishReason as OpenAIResponse['choices'][0]['finish_reason'],
      }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    };

    return this.transformResponse(syntheticResponse, request, { startTime, endTime });
  }
}
