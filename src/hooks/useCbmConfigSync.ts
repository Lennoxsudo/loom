import { useEffect } from 'react';
import {
  useEnableCodeGraph,
  useGraphAutoIndexMaxFiles,
  useGraphAutoIndexOnOpen,
} from '../stores';
import { useCbmGraphReady } from '../stores/useCbmStore';
import { syncCbmConfig } from '../utils/cbmRuntime';
import { useNotification } from '../contexts/NotificationContext';
import { useTranslation } from '../i18n';

/** Keep CBM config.json (auto_index / limit) aligned with Loom graph settings. */
export function useCbmConfigSync(): void {
  const enableCodeGraph = useEnableCodeGraph();
  const graphAutoIndexOnOpen = useGraphAutoIndexOnOpen();
  const graphAutoIndexMaxFiles = useGraphAutoIndexMaxFiles();
  const cbmReady = useCbmGraphReady(enableCodeGraph);
  const { showWarning } = useNotification();
  const t = useTranslation();

  useEffect(() => {
    if (!cbmReady) {
      void syncCbmConfig({ autoIndex: false });
      return;
    }
    void syncCbmConfig({
      autoIndex: graphAutoIndexOnOpen,
      autoIndexLimit: graphAutoIndexMaxFiles,
    }).then((result) => {
      if (result && !result.success) {
        showWarning(t.graph.configSyncFailed);
      }
    });
  }, [cbmReady, graphAutoIndexMaxFiles, graphAutoIndexOnOpen, showWarning, t.graph.configSyncFailed]);
}
