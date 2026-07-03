import { ChevronDownIcon, EditIcon, TrashIcon } from '../shared/Icons';
import type { ConversationMeta, Conversation } from './types';
import styles from './ConversationSelector.module.css';

export interface ConversationSelectorProps {
  currentConversation: Conversation | null;
  conversations: ConversationMeta[];
  isConversationDropdownOpen: boolean;
  setIsConversationDropdownOpen: React.Dispatch<React.SetStateAction<boolean>>;
  conversationDropdownRef: React.RefObject<HTMLDivElement | null>;
  renamingId: string | null;
  renameValue: string;
  setRenameValue: React.Dispatch<React.SetStateAction<string>>;
  renameInputRef: React.RefObject<HTMLInputElement | null>;
  isConversationSwitchLocked: boolean;
  loadConversation: (filename: string) => Promise<void>;
  handleStartRename: (e?: React.MouseEvent, conv?: ConversationMeta) => void;
  handleRenameSubmit: () => Promise<void>;
  handleCancelRename: () => void;
  requestDeleteConversation: (e: React.MouseEvent, conv: ConversationMeta) => void;
  t: {
    chat: { newConversation: string; noConversationRecord: string };
    labels: { renameConversation: string; deleteConversation: string };
    chatConversation: { lockedRename: string; lockedDelete: string };
  };
}

export default function ConversationSelector({
  currentConversation,
  conversations,
  isConversationDropdownOpen,
  setIsConversationDropdownOpen,
  conversationDropdownRef,
  renamingId,
  renameValue,
  setRenameValue,
  renameInputRef,
  isConversationSwitchLocked,
  loadConversation,
  handleStartRename,
  handleRenameSubmit,
  handleCancelRename,
  requestDeleteConversation,
  t,
}: ConversationSelectorProps) {
  const title =
    currentConversation?.title?.trim() || t.chat.newConversation;

  return (
    <div className={styles.root} ref={conversationDropdownRef}>
      <button
        type="button"
        className={`${styles.trigger} ${isConversationDropdownOpen ? styles.triggerOpen : ''}`}
        onClick={() => setIsConversationDropdownOpen(!isConversationDropdownOpen)}
        aria-expanded={isConversationDropdownOpen}
        aria-haspopup="listbox"
      >
        <div style={{ width: '16px', flexShrink: 0 }} />
        <span className={styles.title}>{title}</span>
        <span
          className={`${styles.chevron} ${isConversationDropdownOpen ? styles.chevronOpen : ''}`}
        >
          <ChevronDownIcon size={10} />
        </span>
      </button>

      {isConversationDropdownOpen && (
        <div className={styles.dropdown} role="listbox">
          {conversations.length === 0 ? (
            <div className={styles.empty}>{t.chat.noConversationRecord}</div>
          ) : (
            conversations.map((conv) => {
              const isActive = currentConversation?.id === conv.id;
              return (
                <div
                  key={conv.id}
                  className={`${styles.item} ${isActive ? styles.itemActive : ''}`}
                >
                  {renamingId === conv.id ? (
                    <input
                      ref={renameInputRef}
                      className={styles.renameInput}
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onBlur={() => void handleRenameSubmit()}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void handleRenameSubmit();
                        if (e.key === 'Escape') handleCancelRename();
                      }}
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <>
                      <button
                        type="button"
                        className={styles.itemButton}
                        disabled={isConversationSwitchLocked}
                        onClick={() => void loadConversation(conv.filename)}
                      >
                        <div className={styles.itemTitle}>{conv.title}</div>
                        <div className={styles.itemMeta}>
                          {new Date(conv.last_used_at).toLocaleString()}
                        </div>
                      </button>
                      <div className={styles.itemActions}>
                        <button
                          type="button"
                          className={styles.iconButton}
                          disabled={isConversationSwitchLocked}
                          title={
                            isConversationSwitchLocked
                              ? t.chatConversation.lockedRename
                              : t.labels.renameConversation
                          }
                          onClick={(e) => {
                            if (isConversationSwitchLocked) return;
                            handleStartRename(e, conv);
                          }}
                        >
                          <EditIcon size={12} />
                        </button>
                        <button
                          type="button"
                          className={`${styles.iconButton} ${styles.iconButtonDanger}`}
                          disabled={isConversationSwitchLocked}
                          title={
                            isConversationSwitchLocked
                              ? t.chatConversation.lockedDelete
                              : t.labels.deleteConversation
                          }
                          onClick={(e) => {
                            if (isConversationSwitchLocked) return;
                            requestDeleteConversation(e, conv);
                          }}
                        >
                          <TrashIcon size={12} />
                        </button>
                      </div>
                    </>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
