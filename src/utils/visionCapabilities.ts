/**
 * Vision Capabilities 工具模块
 *
 * 用于处理 AI 模型的视觉能力配置
 * 被 ChatPanel 和 AgentPanel 共享使用
 */

export type AIProvider = 'openai' | 'anthropic' | 'ollama' | 'builtin';

export interface VisionCapability {
  supportsVision: boolean;
  visionMaxImages: number;
  visionMaxBytes: number;
}

export const DEFAULT_VISION_CAPABILITIES: Record<AIProvider, VisionCapability> = {
  openai: { supportsVision: true, visionMaxImages: 4, visionMaxBytes: 10 * 1024 * 1024 },
  anthropic: { supportsVision: true, visionMaxImages: 4, visionMaxBytes: 10 * 1024 * 1024 },
  ollama: { supportsVision: false, visionMaxImages: 0, visionMaxBytes: 0 },
  // Built-in gateway models (e.g. SenseNova) accept OpenAI-compatible image inputs.
  builtin: { supportsVision: true, visionMaxImages: 4, visionMaxBytes: 10 * 1024 * 1024 },
};

export const ALLOWED_IMAGE_MEDIA_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
]);

function guessImageMediaType(fileName: string): string | null {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  return null;
}

/**
 * Collect image Files from a paste/drop DataTransfer.
 * Clipboard blobs often have an empty `file.type`; fall back to the item MIME / file name.
 */
export function collectClipboardImageFiles(data: DataTransfer | null | undefined): File[] {
  if (!data) return [];

  const out: File[] = [];
  const seen = new Set<string>();

  const pushFile = (file: File, fallbackType?: string) => {
    const mediaType =
      (file.type && ALLOWED_IMAGE_MEDIA_TYPES.has(file.type) ? file.type : '') ||
      (fallbackType && ALLOWED_IMAGE_MEDIA_TYPES.has(fallbackType) ? fallbackType : '') ||
      guessImageMediaType(file.name) ||
      '';
    if (!mediaType || !ALLOWED_IMAGE_MEDIA_TYPES.has(mediaType)) {
      return;
    }

    const normalized =
      file.type === mediaType
        ? file
        : new File([file], file.name || `paste.${mediaType.split('/')[1] || 'png'}`, {
            type: mediaType,
            lastModified: file.lastModified,
          });
    const key = `${normalized.size}:${normalized.type}:${normalized.name}:${normalized.lastModified}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(normalized);
  };

  for (const item of Array.from(data.items || [])) {
    if (!item.type.startsWith('image/')) continue;
    const file = item.getAsFile();
    if (file) pushFile(file, item.type);
  }

  if (out.length === 0) {
    for (const file of Array.from(data.files || [])) {
      pushFile(file);
    }
  }

  return out;
}

/** True when clipboard looks like it contains an image, even if File extraction failed. */
export function clipboardLooksLikeImage(data: DataTransfer | null | undefined): boolean {
  if (!data) return false;
  if (Array.from(data.items || []).some((item) => item.type.startsWith('image/'))) {
    return true;
  }
  return Array.from(data.files || []).some(
    (file) =>
      (file.type && ALLOWED_IMAGE_MEDIA_TYPES.has(file.type)) || !!guessImageMediaType(file.name)
  );
}

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
export const extractVisionCapabilities = (
  rawConfig: unknown
): Record<AIProvider, VisionCapability> => {
  const next: Record<AIProvider, VisionCapability> = {
    openai: { ...DEFAULT_VISION_CAPABILITIES.openai },
    anthropic: { ...DEFAULT_VISION_CAPABILITIES.anthropic },
    ollama: { ...DEFAULT_VISION_CAPABILITIES.ollama },
    builtin: { ...DEFAULT_VISION_CAPABILITIES.builtin },
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

    let visionMaxImages = toValidPositiveNumber(
      providerObj.visionMaxImages,
      fallback.visionMaxImages
    );
    let visionMaxBytes = toValidPositiveNumber(providerObj.visionMaxBytes, fallback.visionMaxBytes);
    // If vision is enabled but limits were saved as 0, keep paste usable.
    if (supportsVision && visionMaxImages <= 0) {
      visionMaxImages = Math.max(fallback.visionMaxImages, 4);
    }
    if (supportsVision && visionMaxBytes <= 0) {
      visionMaxBytes = Math.max(fallback.visionMaxBytes, 10 * 1024 * 1024);
    }

    next[provider] = {
      supportsVision,
      visionMaxImages,
      visionMaxBytes,
    };
  }

  return next;
};
