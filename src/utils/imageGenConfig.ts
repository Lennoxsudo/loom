import type { ToolDefinition } from '../types/ai';
import { invoke } from '@tauri-apps/api/core';
import {
  DEFAULT_IMAGE_GENERATION_CONFIG,
  IMAGE_GENERATION_SIZES,
  SENSENOVA_IMAGE_SIZES,
  type ImageGenerationConfig,
} from '../components/settings/types';

export function normalizeImageGenerationConfig(value: unknown): ImageGenerationConfig {
  const fallback = DEFAULT_IMAGE_GENERATION_CONFIG;
  const obj = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};

  let models: string[];
  if (Array.isArray(obj.models)) {
    models = obj.models.map((m) => (typeof m === 'string' ? m : '')).filter(Boolean).slice(0, 10);
  } else {
    models = [...fallback.models];
  }
  if (models.length === 0) {
    models = [''];
  }

  const defaultQuality =
    obj.defaultQuality === 'hd' || obj.defaultQuality === 'standard'
      ? obj.defaultQuality
      : fallback.defaultQuality;

  return {
    enabled: typeof obj.enabled === 'boolean' ? obj.enabled : fallback.enabled,
    endpoint: typeof obj.endpoint === 'string' ? obj.endpoint : fallback.endpoint,
    apiKey: typeof obj.apiKey === 'string' ? obj.apiKey : fallback.apiKey,
    models,
    defaultModel:
      typeof obj.defaultModel === 'string' ? obj.defaultModel : models[0] || fallback.defaultModel,
    defaultQuality,
    organizationId:
      typeof obj.organizationId === 'string' ? obj.organizationId : fallback.organizationId,
  };
}

export function isImageGenConfigured(config: ImageGenerationConfig): boolean {
  return Boolean(
    config.enabled &&
      config.endpoint.trim() &&
      config.apiKey.trim() &&
      config.models.some((model) => model.trim())
  );
}

export function usesSenseNovaStyle(config: ImageGenerationConfig): boolean {
  const endpoint = config.endpoint.toLowerCase();
  return (
    endpoint.includes('sensenova') ||
    getConfiguredImageModels(config).some((model) => model.toLowerCase().includes('sensenova'))
  );
}

export function getConfiguredImageModels(config: ImageGenerationConfig): string[] {
  return config.models.map((model) => model.trim()).filter(Boolean);
}

export function getDefaultImageModel(config: ImageGenerationConfig): string {
  const models = getConfiguredImageModels(config);
  const preferred = config.defaultModel?.trim();
  if (preferred && models.includes(preferred)) {
    return preferred;
  }
  return models[0] || '';
}

export function getImageGenerationSizes(config: ImageGenerationConfig): readonly string[] {
  return usesSenseNovaStyle(config) ? SENSENOVA_IMAGE_SIZES : IMAGE_GENERATION_SIZES;
}

export function getDefaultImageSize(config: ImageGenerationConfig): string {
  return usesSenseNovaStyle(config) ? '2752x1536' : '1024x1024';
}

const IMAGE_SIZE_PATTERN = /^(\d+)\s*[xX*×]\s*(\d+)$/;

export function parseImageSize(size?: string): { width: number; height: number } | null {
  const trimmed = size?.trim();
  if (!trimmed) return null;

  const match = trimmed.match(IMAGE_SIZE_PATTERN);
  if (!match) return null;

  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }

  return { width, height };
}

export function getImageAspectRatioStyle(size?: string, fallback = '16 / 9'): string {
  const parsed = parseImageSize(size);
  if (!parsed) return fallback;
  return `${parsed.width} / ${parsed.height}`;
}

export function parseGenerateImageAbsolutePaths(text: string): string[] {
  return Array.from(
    new Set(
      Array.from(text.matchAll(/absolute:\s*(.+)$/gm))
        .map((match) => match[1]?.trim())
        .filter((path): path is string => Boolean(path))
    )
  );
}

export function filterImageModels(models: string[]): string[] {
  const lowered = models.map((model) => model.trim()).filter(Boolean);
  return lowered.filter((model) => {
    const name = model.toLowerCase();
    return (
      name.includes('dall-e') ||
      name.includes('dalle') ||
      name.includes('image') ||
      name.includes('flux') ||
      name.includes('stable-diffusion') ||
      name.includes('sdxl') ||
      name.includes('sensenova')
    );
  });
}

export function buildGenerateImageTool(config: ImageGenerationConfig): ToolDefinition {
  const models = getConfiguredImageModels(config);
  const defaultModel = getDefaultImageModel(config);
  const sizes = getImageGenerationSizes(config);
  const defaultSize = getDefaultImageSize(config);
  const sensenova = usesSenseNovaStyle(config);

  const properties: ToolDefinition['parameters']['properties'] = {
    prompt: {
      type: 'string',
      description:
        'Detailed text description of the image to generate. Can be in English or the user language.',
    },
    size: {
      type: 'string',
      enum: [...sizes],
      description: sensenova
        ? `Image dimensions. Default ${defaultSize} (16:9). Pick an aspect ratio from the enum.`
        : 'Image dimensions. Choose based on aspect ratio needs: square (1024x1024), landscape (1792x1024), portrait (1024x1792), or smaller sizes.',
    },
  };

  if (!sensenova) {
    properties.quality = {
      type: 'string',
      enum: ['standard', 'hd'],
      description: 'Optional quality setting. hd costs more on supported models.',
    };
  }

  properties.n = {
    type: 'number',
    description: 'Number of images to generate (1-4). Default 1.',
  };

  if (models.length > 1) {
    properties.model = {
      type: 'string',
      enum: models,
      description: 'Configured image model. Must be one of the allowed values.',
    };
  }

  const modelHint =
    models.length === 1
      ? ` Always uses the configured model "${defaultModel}" — do not invent other model names.`
      : ` Only use configured models: ${models.join(', ')}.`;

  return {
    name: 'generate_image',
    description:
      'Generate an image from a text prompt using the configured image generation API.' +
      modelHint +
      ' Use only when the user explicitly asks to create, draw, or generate an image.' +
      ' The image is saved under the project public/ directory and can be referenced in web pages or Live Server.' +
      ' Returns the relative file path(s) of the generated image(s).',
    parameters: {
      type: 'object',
      properties,
      required: ['prompt'],
    },
  };
}

export async function openGeneratedImageInEditor(
  absolutePath: string,
  options: {
    onMissing: () => void;
    openFile?: (filePath: string) => void;
  }
): Promise<void> {
  try {
    const info = await invoke<{ exists: boolean; file_type: string }>('get_file_info', {
      path: absolutePath,
    });
    if (!info.exists || info.file_type === 'directory') {
      options.onMissing();
      return;
    }
    if (options.openFile) {
      options.openFile(absolutePath);
      return;
    }
    window.dispatchEvent(
      new CustomEvent('open-file-in-editor', {
        detail: { filePath: absolutePath },
      })
    );
  } catch {
    options.onMissing();
  }
}
