import React, { useEffect, useRef } from 'react';
import { useTranslation } from '../i18n';

interface SaveConfirmModalProps {
  fileName: string;
  isOpen: boolean;
  onSave: () => void;
  onDontSave: () => void;
  onCancel: () => void;
}

const SaveConfirmModal: React.FC<SaveConfirmModalProps> = ({
  fileName,
  isOpen,
  onSave,
  onDontSave,
  onCancel,
}) => {
  const t = useTranslation();
  const saveButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (isOpen) {
      // 默认聚焦在“保存”按钮上，方便用户直接回车
      saveButtonRef.current?.focus();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        userSelect: 'none',
      }}
      onClick={onCancel} // 点击遮罩层也可以取消（可选，或者禁止）
      onMouseDown={(e) => e.stopPropagation()} // 防止穿透
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '400px',
          backgroundColor: '#252526',
          border: '1px solid #454545',
          boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
          display: 'flex',
          flexDirection: 'column',
          color: '#cccccc',
          fontFamily: 'Segoe UI, sans-serif',
          animation: 'fadeIn 0.1s ease-out',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '10px 15px',
            fontWeight: '600',
            fontSize: '14px',
            borderBottom: '1px solid #333333',
          }}
        >
          {t.saveConfirm.title}
        </div>

        {/* Body */}
        <div
          style={{
            padding: '20px 15px',
            fontSize: '13px',
            lineHeight: '1.5',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
          }}
        >
          <span style={{ fontSize: '24px' }}>⚠️</span>
          <div>
            {t.saveConfirm.message.replace('{fileName}', fileName)}
            <div style={{ color: '#888', marginTop: '5px', fontSize: '12px' }}>
              {t.saveConfirm.warning}
            </div>
          </div>
        </div>

        {/* Footer / Buttons */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            padding: '15px',
            gap: '10px',
            backgroundColor: '#1e1e1e',
          }}
        >
          <button
            ref={saveButtonRef}
            onClick={onSave}
            style={primaryButtonStyle}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#0062a3')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#007acc')}
          >
            {t.saveConfirm.save}
          </button>
          <button
            onClick={onDontSave}
            style={secondaryButtonStyle}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#4a4a4a')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#3c3c3c')}
          >
            {t.saveConfirm.dontSave}
          </button>
          <button
            onClick={onCancel}
            style={secondaryButtonStyle}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#4a4a4a')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#3c3c3c')}
          >
            {t.actions.cancel}
          </button>
        </div>
      </div>

      {/* 简单的淡入动画 */}
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: scale(0.98); }
          to { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );
};

const baseButtonStyle: React.CSSProperties = {
  border: 'none',
  padding: '6px 16px',
  fontSize: '12px',
  cursor: 'pointer',
  borderRadius: '2px',
  outline: 'none',
  minWidth: '70px',
  transition: 'background-color 0.1s',
};

const primaryButtonStyle: React.CSSProperties = {
  ...baseButtonStyle,
  backgroundColor: '#007acc',
  color: 'white',
};

const secondaryButtonStyle: React.CSSProperties = {
  ...baseButtonStyle,
  backgroundColor: '#3c3c3c',
  color: '#cccccc',
  border: '1px solid #454545', // 增加一点边框让它显眼些
};

export default SaveConfirmModal;
