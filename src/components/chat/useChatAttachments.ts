import { useState, useCallback, useEffect } from 'react';
import { invoke, convertFileSrc, isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useDroppable } from '@dnd-kit/core';
import { isImageFilePath } from '../../utils/fileTreeUtils';
import type { VisionCapability, AIProvider } from '../../utils/visionCapabilities';
import { DEFAULT_VISION_CAPABILITIES, ALLOWED_IMAGE_MEDIA_TYPES } from '../../utils/visionCapabilities';
import { logDebug } from '../../utils/errorHandling';
import {
  CHAT_ATTACH_ZONE_ID,
  CHAT_ATTACH_FILE_EVENT,
  VISION_UNSUPPORTED_ERROR,
  type AttachedFile,
  type ImageAttachment,
  type PendingImageAttachment,
} from './types';

export interface UseChatAttachmentsOptions {
  selectedProvider: AIProvider;
  visionCapabilities: Record<AIProvider, VisionCapability>;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
  inputCardRef: React.RefObject<HTMLDivElement | null>;
}

export function useChatAttachments({
  selectedProvider,
  visionCapabilities,
  setError,
  inputCardRef,
}: UseChatAttachmentsOptions) {
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const [attachedImages, setAttachedImages] = useState<PendingImageAttachment[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);

  const { setNodeRef: setChatAttachRef, isOver: isOverChatAttach } = useDroppable({
    id: CHAT_ATTACH_ZONE_ID,
  });

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };

  function clearAttachedImages() {
    setAttachedImages((prev) => {
      prev.forEach((image) => {
        URL.revokeObjectURL(image.previewUrl);
      });
      return [];
    });
  }

  const removeImageFromContext = (id: string) => {
    setAttachedImages((prev) => {
      const target = prev.find((img) => img.id === id);
      if (target) {
        URL.revokeObjectURL(target.previewUrl);
      }
      return prev.filter((img) => img.id !== id);
    });
  };

  const addImageBlobsToContext = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;

      const capability =
        visionCapabilities[selectedProvider] || DEFAULT_VISION_CAPABILITIES[selectedProvider];
      const existingCount = attachedImages.length;
      const slotsRemaining = Math.max(capability.visionMaxImages - existingCount, 0);

      if (slotsRemaining <= 0) {
        setError(`当前最多支持 ${capability.visionMaxImages} 张图片`);
        return;
      }

      const imageFiles = files.filter((file) => ALLOWED_IMAGE_MEDIA_TYPES.has(file.type));
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
            URL.revokeObjectURL(img.previewUrl);
          }
          return !duplicated;
        });
        return [...prev, ...filtered];
      });

      setError((prev) => (prev === VISION_UNSUPPORTED_ERROR ? null : prev));
    },
    [attachedImages.length, selectedProvider, visionCapabilities, setError]
  );

  const handleInputPaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
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
  };

  const addImagePathToContext = useCallback(
    async (filePath: string) => {
      const capability =
        visionCapabilities[selectedProvider] || DEFAULT_VISION_CAPABILITIES[selectedProvider];

      if (!capability.supportsVision) {
        setError(VISION_UNSUPPORTED_ERROR);
        return;
      }

      if (attachedImages.length >= capability.visionMaxImages) {
        setError(`当前最多支持 ${capability.visionMaxImages} 张图片`);
        return;
      }

      try {
        const saved = await invoke<ImageAttachment>('save_chat_image_from_path', {
          payload: { path: filePath, fileName: filePath.split(/[\\/]/).pop() || undefined },
        });

        const previewUrl = convertFileSrc(saved.path);
        setAttachedImages((prev) => {
          if (prev.some((img) => img.path === saved.path)) return prev;
          return [...prev, { ...saved, previewUrl }];
        });
        setError((prev) => (prev === VISION_UNSUPPORTED_ERROR ? null : prev));
      } catch (err) {
        setError(`读取图片失败: ${err}`);
      }
    },
    [attachedImages.length, selectedProvider, visionCapabilities, setError]
  );

  const addFileToContext = useCallback(async (path: string, name: string) => {
    setAttachedFiles((prev) => {
      if (prev.some((f) => f.path === path)) {
        logDebug('文件已添加: ' + name, 'ChatPanel');
        return prev;
      }

      const newFile: AttachedFile = {
        path,
        name,
        id: `file-${Date.now()}-${Math.random()}`,
      };

      logDebug('添加文件到上下文: ' + JSON.stringify(newFile), 'ChatPanel');
      return [...prev, newFile];
    });
  }, []);

  const removeFileFromContext = (id: string) => {
    setAttachedFiles((prev) => prev.filter((f) => f.id !== id));
  };

  const handleDrop = async (e: React.DragEvent) => {
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

      const nonImageFiles = droppedFiles.filter(
        (file) => !(file.type ? file.type.startsWith('image/') : isImageFilePath(file.name))
      );
      for (const file of nonImageFiles) {
        const localPath = (file as File & { path?: string }).path;
        if (localPath) {
          await addFileToContext(localPath, file.name);
        }
      }
    }

    const filePath = e.dataTransfer.getData('application/file-path');
    const fileName = e.dataTransfer.getData('application/file-name');

    if (filePath && fileName) {
      if (isImageFilePath(filePath)) {
        await addImagePathToContext(filePath);
      } else {
        await addFileToContext(filePath, fileName);
      }
    }
  };

  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ path: string; name: string }>;
      const path = ce.detail?.path;
      const name = ce.detail?.name;
      if (!path || !name) return;
      void addFileToContext(path, name);
    };

    window.addEventListener(CHAT_ATTACH_FILE_EVENT, handler as EventListener);
    return () => window.removeEventListener(CHAT_ATTACH_FILE_EVENT, handler as EventListener);
  }, [addFileToContext]);

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

            const card = inputCardRef.current;
            if (!card) return;
            const rect = card.getBoundingClientRect();
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
    attachedFiles,
    setAttachedFiles,
    attachedImages,
    setAttachedImages,
    isDragOver,
    isOverChatAttach,
    setChatAttachRef,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleInputPaste,
    addImageBlobsToContext,
    addImagePathToContext,
    addFileToContext,
    removeFileFromContext,
    removeImageFromContext,
    clearAttachedImages,
  };
}
