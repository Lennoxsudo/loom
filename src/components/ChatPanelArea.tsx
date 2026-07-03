import { type CSSProperties, memo } from 'react';
import ChatPanel from './ChatPanel';

export interface ChatPanelAreaProps {
  isOpen: boolean;
  width: number;
  isResizing: boolean;
  projectPath: string | null | undefined;
  onResizeStart: (e: React.MouseEvent) => void;
  onFilesChanged: (paths: string[]) => void;
}

const resizeHandleStyle: CSSProperties = {
  width: '1px',
  cursor: 'col-resize',
  flexShrink: 0,
  userSelect: 'none',
};

const panelContainerStyle: CSSProperties = {
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
  backgroundColor: 'var(--bg-panel)',
};

export const ChatPanelArea = memo(function ChatPanelArea({
  isOpen,
  width,
  isResizing,
  projectPath,
  onResizeStart,
  onFilesChanged,
}: ChatPanelAreaProps) {
  const resolvedProjectPath = projectPath ?? undefined;

  if (!isOpen) {
    return null;
  }

  return (
    <>
      {/* Left resize handle - acts as visual separator */}
      <div
        onMouseDown={onResizeStart}
        style={{
          ...resizeHandleStyle,
          backgroundColor: isResizing ? 'var(--panel-resizer-active)' : 'var(--panel-resizer)',
          transition: isResizing ? 'none' : 'background-color 0.15s ease',
        }}
        onMouseEnter={(e) => {
          if (!isResizing) e.currentTarget.style.backgroundColor = 'var(--panel-resizer-active)';
        }}
        onMouseLeave={(e) => {
          if (!isResizing) e.currentTarget.style.backgroundColor = 'var(--panel-resizer)';
        }}
      />

      {/* Chat panel */}
      <div
        style={{
          ...panelContainerStyle,
          width: `${width}px`,
          minWidth: '250px',
          maxWidth: '600px',
        }}
      >
        <ChatPanel
          width={width}
          projectPath={resolvedProjectPath || ''}
          onFilesChanged={onFilesChanged}
        />
      </div>
    </>
  );
});
