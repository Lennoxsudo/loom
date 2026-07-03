import { useState, useRef, useCallback, useEffect } from 'react';
import {
  DEFAULT_PREVIEW_WIDTH,
  PREVIEW_MIN_WIDTH,
  PREVIEW_MAX_WIDTH,
} from '../../../types/chat';
import type { PreviewMode } from '../../FilePreviewPanel';

export interface UseAgentPreviewPanelOptions {
  selectedAgentId: string | null;
  panelContentRef: React.RefObject<HTMLDivElement | null>;
}

export interface UseAgentPreviewPanelResult {
  previewOpenByAgent: Record<string, boolean>;
  setPreviewOpenByAgent: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  previewModeByAgent: Record<string, PreviewMode>;
  setPreviewModeByAgent: React.Dispatch<React.SetStateAction<Record<string, PreviewMode>>>;
  previewWidth: number;
  setPreviewWidth: React.Dispatch<React.SetStateAction<number>>;
  isPreviewResizingRef: React.RefObject<boolean>;
  activePreviewOpen: boolean;
  activePreviewMode: PreviewMode;
  handlePreviewResizeStart: () => void;
}

export function useAgentPreviewPanel(options: UseAgentPreviewPanelOptions): UseAgentPreviewPanelResult {
  const { selectedAgentId, panelContentRef } = options;

  const [previewOpenByAgent, setPreviewOpenByAgent] = useState<Record<string, boolean>>({});
  const [previewModeByAgent, setPreviewModeByAgent] = useState<Record<string, PreviewMode>>({});
  const [previewWidth, setPreviewWidth] = useState(DEFAULT_PREVIEW_WIDTH);
  const isPreviewResizingRef = useRef(false);

  const activePreviewOpen = selectedAgentId ? !!previewOpenByAgent[selectedAgentId] : false;
  const activePreviewMode = selectedAgentId
    ? (previewModeByAgent[selectedAgentId] ?? 'preview')
    : 'preview';

  const handlePreviewResizeMove = useCallback((event: MouseEvent) => {
    if (!isPreviewResizingRef.current) return;
    const container = panelContentRef.current;
    if (!container) return;
    const containerRect = container.getBoundingClientRect();
    const rawWidth = containerRect.right - event.clientX;
    const nextWidth = Math.min(PREVIEW_MAX_WIDTH, Math.max(PREVIEW_MIN_WIDTH, rawWidth));
    setPreviewWidth(nextWidth);
  }, [panelContentRef]);

  const handlePreviewResizeEnd = useCallback(() => {
    isPreviewResizingRef.current = false;
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
    window.removeEventListener('mousemove', handlePreviewResizeMove);
    window.removeEventListener('mouseup', handlePreviewResizeEnd);
  }, [handlePreviewResizeMove]);

  const handlePreviewResizeStart = useCallback(() => {
    if (isPreviewResizingRef.current) return;
    isPreviewResizingRef.current = true;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    window.addEventListener('mousemove', handlePreviewResizeMove);
    window.addEventListener('mouseup', handlePreviewResizeEnd);
  }, [handlePreviewResizeEnd, handlePreviewResizeMove]);

  useEffect(() => {
    if (activePreviewOpen) return;
    handlePreviewResizeEnd();
  }, [activePreviewOpen, handlePreviewResizeEnd]);

  useEffect(() => {
    return () => {
      window.removeEventListener('mousemove', handlePreviewResizeMove);
      window.removeEventListener('mouseup', handlePreviewResizeEnd);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };
  }, [handlePreviewResizeMove, handlePreviewResizeEnd]);

  return {
    previewOpenByAgent,
    setPreviewOpenByAgent,
    previewModeByAgent,
    setPreviewModeByAgent,
    previewWidth,
    setPreviewWidth,
    isPreviewResizingRef,
    activePreviewOpen,
    activePreviewMode,
    handlePreviewResizeStart,
  };
}
