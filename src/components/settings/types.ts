export type SettingsTab =
  | 'general'
  | 'agent'
  | 'skills'
  | 'plugins'
  | 'rules'
  | 'ai-management'
  | 'ai-config'
  | 'mcp-config'
  | 'preferences'
  | 'code-graph'
  | 'claude'
  | 'auto-routing'
  | 'ports'
  | 'update'
  | 'usage';
export type AIProvider = 'openai' | 'anthropic' | 'ollama';

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

// Size constants live in shared/lib so agent-engine does not depend on UI settings types.
export {
  IMAGE_GENERATION_SIZES,
  SENSENOVA_IMAGE_SIZES,
  type ImageGenerationSize,
  type SenseNovaImageSize,
} from '../../shared/lib/imageGenSizes';

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
