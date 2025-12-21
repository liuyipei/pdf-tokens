/**
 * VLM Gateway - Canonical Types
 *
 * These types define the unified internal format for multimodal messages.
 * All provider adapters transform to/from this canonical format.
 */

// ============================================================================
// Content Parts - The building blocks of multimodal messages
// ============================================================================

export interface TextPart {
  type: 'text';
  text: string;
}

export interface ImagePart {
  type: 'image';
  /** Base64-encoded image data (without data URL prefix) */
  data: string;
  /** MIME type of the image */
  mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
  /** Optional source information for debugging */
  source?: {
    type: 'file' | 'url' | 'generated';
    path?: string;
    url?: string;
  };
}

export interface PDFPart {
  type: 'pdf';
  /** Base64-encoded PDF data */
  data: string;
  /** Page range to process (1-indexed, inclusive) */
  pageRange?: { start: number; end: number };
  /** Optional filename for context */
  filename?: string;
}

export interface AudioPart {
  type: 'audio';
  /** Base64-encoded audio data */
  data: string;
  /** MIME type of the audio */
  mediaType: 'audio/wav' | 'audio/mp3' | 'audio/mpeg' | 'audio/ogg';
}

export interface VideoPart {
  type: 'video';
  /** Base64-encoded video data */
  data: string;
  /** MIME type of the video */
  mediaType: 'video/mp4' | 'video/webm';
}

/** Union of all content part types */
export type ContentPart = TextPart | ImagePart | PDFPart | AudioPart | VideoPart;

// ============================================================================
// Messages - The conversation structure
// ============================================================================

export type MessageRole = 'user' | 'assistant' | 'system';

export interface Message {
  role: MessageRole;
  /** Content can be a simple string or array of typed parts */
  content: string | ContentPart[];
}

// ============================================================================
// Request/Response - Gateway API
// ============================================================================

export interface GatewayRequest {
  /** Provider to use (e.g., 'anthropic', 'openai', 'fireworks') */
  provider: string;
  /** Model identifier */
  model: string;
  /** Conversation messages */
  messages: Message[];
  /** System prompt (optional, extracted for providers that need it separate) */
  system?: string;
  /** Maximum tokens to generate */
  maxTokens?: number;
  /** Temperature for sampling (0-1) */
  temperature?: number;
  /** Whether to stream the response */
  stream?: boolean;
  /** Optional request metadata */
  metadata?: Record<string, unknown>;
}

export interface GatewayResponse {
  /** Unique response ID */
  id: string;
  /** Provider that handled the request */
  provider: string;
  /** Model that generated the response */
  model: string;
  /** Generated content */
  content: ContentPart[];
  /** Stop reason */
  stopReason: 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use' | 'error';
  /** Token usage statistics */
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
  /** Response timing */
  timing: {
    startTime: number;
    endTime: number;
    durationMs: number;
  };
  /** Raw provider response for debugging */
  raw?: unknown;
}

export interface StreamChunk {
  type: 'text_delta' | 'content_block_start' | 'content_block_stop' | 'message_start' | 'message_stop' | 'error';
  text?: string;
  error?: string;
  /** Partial usage info (may only be complete at end) */
  usage?: Partial<GatewayResponse['usage']>;
}

// ============================================================================
// Capabilities - What can a model do?
// ============================================================================

export interface ModelCapabilities {
  /** Supports image input */
  vision: boolean;
  /** Supports native PDF input (not just images) */
  pdf: boolean;
  /** Supports audio input */
  audio: boolean;
  /** Supports video input */
  video: boolean;
  /** Supports tool/function calling */
  tools: boolean;
  /** Supports streaming responses */
  streaming: boolean;
  /** Maximum context window in tokens */
  maxContextTokens: number;
  /** Maximum output tokens */
  maxOutputTokens: number;
  /** Content ordering requirements */
  contentOrdering?: {
    /** Must images come before text? */
    imagesFirst?: boolean;
    /** Must system be separate from messages? */
    separateSystem?: boolean;
  };
  /** Size limits */
  limits?: {
    maxImageSize?: number; // bytes
    maxImagesPerMessage?: number;
    maxPdfPages?: number;
    supportedImageFormats?: string[];
  };
}

export interface ProviderCapabilities {
  /** Provider identifier */
  id: string;
  /** Human-readable name */
  name: string;
  /** Supported models and their capabilities */
  models: Record<string, ModelCapabilities>;
  /** Default model for this provider */
  defaultModel: string;
  /** API base URL */
  baseUrl: string;
}

// ============================================================================
// Provider Adapter Interface
// ============================================================================

export interface ProviderAdapter {
  /** Unique provider identifier */
  readonly id: string;
  /** Human-readable provider name */
  readonly name: string;

  /** Check if the provider is configured (has API key, etc.) */
  isConfigured(): boolean;

  /** Get capabilities for this provider */
  getCapabilities(): Promise<ProviderCapabilities>;

  /** Get capabilities for a specific model */
  getModelCapabilities(model: string): Promise<ModelCapabilities>;

  /** Transform canonical request to provider format */
  transformRequest(request: GatewayRequest): Promise<unknown>;

  /** Transform provider response to canonical format */
  transformResponse(response: unknown, request: GatewayRequest, timing: { startTime: number; endTime: number }): GatewayResponse;

  /** Send a request to the provider */
  send(request: GatewayRequest): Promise<GatewayResponse>;

  /** Send a streaming request */
  sendStream(request: GatewayRequest): AsyncGenerator<StreamChunk, GatewayResponse, undefined>;
}

// ============================================================================
// Gateway Configuration
// ============================================================================

export interface GatewayConfig {
  /** Provider configurations */
  providers: {
    [providerId: string]: {
      apiKey?: string;
      baseUrl?: string;
      enabled?: boolean;
      defaultModel?: string;
    };
  };
  /** Default provider to use */
  defaultProvider: string;
  /** Enable request/response logging */
  debug?: boolean;
  /** Retry configuration */
  retry?: {
    maxRetries: number;
    backoffMs: number;
    backoffMultiplier: number;
  };
}

// ============================================================================
// Errors
// ============================================================================

export class GatewayError extends Error {
  constructor(
    message: string,
    public code: string,
    public provider?: string,
    public statusCode?: number,
    public raw?: unknown
  ) {
    super(message);
    this.name = 'GatewayError';
  }
}

export class CapabilityError extends GatewayError {
  constructor(
    message: string,
    public requiredCapability: keyof ModelCapabilities,
    public model: string,
    provider?: string
  ) {
    super(message, 'CAPABILITY_ERROR', provider);
    this.name = 'CapabilityError';
  }
}

export class TransformError extends GatewayError {
  constructor(message: string, provider?: string, raw?: unknown) {
    super(message, 'TRANSFORM_ERROR', provider, undefined, raw);
    this.name = 'TransformError';
  }
}
