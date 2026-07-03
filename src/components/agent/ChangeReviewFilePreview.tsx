import { memo, useState } from 'react';
import FilePreviewPanel, { type PreviewMode } from '../FilePreviewPanel';
import type { PendingFileChange } from './utils';

export interface ChangeReviewFilePreviewProps {
  change: PendingFileChange;
  onClose: () => void;
}

const ChangeReviewFilePreview = memo(function ChangeReviewFilePreview({
  change,
  onClose,
}: ChangeReviewFilePreviewProps) {
  const [mode, setMode] = useState<PreviewMode>('diff');

  return (
    <FilePreviewPanel
      isOpen
      onClose={onClose}
      embedded
      mode={mode}
      onModeChange={setMode}
      previewWidth={420}
      filePath={change.filePath}
      originalContent={change.beforeContent ?? ''}
      modifiedContent={change.afterContent}
      content={change.afterContent}
    />
  );
});

export default ChangeReviewFilePreview;
