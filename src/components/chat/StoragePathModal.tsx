import React from 'react';
import { CloseIcon, CopyIcon, CheckIcon } from '../shared/Icons';

export interface StoragePathModalProps {
  storagePath: string | null;
  setStoragePath: React.Dispatch<React.SetStateAction<string | null>>;
  isCopied: boolean;
  copyStoragePath: () => void;
  t: { common: { copy: string; copied: string } };
}

export default function StoragePathModal({
  storagePath,
  setStoragePath,
  isCopied,
  copyStoragePath,
  t,
}: StoragePathModalProps) {
  if (!storagePath) return null;

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
        zIndex: 2000,
      }}
      onClick={() => setStoragePath(null)}
    >
      <div
        style={{
          backgroundColor: 'var(--bg-panel)',
          border: '1px solid var(--border-primary)',
          borderRadius: '12px',
          padding: '20px',
          width: '90%',
          maxWidth: '500px',
          boxShadow: '0 20px 50px rgba(0,0,0,0.3)',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
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
            对话存储路径
          </h3>
          <button
            onClick={() => setStoragePath(null)}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              padding: '4px',
              display: 'flex',
            }}
          >
            <CloseIcon />
          </button>
        </div>

        <div style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
          您的对话历史记录存储在以下位置：
        </div>

        <div
          style={{
            backgroundColor: 'var(--bg-input)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '6px',
            padding: '10px',
            fontSize: '12px',
            fontFamily: 'monospace',
            color: 'var(--text-primary)',
            wordBreak: 'break-all',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
          }}
        >
          <span style={{ flex: 1 }}>{storagePath}</span>
          <button
            onClick={copyStoragePath}
            style={{
              background: isCopied ? 'rgba(46, 164, 79, 0.1)' : 'transparent',
              border: '1px solid',
              borderColor: isCopied ? 'rgba(46, 164, 79, 0.4)' : 'var(--border-subtle)',
              color: isCopied ? 'rgb(46, 164, 79)' : 'var(--text-secondary)',
              borderRadius: '4px',
              padding: '4px 8px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              fontSize: '11px',
              transition: 'all 0.2s',
              whiteSpace: 'nowrap',
            }}
          >
            {isCopied ? <CheckIcon /> : <CopyIcon />}
            {isCopied ? t.common.copied : t.common.copy}
          </button>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
          <button
            onClick={() => setStoragePath(null)}
            style={{
              padding: '8px 16px',
              backgroundColor: 'var(--bg-button)',
              color: 'var(--text-inverse)',
              border: 'none',
              borderRadius: '6px',
              fontSize: '13px',
              cursor: 'pointer',
              fontWeight: 500,
            }}
          >
            确定
          </button>
        </div>
      </div>
    </div>
  );
}
