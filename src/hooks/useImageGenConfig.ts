import { useCallback, useEffect, useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import {
  DEFAULT_IMAGE_GENERATION_CONFIG,
  type ImageGenerationConfig,
} from '../components/settings/types';
import { normalizeImageGenerationConfig } from '../utils/imageGenConfig';

export function useImageGenConfig() {
  const [imageGenConfig, setImageGenConfig] = useState<ImageGenerationConfig>(
    DEFAULT_IMAGE_GENERATION_CONFIG
  );

  const loadConfig = useCallback(async () => {
    if (!isTauri()) return;
    try {
      const configStr = await invoke<string>('load_ai_config');
      if (!configStr) {
        setImageGenConfig(DEFAULT_IMAGE_GENERATION_CONFIG);
        return;
      }
      const parsed = JSON.parse(configStr) as { imageGeneration?: unknown };
      setImageGenConfig(normalizeImageGenerationConfig(parsed.imageGeneration));
    } catch (error) {
      console.error('Failed to load image generation config:', error);
      setImageGenConfig(DEFAULT_IMAGE_GENERATION_CONFIG);
    }
  }, []);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen('ai-config-updated', () => {
      void loadConfig();
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, [loadConfig]);

  return imageGenConfig;
}
