export type SettingsTab = 'general' | 'agent' | 'skills' | 'rules' | 'ai-management' | 'ai-config' | 'mcp-config' | 'preferences' | 'code-graph' | 'claude' | 'auto-routing' | 'ports';
export type AIProvider = 'openai' | 'anthropic' | 'gemini' | 'ollama';

export type AIConfigTab = AIProvider | 'image-generation';

export interface AIConfig {
  endpoint: string;
  apiKey: string;
  models: string[];
  organizationId?: string;
  supportsVision?: boolean;
  visionMaxImages?: number;
  visionMaxBytes?: number;
}

export interface AIProfileItem extends AIConfig {
  id: string;
  name: string;
}

export interface AIProviderProfiles {
  activeId: string;
  items: AIProfileItem[];
}

export type AIProfiles = Record<AIProvider, AIProviderProfiles>;

export type ImageGenerationQuality = 'standard' | 'hd';

export interface ImageGenerationConfig {
  enabled: boolean;
  endpoint: string;
  apiKey: string;
  models: string[];
  defaultModel?: string;
  defaultQuality?: ImageGenerationQuality;
  organizationId?: string;
}

export const DEFAULT_IMAGE_GENERATION_CONFIG: ImageGenerationConfig = {
  enabled: false,
  endpoint: 'https://api.openai.com/v1',
  apiKey: '',
  models: ['dall-e-3'],
  defaultModel: 'dall-e-3',
  defaultQuality: 'standard',
  organizationId: '',
};

export const IMAGE_GENERATION_SIZES = [
  '256x256',
  '512x512',
  '1024x1024',
  '1792x1024',
  '1024x1792',
] as const;

export const SENSENOVA_IMAGE_SIZES = [
  '1664x2496',
  '2496x1664',
  '1760x2368',
  '2368x1760',
  '1824x2272',
  '2272x1824',
  '2048x2048',
  '2752x1536',
  '1536x2752',
  '3072x1376',
  '1344x3136',
] as const;

export type ImageGenerationSize = (typeof IMAGE_GENERATION_SIZES)[number];
export type SenseNovaImageSize = (typeof SENSENOVA_IMAGE_SIZES)[number];

/**
 * An entry in the auto-routing fallback chain.
 * Each entry specifies a provider, a specific profile, and a model to use.
 */
export interface AutoRoutingEntry {
  /** The AI provider identifier */
  provider: AIProvider;
  /** The profile id within that provider's profiles */
  profileId: string;
  /** The model name to use for this entry */
  model: string;
}

/**
 * Auto-routing configuration.
 * When enabled and the current provider runs out of quota,
 * the system will automatically fall back to the next entry in the list.
 */
export interface AutoRoutingConfig {
  /** Whether auto-routing is enabled */
  enabled: boolean;
  /** Ordered list of fallback entries (first is primary) */
  entries: AutoRoutingEntry[];
}

export const DEFAULT_AI_CONFIGS: Record<AIProvider, AIConfig> = {
  openai: {
    endpoint: 'https://api.openai.com/v1',
    apiKey: '',
    models: ['gpt-4'],
    organizationId: '',
    supportsVision: true,
    visionMaxImages: 4,
    visionMaxBytes: 10 * 1024 * 1024,
  },
  anthropic: {
    endpoint: 'https://api.anthropic.com',
    apiKey: '',
    models: ['claude-3-5-sonnet-20241022'],
    supportsVision: true,
    visionMaxImages: 4,
    visionMaxBytes: 10 * 1024 * 1024,
  },
  gemini: {
    endpoint: 'https://generativelanguage.googleapis.com',
    apiKey: '',
    models: ['gemini-1.5-flash'],
    supportsVision: true,
    visionMaxImages: 4,
    visionMaxBytes: 10 * 1024 * 1024,
  },
  ollama: {
    endpoint: 'http://localhost:11434',
    apiKey: '',
    models: ['llama3.1'],
    supportsVision: false,
    visionMaxImages: 0,
    visionMaxBytes: 0,
  },
};

export const lastActiveTab: { current: SettingsTab } = { current: 'general' };
