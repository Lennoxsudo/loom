/**
 * 项目根目录头部组件
 */

import { useDroppable } from '@dnd-kit/core';
import { useTranslation } from '../i18n';
import { FileTypeIcon } from './shared/FileTypeIcon';

interface ProjectRootHeaderProps {
  projectName: string;
  projectPath: string;
  isFileTreeCollapsed: boolean;
  onToggleCollapse: () => void;
  onCreateFolder: () => void;
  onCreateFile: () => void;
  onOpenFolder: () => void;
  onContextMenuBlank?: (x: number, y: number) => void;
}

export function ProjectRootHeader({
  projectName,
  projectPath,
  isFileTreeCollapsed,
  onToggleCollapse,
  onCreateFolder,
  onCreateFile,
  onOpenFolder,
  onContextMenuBlank,
}: ProjectRootHeaderProps) {
  const t = useTranslation();
  const { setNodeRef, isOver } = useDroppable({
    id: 'project-root',
  });

  return (
    <div
      ref={setNodeRef}
      onContextMenu={(e) => {
        if (!onContextMenuBlank) return;
        e.preventDefault();
        e.stopPropagation();
        onContextMenuBlank(e.clientX, e.clientY);
      }}
      style={{
        padding: '10px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderBottom: '1px solid var(--border-subtle)',
        backgroundColor: isOver ? 'var(--bg-hover)' : 'var(--bg-header)',
        boxShadow: isOver ? 'inset 0 0 0 1px var(--border-focus)' : 'none',
        transition: 'background-color 0.1s, box-shadow 0.1s',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          flex: 1,
          overflow: 'hidden',
          pointerEvents: 'none',
        }}
      >
        <span
          onClick={(e) => {
            e.stopPropagation();
            onToggleCollapse();
          }}
          style={{
            fontSize: '10px',
            color: 'var(--text-secondary)',
            transform: isFileTreeCollapsed ? 'rotate(0deg)' : 'rotate(90deg)',
            transition: 'transform 0.1s',
            display: 'inline-block',
            width: '12px',
            flexShrink: 0,
            cursor: 'pointer',
            pointerEvents: 'auto',
          }}
        >
          ▶
        </span>
        <span
          style={{
            fontWeight: 'bold',
            fontSize: '13px',
            color: 'var(--text-primary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            letterSpacing: '0.5px',
          }}
        >
          {projectName || t.project.noProjectOpen}
        </span>
      </div>

      {projectPath ? (
        <div style={{ display: 'flex', gap: '2px' }}>
          <button
            onMouseDown={(e) => {
              e.preventDefault();
              onCreateFolder();
            }}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontSize: '16px',
              padding: '0 2px',
              color: 'var(--text-primary)',
              display: 'inline-flex',
              alignItems: 'center',
            }}
            title={t.fileTree.newFolder}
          >
            <FileTypeIcon name="newfolder" isDir />
          </button>
          <button
            onMouseDown={(e) => {
              e.preventDefault();
              onCreateFile();
            }}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontSize: '16px',
              padding: '0 2px',
              color: 'var(--text-primary)',
              display: 'inline-flex',
              alignItems: 'center',
            }}
            title={t.fileTree.newFile}
          >
            <FileTypeIcon name="newfile" />
          </button>
        </div>
      ) : (
        <button
          onClick={onOpenFolder}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontSize: '16px',
            padding: '0 2px',
            color: 'var(--text-primary)',
          }}
          title={t.actions.openFolder}
        >
          <FileTypeIcon name={projectName} isDir isExpanded />
        </button>
      )}
    </div>
  );
}
