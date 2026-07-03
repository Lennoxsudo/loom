import { useState, useCallback, useEffect } from 'react';
import { invoke, convertFileSrc, isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { listen } from '@tauri-apps/api/event';
import {
  type VisionCapability,
  DEFAULT_VISION_CAPABILITIES,
  ALLOWED_IMAGE_MEDIA_TYPES,
  extractVisionCapabilities,
} from '../../../utils/visionCapabilities';
import { isImageFilePath } from '../../../utils/fileTreeUtils';
import type { AIProvider, Agent } from '../../../utils/agentPersistence';
import type { ImageAttachment, PendingImageAttachment } from '../../../types/chat';
import type { AttachedFile } from '../../chat/types';

export const VISION_UNSUPPORTED_ERROR = '当前模型不支持图片输入';

export interface UseAgentAttachmentsOptions {
  selectedAgent: Agent | null;
  isSelectedAgentBusy: boolean;
  inputCardRef: React.RefObject<HTMLElement | null>;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
}

export interface UseAgentAttachmentsResult {
  attachedImages: PendingImageAttachment[];
  attachedFiles: AttachedFile[];
  isDragOver: boolean;
  visionCapabilities: Record<AIProvider, VisionCapability>;
  handleInputPaste: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void;
  handleRemoveImage: (id: string) => void;
  clearAttachedImages: () => void;
  clearAttachedFiles: () => void;
  addFileToContext: (filePath: string, name: string) => void;
  removeFileFromContext: (id: string) => void;
  addImagePathToContext: (filePath: string) => Promise<void>;
  handleImageInputChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  handleDragOver: (e: React.DragEvent) => void;
  handleDragLeave: (e: React.DragEvent) => void;
  handleDrop: (e: React.DragEvent) => Promise<void>;
}

export function useAgentAttachments(options: UseAgentAttachmentsOptions): UseAgentAttachmentsResult {
  const { selectedAgent, isSelectedAgentBusy, inputCardRef, setError } = options;

  const [attachedImages, setAttachedImages] = useState<PendingImageAttachment[]>([]);
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [visionCapabilities, setVisionCapabilities] = useState<
    Record<AIProvider, VisionCapability>
  >(DEFAULT_VISION_CAPABILITIES);

  const revokeIfBlobUrl = useCallback((url: string) => {
    if (url.startsWith('blob:')) {
      URL.revokeObjectURL(url);
    }
  }, []);

  // Load vision config
  useEffect(() => {
    const loadVisionConfig = async () => {
      try {
        const configStr = await invoke<string>('load_ai_config');
        if (configStr) {
          const config = JSON.parse(configStr);
          setVisionCapabilities(extractVisionCapabilities(config));
        } else {
          setVisionCapabilities(DEFAULT_VISION_CAPABILITIES);
        }
      } catch {
        setVisionCapabilities(DEFAULT_VISION_CAPABILITIES);
      }
    };

    void loadVisionConfig();

    const unlisten = listen('ai-config-updated', () => {
      void loadVisionConfig();
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const addImageBlobsToContext = useCallback(
    async (files: File[]) => {
      if (!selectedAgent) return;
      const provider = selectedAgent.provider as AIProvider;
      const capability = visionCapabilities[provider] || DEFAULT_VISION_CAPABILITIES[provider];

      const existingCount = attachedImages.length;
      const slotsRemaining = Math.max(capability.visionMaxImages - existingCount, 0);

      if (slotsRemaining <= 0) {
        setError(`当前最多支持 ${capability.visionMaxImages} 张图片`);
        return;
      }

      const imageFiles = files.filter(
        (file) => ALLOWED_IMAGE_MEDIA_TYPES.has(file.type) || isImageFilePath(file.name)
      );
      if (imageFiles.length === 0) {
        return;
      }

      const limited = imageFiles.slice(0, slotsRemaining);
      if (imageFiles.length > limited.length) {
        setError(`图片数量超出限制，已截取前 ${limited.length} 张`);
      }

      const created: PendingImageAttachment[] = [];

      for (const file of limited) {
        if (file.size > capability.visionMaxBytes) {
          setError(
            `图片 ${file.name || '未命名'} 超出大小限制 (${Math.round(capability.visionMaxBytes / 1024 / 1024)}MB)`
          );
          continue;
        }

        try {
          const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
          const saved = await invoke<ImageAttachment>('save_chat_image', {
            payload: {
              bytes,
              mediaType: file.type,
              fileName: file.name || undefined,
            },
          });

          created.push({
            ...saved,
            previewUrl: URL.createObjectURL(file),
          });
        } catch (saveError) {
          setError(`保存图片失败: ${saveError}`);
        }
      }

      if (created.length === 0) {
        return;
      }

      setAttachedImages((prev) => {
        const existingPath = new Set(prev.map((img) => img.path));
        const filtered = created.filter((img) => {
          const duplicated = existingPath.has(img.path);
          if (duplicated) {
            revokeIfBlobUrl(img.previewUrl);
          }
          return !duplicated;
        });
        return [...prev, ...filtered];
      });

      setError((prev) => (prev === VISION_UNSUPPORTED_ERROR ? null : prev));
    },
    [attachedImages.length, selectedAgent, revokeIfBlobUrl, visionCapabilities, setError]
  );

  const handleInputPaste = useCallback(
    async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const clipboardItems = Array.from(e.clipboardData?.items || []);
      const imageFiles = clipboardItems
        .filter((item) => item.type.startsWith('image/'))
        .map((item) => item.getAsFile())
        .filter((file): file is File => !!file);

      if (imageFiles.length === 0) {
        return;
      }

      e.preventDefault();
      await addImageBlobsToContext(imageFiles);
    },
    [addImageBlobsToContext]
  );

  const handleRemoveImage = useCallback(
    (id: string) => {
      setAttachedImages((prev) => {
        const target = prev.find((img) => img.id === id);
        if (target) {
          revokeIfBlobUrl(target.previewUrl);
        }
        return prev.filter((img) => img.id !== id);
      });
    },
    [revokeIfBlobUrl]
  );

  const clearAttachedImages = useCallback(() => {
    setAttachedImages((prev) => {
      prev.forEach((img) => revokeIfBlobUrl(img.previewUrl));
      return [];
    });
  }, [revokeIfBlobUrl]);

  const clearAttachedFiles = useCallback(() => {
    setAttachedFiles([]);
  }, []);

  const addFileToContext = useCallback((filePath: string, name: string) => {
    setAttachedFiles((prev) => {
      if (prev.some((f) => f.path === filePath)) return prev;
      return [...prev, { path: filePath, name, id: `file-${Date.now()}-${Math.random()}` }];
    });
  }, []);

  const removeFileFromContext = useCallback((id: string) => {
    setAttachedFiles((prev) => prev.filter((f) => f.id !== id));
  }, []);

  const addImagePathToContext = useCallback(
    async (filePath: string) => {
      if (!selectedAgent) return;
      const provider = selectedAgent.provider as AIProvider;
      const capability = visionCapabilities[provider] || DEFAULT_VISION_CAPABILITIES[provider];

      if (!capability.supportsVision) {
        setError(VISION_UNSUPPORTED_ERROR);
        return;
      }

      if (attachedImages.length >= capability.visionMaxImages) {
        setError(`当前最多支持 ${capability.visionMaxImages} 张图片`);
        return;
      }

      try {
        const meta = await invoke<ImageAttachment>('save_chat_image_from_path', {
          payload: {
            path: filePath,
          },
        });
        if (meta.mediaType && !ALLOWED_IMAGE_MEDIA_TYPES.has(meta.mediaType)) {
          setError(`不支持的图片类型: ${meta.mediaType}`);
          return;
        }
        if (meta.size > capability.visionMaxBytes) {
          setError(
            `图片 ${meta.fileName || '未命名'} 超出大小限制 (${Math.round(capability.visionMaxBytes / 1024 / 1024)}MB)`
          );
          return;
        }
        setAttachedImages((prev) => {
          if (prev.some((img) => img.path === meta.path)) {
            return prev;
          }
          return [
            ...prev,
            {
              ...meta,
              previewUrl: convertFileSrc(meta.path),
            },
          ];
        });
        setError((prev) => (prev === VISION_UNSUPPORTED_ERROR ? null : prev));
      } catch (err) {
        setError(`读取图片失败: ${err}`);
      }
    },
    [attachedImages.length, selectedAgent, visionCapabilities, setError]
  );

  const handleImageInputChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files || []);
      event.target.value = '';
      if (files.length === 0) return;
      await addImageBlobsToContext(files);
    },
    [addImageBlobsToContext]
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!isSelectedAgentBusy) {
        setIsDragOver(true);
      }
    },
    [isSelectedAgentBusy]
  );

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);

      const droppedFiles = Array.from(e.dataTransfer.files || []);
      if (droppedFiles.length > 0) {
        const imageFiles = droppedFiles.filter((file) =>
          file.type ? file.type.startsWith('image/') : isImageFilePath(file.name)
        );
        if (imageFiles.length > 0) {
          await addImageBlobsToContext(imageFiles);
        }
      }

      // Handle files dragged from file tree (application/file-path)
      const filePath = e.dataTransfer.getData('application/file-path');
      const fileName = e.dataTransfer.getData('application/file-name');
      if (filePath) {
        if (isImageFilePath(filePath)) {
          await addImagePathToContext(filePath);
        } else {
          await addFileToContext(filePath, fileName || filePath.split(/[/\\]/).pop() || 'unknown');
        }
      }

      // Handle non-image files dropped from external file manager
      if (droppedFiles.length > 0) {
        const nonImageFiles = droppedFiles.filter(
          (file) => !(file.type ? file.type.startsWith('image/') : isImageFilePath(file.name))
        );
        for (const file of nonImageFiles) {
          // Tauri webview provides file.path for local files
          const localPath = (file as File & { path?: string }).path;
          if (localPath) {
            await addFileToContext(localPath, file.name);
          }
        }
      }
    },
    [addImageBlobsToContext, addImagePathToContext, addFileToContext]
  );

  // Listen for Tauri drag-drop events (external file drops from OS file manager)
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | null = null;

    const setup = async () => {
      try {
        const win = getCurrentWindow();
        unlisten = await win.onDragDropEvent((event) => {
          if (event.payload.type === 'drop') {
            setIsDragOver(false);
            const { paths, position } = event.payload;
            if (!paths || paths.length === 0) return;

            // Check if the drop position is within the input card area
            const card = inputCardRef.current;
            if (!card) return;
            const rect = card.getBoundingClientRect();
            // Tauri position uses physical pixels; convert to logical pixels
            const dpr = window.devicePixelRatio || 1;
            const x = position.x / dpr;
            const y = position.y / dpr;
            if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) return;

            for (const filePath of paths) {
              const fileName = filePath.split(/[/\\]/).pop() || 'unknown';
              if (isImageFilePath(filePath)) {
                void addImagePathToContext(filePath);
              } else {
                void addFileToContext(filePath, fileName);
              }
            }
          } else if (event.payload.type === 'over' || event.payload.type === 'enter') {
            // Show visual feedback when files hover over input area
            const { position } = event.payload;
            const card = inputCardRef.current;
            if (!card) return;
            const rect = card.getBoundingClientRect();
            const dpr = window.devicePixelRatio || 1;
            const x = position.x / dpr;
            const y = position.y / dpr;
            const isOver = x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
            setIsDragOver(isOver);
          } else if (event.payload.type === 'leave') {
            setIsDragOver(false);
          }
        });
      } catch {
        // Window API unavailable (e.g. in tests)
      }
    };

    void setup();
    return () => {
      if (unlisten) unlisten();
    };
  }, [addFileToContext, addImagePathToContext, inputCardRef]);

  return {
    attachedImages,
    attachedFiles,
    isDragOver,
    visionCapabilities,
    handleInputPaste,
    handleRemoveImage,
    clearAttachedImages,
    clearAttachedFiles,
    addFileToContext,
    removeFileFromContext,
    addImagePathToContext,
    handleImageInputChange,
    handleDragOver,
    handleDragLeave,
    handleDrop,
  };
}
