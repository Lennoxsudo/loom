import { useEffect } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { VisionCapability, AIProvider } from '../../utils/visionCapabilities';
import {
  DEFAULT_VISION_CAPABILITIES,
  extractVisionCapabilities,
} from '../../utils/visionCapabilities';
import {
  BUILTIN_PROFILE_ID,
  isBuiltinProtocol,
} from '../../utils/builtinGateway';
import { useBuiltinGatewayStore } from '../../stores/useBuiltinGatewayStore';
import type { ChatPanelProvider, ChatProtocolSelection } from './types';

export interface UseChatConfigOptions {
  setVisionCapabilities: React.Dispatch<React.SetStateAction<Record<AIProvider, VisionCapability>>>;
  setProtocolSelection: React.Dispatch<React.SetStateAction<ChatProtocolSelection>>;
  setAvailableModels: React.Dispatch<React.SetStateAction<string[]>>;
  setSelectedModel: React.Dispatch<React.SetStateAction<string>>;
  getProtocolSelection?: () => ChatProtocolSelection;
}

async function loadBuiltinModelsIntoUi(
  setAvailableModels: React.Dispatch<React.SetStateAction<string[]>>,
  setSelectedModel: React.Dispatch<React.SetStateAction<string>>,
  preferCurrent?: string
): Promise<void> {
  const store = useBuiltinGatewayStore.getState();
  if (!store.hydrated) {
    await store.hydrate();
  }
  if (!store.isActivated()) {
    setAvailableModels([]);
    setSelectedModel('');
    return;
  }
  let models = store.models;
  if (models.length === 0) {
    models = await store.refreshModels();
  }
  // Fallback: read injected openai profile if store models still empty
  if (models.length === 0) {
    try {
      const configStr = await invoke<string>('load_ai_config');
      if (configStr) {
        const config = JSON.parse(configStr) as {
          profiles?: {
            openai?: { items?: Array<{ id?: string; models?: string[] }> };
          };
        };
        const item = config.profiles?.openai?.items?.find((it) => it.id === BUILTIN_PROFILE_ID);
        models = (item?.models ?? []).map((m) => m.trim()).filter(Boolean);
      }
    } catch {
      // ignore
    }
  }
  setAvailableModels(models);
  const preferred = preferCurrent?.trim();
  if (preferred && models.includes(preferred)) {
    setSelectedModel(preferred);
  } else {
    setSelectedModel(models[0] || '');
  }
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
          // Do not override an explicit local protocol (e.g. builtin) from disk selectedProvider.
          const current = getProtocolSelection?.();
          if (current === 'builtin') {
            await loadBuiltinModelsIntoUi(setAvailableModels, setSelectedModel);
            return;
          }
          const provider = config.selectedProvider || 'anthropic';
          if (provider === 'openai' || provider === 'anthropic' || provider === 'ollama') {
            setProtocolSelection(provider);
          }

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
          if (getProtocolSelection?.() === 'builtin') {
            await loadBuiltinModelsIntoUi(setAvailableModels, setSelectedModel);
            return;
          }
          const provider = config.selectedProvider || 'anthropic';
          if (provider === 'openai' || provider === 'anthropic' || provider === 'ollama') {
            setProtocolSelection(provider);
          }

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
      if (isBuiltinProtocol(selectedProvider)) {
        await loadBuiltinModelsIntoUi(setAvailableModels, setSelectedModel);
        return;
      }
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
