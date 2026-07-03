import type { CSSProperties } from 'react';

export const desktopShellStyle: CSSProperties = {
  display: 'flex',
  height: '100%',
  minHeight: 0,
  backgroundColor: 'var(--bg-primary)',
  color: 'var(--text-primary)',
};

export const sessionColumnStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  minHeight: 0,
  backgroundColor: 'var(--bg-primary)',
  position: 'relative',
};

export const chatShellStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  backgroundColor: 'var(--bg-primary)',
  position: 'relative',
  minHeight: 0,
};

export const previewResizeHandleStyle: CSSProperties = {
  width: '10px',
  flexShrink: 0,
  cursor: 'col-resize',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: 'transparent',
};

export const previewResizeGripStyle: CSSProperties = {
  width: '2px',
  height: '56px',
  borderRadius: '999px',
  backgroundColor: 'rgba(160, 160, 160, 0.35)',
};

export const inputWrapStyle: CSSProperties = {
  padding: '10px 16px 14px',
  backgroundColor: 'var(--bg-primary)',
  flexShrink: 0,
};

export function getInputCardStyle(isDragOver: boolean): CSSProperties {
  return {
    position: 'relative',
    borderRadius: '14px',
    border: `1px solid ${isDragOver ? 'var(--border-focus)' : 'var(--border-primary)'}`,
    backgroundColor: 'var(--bg-panel)',
    boxShadow: isDragOver ? '0 0 0 1px var(--border-focus)' : 'var(--shadow-sm)',
    transition: 'border-color 0.2s, box-shadow 0.2s',
  };
}

export const inputTextStyle: CSSProperties = {
  width: '100%',
  minHeight: '36px',
  maxHeight: '120px',
  resize: 'none',
  padding: '8px 14px',
  border: 'none',
  outline: 'none',
  backgroundColor: 'transparent',
  color: 'var(--text-primary)',
  fontSize: '13px',
  lineHeight: '1.55',
  fontFamily: 'inherit',
};

export const inputToolbarStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  gap: '8px',
  padding: '6px 10px',
  borderTop: '1px solid var(--border-subtle)',
  position: 'relative',
};
