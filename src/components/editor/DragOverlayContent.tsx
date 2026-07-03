import type { ReactNode } from 'react';
import type { OpenFilesByPath } from '../../types/app';
import { getBasename } from '../../utils/pathUtils';
import { FileTypeIcon } from '../shared/FileTypeIcon';

export interface DragOverlayContentProps {
  activeNode: { is_dir: boolean; name: string } | null;
  activeTab: { filePath: string } | null;
  openFilesByPath: OpenFilesByPath;
}

export function DragOverlayContent({
  activeNode,
  activeTab,
  openFilesByPath,
}: DragOverlayContentProps): ReactNode {
  const dragStyle = {
    padding: '2px 5px',
    backgroundColor: '#37373d',
    border: '1px solid #007acc',
    borderRadius: '3px',
    fontSize: '13px',
    color: '#cccccc',
    display: 'flex',
    alignItems: 'center',
    opacity: 0.9,
    pointerEvents: 'none',
  } as const;

  if (activeNode) {
    return (
      <div style={dragStyle}>
        <span style={{ marginRight: '5px', display: 'inline-flex' }}>
          <FileTypeIcon name={activeNode.name} isDir={activeNode.is_dir} />
        </span>
        <span>{activeNode.name}</span>
      </div>
    );
  }

  if (activeTab) {
    const fileName =
      openFilesByPath[activeTab.filePath]?.name || getBasename(activeTab.filePath);
    return (
      <div style={dragStyle}>
        <span style={{ marginRight: '5px', display: 'inline-flex' }}>
          <FileTypeIcon name={fileName} />
        </span>
        <span>{fileName}</span>
      </div>
    );
  }

  return null;
}
