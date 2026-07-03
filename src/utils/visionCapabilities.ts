/**
 * Vision Capabilities 工具模块
 * 
 * 用于处理 AI 模型的视觉能力配置
 * 被 ChatPanel 和 AgentPanel 共享使用
 */

export type AIProvider = 'openai' | 'anthropic' | 'gemini' | 'ollama';

export interface VisionCapability {
  supportsVision: boolean;
  visionMaxImages: number;
  visionMaxBytes: number;
}

export const DEFAULT_VISION_CAPABILITIES: Record<AIProvider, VisionCapability> = {
  openai: { supportsVision: true, visionMaxImages: 4, visionMaxBytes: 10 * 1024 * 1024 },
  anthropic: { supportsVision: true, visionMaxImages: 4, visionMaxBytes: 10 * 1024 * 1024 },
  gemini: { supportsVision: true, visionMaxImages: 4, visionMaxBytes: 10 * 1024 * 1024 },
  ollama: { supportsVision: false, visionMaxImages: 0, visionMaxBytes: 0 },
};

export const ALLOWED_IMAGE_MEDIA_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

/**
 * 将值转换为有效的正整数
 */
const toValidPositiveNumber = (value: unknown, fallback: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.floor(value);
};

/**
 * 从原始配置中提取视觉能力
 */
export const extractVisionCapabilities = (rawConfig: unknown): Record<AIProvider, VisionCapability> => {
  const next: Record<AIProvider, VisionCapability> = {
    openai: { ...DEFAULT_VISION_CAPABILITIES.openai },
    anthropic: { ...DEFAULT_VISION_CAPABILITIES.anthropic },
    gemini: { ...DEFAULT_VISION_CAPABILITIES.gemini },
    ollama: { ...DEFAULT_VISION_CAPABILITIES.ollama },
  };

  if (!rawConfig || typeof rawConfig !== 'object') {
    return next;
  }

  const configs = (rawConfig as { configs?: Record<string, unknown> }).configs;
  if (!configs || typeof configs !== 'object') {
    return next;
  }

  for (const provider of Object.keys(DEFAULT_VISION_CAPABILITIES) as AIProvider[]) {
    const providerConfig = configs[provider];
    if (!providerConfig || typeof providerConfig !== 'object') {
      continue;
    }

    const providerObj = providerConfig as Record<string, unknown>;
    const fallback = DEFAULT_VISION_CAPABILITIES[provider];
    const supportsVision =
      typeof providerObj.supportsVision === 'boolean'
        ? providerObj.supportsVision
        : fallback.supportsVision;

    next[provider] = {
      supportsVision,
      visionMaxImages: toValidPositiveNumber(providerObj.visionMaxImages, fallback.visionMaxImages),
      visionMaxBytes: toValidPositiveNumber(providerObj.visionMaxBytes, fallback.visionMaxBytes),
    };
  }

  return next;
};
