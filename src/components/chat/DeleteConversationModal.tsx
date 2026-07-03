import React from 'react';
import { CloseIcon } from '../shared/Icons';
import type { ConversationMeta } from './types';

export interface DeleteConversationModalProps {
  pendingDelete: ConversationMeta | null;
  setPendingDelete: React.Dispatch<React.SetStateAction<ConversationMeta | null>>;
  isDeletingConversation: boolean;
  confirmDeleteConversation: () => Promise<void>;
  t: { common: { deleting: string; confirmDelete: string } };
}

export default function DeleteConversationModal({
  pendingDelete,
  setPendingDelete,
  isDeletingConversation,
  confirmDeleteConversation,
  t,
}: DeleteConversationModalProps) {
  if (!pendingDelete) return null;

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 2500,
      }}
      onClick={() => {
        if (!isDeletingConversation) setPendingDelete(null);
      }}
    >
      <div
        style={{
          backgroundColor: 'var(--bg-panel)',
          border: '1px solid var(--border-primary)',
          borderRadius: '12px',
          padding: '20px',
          width: '90%',
          maxWidth: '420px',
          boxShadow: '0 20px 50px rgba(0,0,0,0.3)',
          display: 'flex',
          flexDirection: 'column',
          gap: '14px',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h3
            style={{
              margin: 0,
              fontSize: '16px',
              fontWeight: 600,
              color: 'var(--text-primary)',
            }}
          >
            删除对话
          </h3>
          <button
            onClick={() => {
              if (!isDeletingConversation) setPendingDelete(null);
            }}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-secondary)',
              cursor: isDeletingConversation ? 'default' : 'pointer',
              padding: '4px',
              display: 'flex',
              opacity: isDeletingConversation ? 0.6 : 1,
            }}
          >
            <CloseIcon />
          </button>
        </div>

        <div style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
          确定要删除对话 &ldquo;{pendingDelete.title}&rdquo; 吗？
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
          <button
            onClick={() => {
              if (!isDeletingConversation) setPendingDelete(null);
            }}
            style={{
              padding: '8px 14px',
              backgroundColor: 'transparent',
              color: 'var(--text-secondary)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '6px',
              fontSize: '13px',
              cursor: isDeletingConversation ? 'default' : 'pointer',
              opacity: isDeletingConversation ? 0.6 : 1,
            }}
            disabled={isDeletingConversation}
          >
            取消
          </button>
          <button
            onClick={() => void confirmDeleteConversation()}
            style={{
              padding: '8px 14px',
              backgroundColor: 'rgba(232, 17, 35, 0.9)',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              fontSize: '13px',
              cursor: isDeletingConversation ? 'default' : 'pointer',
              fontWeight: 500,
              opacity: isDeletingConversation ? 0.75 : 1,
            }}
            disabled={isDeletingConversation}
          >
            {isDeletingConversation ? t.common.deleting : t.common.confirmDelete}
          </button>
        </div>
      </div>
    </div>
  );
}
