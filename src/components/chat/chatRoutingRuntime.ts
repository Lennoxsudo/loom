import {
  reconcileProviderRequest,
  resolveActiveAutoRoutingRuntime,
  type AutoRoutingResolveOptions,
  type LoadedAiConfig,
} from '../../utils/aiProviderRuntime';
import type { AIProvider } from '../../utils/visionCapabilities';
import type { ChatProtocolSelection } from './types';

export const CHAT_PROTOCOL_STORAGE_KEY = 'loom:chat-protocol-selection';

export interface ChatRuntimeSnapshot {
  provider: AIProvider;
  model: string;
  profileId?: string;
  routingMode: 'manual' | 'auto';
}

export function reconcileChatRequestRuntime(
  config: LoadedAiConfig,
  protocolSelection: ChatProtocolSelection,
  manualModel: string,
  activeRuntime?: Partial<ChatRuntimeSnapshot>,
  autoRoutingOptions?: AutoRoutingResolveOptions
): ChatRuntimeSnapshot | null {
  if (protocolSelection === 'auto') {
    const resolved = resolveActiveAutoRoutingRuntime(
      config,
      activeRuntime,
      autoRoutingOptions
    );
    if (!resolved?.model?.trim()) {
      return null;
    }
    return {
      provider: resolved.provider,
      model: resolved.model,
      profileId: resolved.profileId,
      routingMode: 'auto',
    };
  }

  const model = manualModel.trim();
  if (!model) {
    return null;
  }

  const reconciled = reconcileProviderRequest(
    config,
    protocolSelection,
    model,
    activeRuntime?.profileId
  );

  return {
    provider: reconciled.provider,
    model: reconciled.model,
    profileId: reconciled.profileId,
    routingMode: 'manual',
  };
}

export function syncChatRuntimeIfChanged(
  chatRuntimeRef: { current: ChatRuntimeSnapshot },
  reconciled: ChatRuntimeSnapshot,
  onRuntimeReconciled?: (runtime: ChatRuntimeSnapshot) => void,
  options?: { skipUiSync?: boolean }
): void {
  const before = chatRuntimeRef.current;
  if (
    before.model === reconciled.model &&
    (before.profileId ?? '') === (reconciled.profileId ?? '') &&
    before.provider === reconciled.provider
  ) {
    return;
  }
  chatRuntimeRef.current = {
    ...reconciled,
    routingMode: before.routingMode,
  };
  if (!options?.skipUiSync && before.routingMode !== 'auto') {
    onRuntimeReconciled?.(reconciled);
  }
}
