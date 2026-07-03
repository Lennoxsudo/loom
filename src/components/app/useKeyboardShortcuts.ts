import { useEffect } from 'react';
import { shortcutMatchesEvent } from '../../utils/shortcutUtils';
import type { KeyBindings } from '../../types/settings';
import { CHAT_NEW_CONVERSATION_EVENT } from '../../types/app';

export interface UseKeyboardShortcutsOptions {
  keyBindings: KeyBindings;
  onSaveFile: () => void;
  onCreateFile: () => void;
  onToggleChat: () => void;
  onNewChat: () => void;
}

export function useKeyboardShortcuts({
  keyBindings,
  onSaveFile,
  onCreateFile,
  onToggleChat,
  onNewChat,
}: UseKeyboardShortcutsOptions): void {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat) return;

      const target = e.target;
      if (target instanceof HTMLElement && target.closest('[data-shortcut-capture="true"]')) {
        return;
      }

      if (shortcutMatchesEvent(keyBindings.saveFile, e)) {
        e.preventDefault();
        onSaveFile();
        return;
      }

      if (shortcutMatchesEvent(keyBindings.newFile, e)) {
        e.preventDefault();
        onCreateFile();
        return;
      }

      if (shortcutMatchesEvent(keyBindings.openAIChat, e)) {
        e.preventDefault();
        onToggleChat();
        return;
      }

      if (shortcutMatchesEvent(keyBindings.newChat, e)) {
        e.preventDefault();
        onToggleChat();
        window.dispatchEvent(new CustomEvent(CHAT_NEW_CONVERSATION_EVENT));
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [keyBindings, onSaveFile, onCreateFile, onToggleChat, onNewChat]);
}
