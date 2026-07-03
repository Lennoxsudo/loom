import { useEffect, useRef, useState } from 'react';
import { EditIcon, FolderIcon, TrashIcon } from '../shared/Icons';
import type { Conversation, ConversationMeta } from './types';
import panelStyles from '../ChatPanel.module.css';

export interface ChatHeaderActionsProps {
  isConversationSwitchLocked: boolean;
  currentConversation: Conversation | null;
  conversations: ConversationMeta[];
  handleStartRename: (e?: React.MouseEvent, conv?: ConversationMeta) => void;
  requestDeleteCurrentConversation: () => void;
  showStoragePath: () => Promise<void>;
  t: {
    chat: { newConversation: string };
    labels: {
      renameConversation: string;
      deleteConversation: string;
      viewStorageLocation: string;
    };
    chatConversation: {
      lockedRename: string;
      lockedDelete: string;
      moreActions: string;
      renameCurrent: string;
    };
  };
}

export function ChatHeaderActions({
  isConversationSwitchLocked,
  currentConversation,
  conversations,
  handleStartRename,
  requestDeleteCurrentConversation,
  showStoragePath,
  t,
}: ChatHeaderActionsProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };

    window.addEventListener('mousedown', handlePointerDown, true);
    return () => window.removeEventListener('mousedown', handlePointerDown, true);
  }, [menuOpen]);

  const currentMeta = currentConversation
    ? conversations.find((conv) => conv.id === currentConversation.id)
    : undefined;

  return (
    <div className={panelStyles.headerActions}>
      <div className={panelStyles.headerMenuWrap} ref={menuRef}>
        <button
          type="button"
          className={panelStyles.headerIconButton}
          aria-label={t.chatConversation.moreActions}
          title={t.chatConversation.moreActions}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <span style={{ fontSize: 14, lineHeight: 1, letterSpacing: 1 }}>···</span>
        </button>

        {menuOpen && (
          <div className={panelStyles.headerMenu}>
            {currentConversation && (
              <button
                type="button"
                className={panelStyles.headerMenuItem}
                disabled={isConversationSwitchLocked}
                title={
                  isConversationSwitchLocked
                    ? t.chatConversation.lockedRename
                    : t.chatConversation.renameCurrent
                }
                onClick={(e) => {
                  if (isConversationSwitchLocked) return;
                  setMenuOpen(false);
                  handleStartRename(e, currentMeta);
                }}
              >
                <EditIcon size={14} />
                {t.chatConversation.renameCurrent}
              </button>
            )}
            {currentConversation && (
              <button
                type="button"
                className={`${panelStyles.headerMenuItem} ${panelStyles.headerMenuItemDanger}`}
                disabled={isConversationSwitchLocked}
                title={
                  isConversationSwitchLocked
                    ? t.chatConversation.lockedDelete
                    : t.labels.deleteConversation
                }
                onClick={() => {
                  if (isConversationSwitchLocked) return;
                  setMenuOpen(false);
                  requestDeleteCurrentConversation();
                }}
              >
                <TrashIcon size={14} />
                {t.labels.deleteConversation}
              </button>
            )}
            <button
              type="button"
              className={panelStyles.headerMenuItem}
              onClick={() => {
                setMenuOpen(false);
                void showStoragePath();
              }}
            >
              <FolderIcon size={14} />
              {t.labels.viewStorageLocation}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
