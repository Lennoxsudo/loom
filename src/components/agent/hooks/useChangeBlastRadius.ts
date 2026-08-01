import { useCallback, useRef, useState } from 'react';
import {
  loadChangeBlastRadius,
  type BlastRadiusResult,
} from '../../../utils/changeBlastRadius';
import type { PendingFileChange } from '../utils';

export function useChangeBlastRadius(projectPath: string) {
  const [loadingChangeId, setLoadingChangeId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BlastRadiusResult | null>(null);
  const [activeChangeId, setActiveChangeId] = useState<string | null>(null);
  const requestSeqRef = useRef(0);

  const clear = useCallback(() => {
    requestSeqRef.current += 1;
    setLoadingChangeId(null);
    setError(null);
    setResult(null);
    setActiveChangeId(null);
  }, []);

  const load = useCallback(
    async (change: PendingFileChange) => {
      const seq = ++requestSeqRef.current;
      setActiveChangeId(change.id);
      setLoadingChangeId(change.id);
      setError(null);

      try {
        const next = await loadChangeBlastRadius({
          projectPath,
          filePath: change.filePath,
        });
        if (seq !== requestSeqRef.current) return;
        if (next.error) {
          setError(next.error);
          setResult(next);
        } else {
          setResult(next);
        }
      } catch (err) {
        if (seq !== requestSeqRef.current) return;
        setError(err instanceof Error ? err.message : String(err));
        setResult(null);
      } finally {
        if (seq === requestSeqRef.current) {
          setLoadingChangeId(null);
        }
      }
    },
    [projectPath]
  );

  return {
    loadingChangeId,
    activeChangeId,
    error,
    result,
    load,
    clear,
  };
}
