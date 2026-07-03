import { useEffect } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { VisionCapability, AIProvider } from '../../utils/visionCapabilities';
import {
  DEFAULT_VISION_CAPABILITIES,
  extractVisionCapabilities,
} from '../../utils/visionCapabilities';
import type { ChatPanelProvider, ChatProtocolSelection } from './types';

export interface UseChatConfigOptions {
  setVisionCapabilities: React.Dispatch<React.SetStateAction<Record<AIProvider, VisionCapability>>>;
  setProtocolSelection: React.Dispatch<React.SetStateAction<ChatProtocolSelection>>;
  setAvailableModels: React.Dispatch<React.SetStateAction<string[]>>;
  setSelectedModel: React.Dispatch<React.SetStateAction<string>>;
  getProtocolSelection?: () => ChatProtocolSelection;
}

export function useChatConfig({
  setVisionCapabilities,
  setProtocolSelection,
  setAvailableModels,
  setSelectedModel,
  getProtocolSelection,
}: UseChatConfigOptions) {
  useEffect(() => {
    const loadConfig = async () => {
      if (!isTauri()) return;
      try {
        const configStr = await invoke<string>('load_ai_config');
        if (configStr) {
          const config = JSON.parse(configStr);
          setVisionCapabilities(extractVisionCapabilities(config));
          if (getProtocolSelection?.() === 'auto') {
            return;
          }
          const provider = config.selectedProvider || 'anthropic';
          setProtocolSelection(provider);

          const providerConfig = config.configs?.[provider];
          if (providerConfig) {
            const models =
              providerConfig.models || (providerConfig.model ? [providerConfig.model] : []);
            setAvailableModels(models);
            setSelectedModel(models[0] || '');
          }
        }
      } catch (error) {
        console.error('加载AI配置失败:', error);
      }
    };
    loadConfig();
  }, []);

  useEffect(() => {
    const reloadConfig = async () => {
      try {
        const configStr = await invoke<string>('load_ai_config');
        if (configStr) {
          const config = JSON.parse(configStr);
          setVisionCapabilities(extractVisionCapabilities(config));
          if (getProtocolSelection?.() === 'auto') {
            return;
          }
          const provider = config.selectedProvider || 'anthropic';
          setProtocolSelection(provider);

          const providerConfig = config.configs?.[provider];
          if (providerConfig) {
            const models =
              providerConfig.models || (providerConfig.model ? [providerConfig.model] : []);
            setAvailableModels(models);
            setSelectedModel(models[0] || '');
          } else {
            setAvailableModels([]);
            setSelectedModel('');
          }
        } else {
          setVisionCapabilities(DEFAULT_VISION_CAPABILITIES);
          setAvailableModels([]);
          setSelectedModel('');
        }
      } catch {
        // Config load failed, use defaults
      }
    };

    const unlisten = listen('ai-config-updated', () => {
      void reloadConfig();
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const loadModels = (selectedProvider: ChatPanelProvider) => {
    const doLoad = async () => {
      try {
        const configStr = await invoke<string>('load_ai_config');
        if (configStr) {
          const config = JSON.parse(configStr);
          setVisionCapabilities(extractVisionCapabilities(config));
          const providerConfig = config.configs?.[selectedProvider];
          if (providerConfig) {
            const models =
              providerConfig.models || (providerConfig.model ? [providerConfig.model] : []);
            setAvailableModels(models);
            setSelectedModel(models[0] || '');
          }
        }
      } catch (error) {
        console.error('加载模型列表失败:', error);
      }
    };
    doLoad();
  };

  return { loadModels };
}
