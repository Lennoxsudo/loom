import type { ReactNode } from 'react';
import type {
  EditorGroupId,
  EditorGroupState,
  OpenFilesByPath,
  SplitDirection,
} from '../../types/app';
import { EditorGroupView } from './EditorGroupView';
import { SplitRightDropZone, SplitDownDropZone, OpenLeftDropZone } from './DropZones';

export interface EditorSplitViewProps {
  isSplit: boolean;
  splitDirection: SplitDirection;
  activeSplitRatio: number;
  isEditorSplitResizing: boolean;
  editorSplitContainerRef: React.RefObject<HTMLDivElement | null>;
  group1: EditorGroupState;
  group2: EditorGroupState | null;
  activeGroupId: EditorGroupId;
  openFilesByPath: OpenFilesByPath;
  hoveredTabId: string | null;
  activeNode: { is_dir: boolean } | null;
  activeTab: { groupId: string; filePath: string } | null;
  canConvertRowToColumn: boolean;
  canConvertColumnToRow: boolean;
  setIsEditorSplitResizing: (resizing: boolean) => void;
  setHoveredTabId: (id: string | null) => void;
  handleActivateTab: (groupId: EditorGroupId, filePath: string) => void;
  handleCloseTab: (e: React.MouseEvent, groupId: EditorGroupId, filePath: string) => void;
  isAnyAgentBusy: boolean;
  handleEditorChange: (filePath: string, value: string | undefined, ev?: unknown) => void;
  handleEditorMount: (groupId: EditorGroupId, editor: unknown, filePath: string) => void;
  handleFocusGroup: (groupId: EditorGroupId) => void;
  handleSplitRight: (sourceGroupId: EditorGroupId) => void;
  handleSplitDown: (sourceGroupId: EditorGroupId) => void;
  handleSingle: () => void;
  tabSize: 2 | 4 | 8;
  fontSize: number;
  wordWrap: boolean;
  lineNumbers: boolean;
  minimap: boolean;
  cursorStyle: 'line' | 'block' | 'underline';
  cursorBlinking: 'blink' | 'smooth' | 'phase' | 'solid';
  themeMode: 'system' | 'dark' | 'light';
  renderWhitespace: 'none' | 'boundary' | 'selection' | 'all';
  currentLineHighlight: boolean;
  bracketPairColorization: boolean;
  projectPath: string;
  handleFilesChanged?: (paths: string[]) => void;
}

export function EditorSplitView({
  isSplit,
  splitDirection,
  activeSplitRatio,
  isEditorSplitResizing,
  editorSplitContainerRef,
  group1,
  group2,
  activeGroupId,
  openFilesByPath,
  hoveredTabId,
  activeNode,
  activeTab,
  canConvertRowToColumn,
  canConvertColumnToRow,
  setIsEditorSplitResizing,
  setHoveredTabId,
  handleActivateTab,
  handleCloseTab,
  isAnyAgentBusy,
  handleEditorChange,
  handleEditorMount,
  handleFocusGroup,
  handleSplitRight,
  handleSplitDown,
  handleSingle,
  tabSize,
  fontSize,
  wordWrap,
  lineNumbers,
  minimap,
  cursorStyle,
  cursorBlinking,
  themeMode,
  renderWhitespace,
  currentLineHighlight,
  bracketPairColorization,
  projectPath,
  handleFilesChanged,
}: EditorSplitViewProps): ReactNode {
  return (
    <div
      ref={editorSplitContainerRef}
      style={{
        flex: 1,
        display: 'flex',
        position: 'relative',
        flexDirection: isSplit ? (splitDirection === 'row' ? 'row' : 'column') : 'row',
        overflow: 'hidden',
        minHeight: 0,
      }}
    >
      <OpenLeftDropZone active={!isSplit && !!activeNode && !activeNode.is_dir} />
      <SplitDownDropZone
        active={
          (!isSplit && (!!activeTab || (!!activeNode && !activeNode.is_dir))) ||
          canConvertRowToColumn
        }
      />
      <SplitRightDropZone
        active={
          (!isSplit && (!!activeTab || (!!activeNode && !activeNode.is_dir))) ||
          canConvertColumnToRow
        }
      />

      {group1 && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            flexGrow: isSplit ? activeSplitRatio : 1,
            flexShrink: 1,
            flexBasis: 0,
            minWidth: splitDirection === 'row' && isSplit ? '180px' : undefined,
            minHeight: splitDirection === 'column' && isSplit ? '140px' : 0,
          }}
        >
          <EditorGroupView
            group={group1}
            openFilesByPath={openFilesByPath}
            hoveredTabId={hoveredTabId}
            isFocused={activeGroupId === group1.id}
            isSplit={isSplit}
            splitDirection={splitDirection}
            onHoverTab={setHoveredTabId}
            onActivateTab={handleActivateTab}
            onCloseTab={handleCloseTab}
            isAgentBusy={isAnyAgentBusy}
            onEditorChange={handleEditorChange}
            onEditorMount={handleEditorMount}
            onFocusGroup={handleFocusGroup}
            onSplitRight={handleSplitRight}
            onSplitDown={handleSplitDown}
            onSingle={handleSingle}
            showLeadingBorder={false}
            showControls={!isSplit || splitDirection === 'column'}
            tabSize={tabSize}
            fontSize={fontSize}
            wordWrap={wordWrap}
            lineNumbers={lineNumbers}
            minimap={minimap}
            cursorStyle={cursorStyle}
            cursorBlinking={cursorBlinking}
            themeMode={themeMode}
            renderWhitespace={renderWhitespace}
            currentLineHighlight={currentLineHighlight}
            bracketPairColorization={bracketPairColorization}
            projectPath={projectPath}
            onFilesChanged={handleFilesChanged}
          />
        </div>
      )}

      {isSplit && group2 && (
        <>
          <div
            onMouseDown={(e) => {
              e.preventDefault();
              setIsEditorSplitResizing(true);
            }}
            style={{
              flexShrink: 0,
              width: splitDirection === 'row' ? '4px' : '100%',
              height: splitDirection === 'column' ? '4px' : '100%',
              cursor: splitDirection === 'row' ? 'col-resize' : 'row-resize',
              backgroundColor: isEditorSplitResizing
                ? 'var(--panel-resizer-active)'
                : 'var(--panel-resizer-muted)',
              transition: isEditorSplitResizing ? 'none' : 'background-color 0.1s',
            }}
            onMouseEnter={(e) => {
              if (!isEditorSplitResizing)
                e.currentTarget.style.backgroundColor = 'var(--panel-resizer-active)';
            }}
            onMouseLeave={(e) => {
              if (!isEditorSplitResizing)
                e.currentTarget.style.backgroundColor = 'var(--panel-resizer-muted)';
            }}
          />

          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              flexGrow: 1 - activeSplitRatio,
              flexShrink: 1,
              flexBasis: 0,
              minWidth: splitDirection === 'row' ? '180px' : undefined,
              minHeight: splitDirection === 'column' ? '140px' : 0,
            }}
          >
            <EditorGroupView
              group={group2}
              openFilesByPath={openFilesByPath}
              hoveredTabId={hoveredTabId}
              isFocused={activeGroupId === group2.id}
              isSplit={isSplit}
              splitDirection={splitDirection}
              onHoverTab={setHoveredTabId}
              onActivateTab={handleActivateTab}
              onCloseTab={handleCloseTab}
              isAgentBusy={isAnyAgentBusy}
              onEditorChange={handleEditorChange}
              onEditorMount={handleEditorMount}
              onFocusGroup={handleFocusGroup}
              onSplitRight={handleSplitRight}
              onSplitDown={handleSplitDown}
              onSingle={handleSingle}
              showLeadingBorder={true}
              showControls={splitDirection === 'row'}
              tabSize={tabSize}
              fontSize={fontSize}
              wordWrap={wordWrap}
              lineNumbers={lineNumbers}
              minimap={minimap}
              cursorStyle={cursorStyle}
              cursorBlinking={cursorBlinking}
              themeMode={themeMode}
              renderWhitespace={renderWhitespace}
              currentLineHighlight={currentLineHighlight}
              bracketPairColorization={bracketPairColorization}
              projectPath={projectPath}
              onFilesChanged={handleFilesChanged}
            />
          </div>
        </>
      )}
    </div>
  );
}
