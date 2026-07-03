/**
 * 拖拽预览窗口组件
 * 用于显示轻量级的拖拽预览（独立窗口）
 */
import { FileTypeIcon } from './shared/FileTypeIcon';

export function DragPreviewWindow() {
  const urlParams = new URLSearchParams(window.location.search);
  const name = urlParams.get('name') || '';

  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        background: 'rgba(0,0,0,0)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          padding: '6px 10px',
          backgroundColor: '#37373d',
          border: '1px solid rgba(0, 122, 204, 0.9)',
          borderRadius: '6px',
          color: '#cccccc',
          fontSize: '13px',
          maxWidth: '320px',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
        }}
      >
        <FileTypeIcon name={name} size={14} />
        <span>{name}</span>
      </div>
    </div>
  );
}
