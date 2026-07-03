import { useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { normalizePathForCompare } from '../../utils/pathUtils';
import { isMissingPathRollbackError } from '../../utils/pendingChangeRollback';
import type { I18nMessages } from '../../i18n/types';
import type { PendingFileChange } from './types';

export interface UsePendingChangesOptions {
  setPendingChanges: React.Dispatch<React.SetStateAction<PendingFileChange[]>>;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
  projectPathRef: React.MutableRefObject<string>;
  onFilesChangedRef?: React.MutableRefObject<((paths: string[]) => void) | undefined>;
  t: I18nMessages;
}

function normalizeFilePath(filePath: string): string {
  return normalizePathForCompare(filePath).toLowerCase();
}

export function usePendingChanges({
  setPendingChanges,
  setError,
  projectPathRef,
  onFilesChangedRef,
  t,
}: UsePendingChangesOptions) {
  const removePendingChange = useCallback(
    (change: PendingFileChange) => {
      setPendingChanges((prev) =>
        prev.filter(
          (item) => normalizeFilePath(item.filePath) !== normalizeFilePath(change.filePath)
        )
      );
    },
    [setPendingChanges]
  );

  const acceptPendingChange = useCallback(
    (change: PendingFileChange) => {
      removePendingChange(change);
    },
    [removePendingChange]
  );

  const rejectPendingChange = useCallback(
    async (change: PendingFileChange) => {
      const rootPath = projectPathRef.current?.trim();
      if (!rootPath) {
        setError(t.chat.rollbackFileFailed.replace('{error}', '未打开工作区项目'));
        return false;
      }

      try {
        if (change.existedBefore === false && change.beforeContent === null) {
          await invoke('delete_file_or_folder', {
            path: change.filePath,
            permanent: false,
            rootPath,
          });
          onFilesChangedRef?.current?.([change.filePath]);
        } else if (change.beforeContent !== null) {
          await invoke('write_file_content', {
            filePath: change.filePath,
            content: change.beforeContent,
          });
          onFilesChangedRef?.current?.([change.filePath]);
        } else {
          setError(t.chat.rollbackMissingBeforeContent.replace('{path}', change.filePath));
          return false;
        }

        removePendingChange(change);
        return true;
      } catch (error) {
        if (isMissingPathRollbackError(error)) {
          removePendingChange(change);
          setError(t.chat.rollbackFileMissingSkipped.replace('{path}', change.filePath));
          return true;
        }

        setError(t.chat.rollbackFileFailed.replace('{error}', String(error)));
        return false;
      }
    },
    [removePendingChange, setError, projectPathRef, onFilesChangedRef, t]
  );

  return {
    acceptPendingChange,
    rejectPendingChange,
    acceptAllPendingChanges: useCallback(() => {
      setPendingChanges([]);
    }, [setPendingChanges]),
  };
}
