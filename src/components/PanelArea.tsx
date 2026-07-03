import { type CSSProperties } from 'react';
import TerminalPanel from './TerminalPanel';

export interface PanelAreaProps {
  isTerminalOpen: boolean;
  terminalHeight: number;
  isTerminalResizing: boolean;
  projectPath: string | null | undefined;
  terminalWorkingDir: string | null;
  onTerminalResizeStart: (e: React.MouseEvent) => void;
  onSetIsTerminalOpen: (open: boolean) => void;
  onSetHasTerminals: (has: boolean) => void;
}

const terminalResizeHandleStyle: CSSProperties = {
  height: '4px',
  cursor: 'row-resize',
  flexShrink: 0,
  userSelect: 'none',
  position: 'relative',
  background: 'transparent',
  transition: 'background 0.1s',
};

export function PanelArea({
  isTerminalOpen,
  terminalHeight,
  isTerminalResizing,
  projectPath,
  terminalWorkingDir,
  onTerminalResizeStart,
  onSetIsTerminalOpen,
  onSetHasTerminals,
}: PanelAreaProps) {
  const resolvedProjectPath = projectPath ?? undefined;
  return (
    <>
      {isTerminalOpen && (
        <div
          onMouseDown={onTerminalResizeStart}
          style={{
            ...terminalResizeHandleStyle,
            background: isTerminalResizing ? 'var(--panel-resizer-active)' : undefined,
          }}
          onMouseEnter={(e) => {
            if (!isTerminalResizing) {
              e.currentTarget.style.background = 'var(--panel-resizer-active)';
            }
          }}
          onMouseLeave={(e) => {
            if (!isTerminalResizing) {
              e.currentTarget.style.background = 'transparent';
            }
          }}
        />
      )}

      <TerminalPanel
        height={terminalHeight}
        visible={isTerminalOpen}
        onCloseAll={() => onSetIsTerminalOpen(false)}
        onHide={() => onSetIsTerminalOpen(false)}
        onHasTerminalsChange={onSetHasTerminals}
        projectPath={resolvedProjectPath || ''}
        workingDir={terminalWorkingDir || undefined}
      />
    </>
  );
}
