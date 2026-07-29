import { memo, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import FilePreviewPanel, { type PreviewMode } from '../FilePreviewPanel';
import { useTranslation } from '../../i18n';
import { readCheckpointFileContent } from '../../utils/checkpointService';
import type { AgentCheckpoint } from '../../utils/checkpointTimeline';
import styles from './ChangeReviewPanel.module.css';

type CheckpointFile = AgentCheckpoint['files'][number];

export interface CheckpointFilePreviewProps {
  checkpoint: AgentCheckpoint;
  file: CheckpointFile;
  onClose: () => void;
}

const CheckpointFilePreview = memo(function CheckpointFilePreview({
  checkpoint,
  file,
  onClose,
}: CheckpointFilePreviewProps) {
  const t = useTranslation();
  const [mode, setMode] = useState<PreviewMode>('diff');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [checkpointContent, setCheckpointContent] = useState('');
  const [currentContent, setCurrentContent] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        if (file.isBinary || (file.existed && !file.blob)) {
          if (!cancelled) {
            setError(t.agent.changeReview.binarySkipped);
            setCheckpointContent('');
            setCurrentContent('');
          }
          return;
        }

        const [snapshot, current] = await Promise.all([
          file.existed
            ? readCheckpointFileContent({
                sessionKey: checkpoint.sessionKey,
                checkpointId: checkpoint.id,
                filePath: file.path,
              })
            : Promise.resolve(''),
          invoke<string>('read_file_content', { filePath: file.path }).catch(() => ''),
        ]);

        if (!cancelled) {
          setCheckpointContent(snapshot);
          setCurrentContent(current);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : t.agent.changeReview.diffError);
          setCheckpointContent('');
          setCurrentContent('');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [
    checkpoint.id,
    checkpoint.sessionKey,
    file.blob,
    file.existed,
    file.isBinary,
    file.path,
    t.agent.changeReview.binarySkipped,
    t.agent.changeReview.diffError,
  ]);

  if (loading) {
    return <div className={styles.empty}>{t.agent.changeReview.loadingDiff}</div>;
  }

  if (error) {
    return <div className={styles.empty}>{error}</div>;
  }

  return (
    <FilePreviewPanel
      isOpen
      onClose={onClose}
      embedded
      mode={mode}
      onModeChange={setMode}
      previewWidth={420}
      filePath={file.path}
      originalContent={checkpointContent}
      modifiedContent={currentContent}
      content={currentContent}
    />
  );
});

export default CheckpointFilePreview;
