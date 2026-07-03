import { SendIcon, StopIcon, PlusIcon } from '../shared/Icons';
import { FileTypeIcon } from '../shared/FileTypeIcon';
import { VISION_UNSUPPORTED_ERROR } from './types';
import type { AttachedFile, PendingImageAttachment } from './types';
import styles from './ChatInputArea.module.css';

export interface ChatInputAreaProps {
  inputValue: string;
  setInputValue: React.Dispatch<React.SetStateAction<string>>;
  isLoading: boolean;
  isStopping: boolean;
  canSend: boolean;
  showStop: boolean;
  modelMissing: boolean;
  visionBlocked: boolean;
  isDragOver: boolean;
  isOverChatAttach: boolean;
  attachedFiles: AttachedFile[];
  attachedImages: PendingImageAttachment[];
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  inputCardRef: React.RefObject<HTMLDivElement | null>;
  setChatAttachRef: (node: HTMLDivElement | null) => void;
  handleDragOver: (e: React.DragEvent) => void;
  handleDragLeave: (e: React.DragEvent) => void;
  handleDrop: (e: React.DragEvent) => Promise<void>;
  handleInputPaste: (e: React.ClipboardEvent<HTMLTextAreaElement>) => Promise<void>;
  removeFileFromContext: (id: string) => void;
  removeImageFromContext: (id: string) => void;
  handleSendMessage: () => Promise<void>;
  handleStop: () => Promise<void>;
  onPickAttachFiles?: () => void | Promise<void>;
  metaLeft?: React.ReactNode;
  metaToolbarRight?: React.ReactNode;
  metaRight?: React.ReactNode;
  t: {
    errors: { selectModelFirst: string };
    chat: {
      enterYourQuestion: string;
      stopping: string;
      stopGenerating: string;
      attachFile: string;
    };
  };
}

export default function ChatInputArea({
  inputValue,
  setInputValue,
  isLoading,
  isStopping,
  canSend,
  showStop,
  modelMissing,
  visionBlocked,
  isDragOver,
  isOverChatAttach,
  attachedFiles,
  attachedImages,
  textareaRef,
  inputCardRef,
  setChatAttachRef,
  handleDragOver,
  handleDragLeave,
  handleDrop,
  handleInputPaste,
  removeFileFromContext,
  removeImageFromContext,
  handleSendMessage,
  handleStop,
  onPickAttachFiles,
  metaLeft,
  metaToolbarRight,
  metaRight,
  t,
}: ChatInputAreaProps) {
  const dragActive = isDragOver || isOverChatAttach;

  const sendClassName = showStop
    ? styles.sendButtonStop
    : canSend
      ? styles.sendButtonActive
      : styles.sendButtonDisabled;

  return (
    <>
      <div ref={setChatAttachRef} className={styles.shell}>
        <div
          ref={inputCardRef}
          className={`${styles.card} ${dragActive ? styles.cardDragOver : ''}`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={(e) => void handleDrop(e)}
        >
          {(attachedFiles.length > 0 || attachedImages.length > 0) && (
            <div className={styles.attachments}>
              {attachedImages.length > 0 && (
                <div className={styles.imageGrid}>
                  {attachedImages.map((image, index) => (
                    <div
                      key={image.id}
                      className={styles.imageThumb}
                      title={
                        image.fileName || image.path.split(/[\\/]/).pop() || `image-${index + 1}`
                      }
                    >
                      <img
                        src={image.previewUrl}
                        alt={image.fileName || `image-${index + 1}`}
                        draggable={false}
                      />
                      <button
                        type="button"
                        className={styles.removeImageButton}
                        onClick={() => removeImageFromContext(image.id)}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {attachedFiles.length > 0 && (
                <div className={styles.fileGrid}>
                  {attachedFiles.map((file) => (
                    <div key={file.id} className={styles.fileChip}>
                      <FileTypeIcon name={file.name} size={11} />
                      <span className={styles.fileName}>{file.name}</span>
                      <button
                        type="button"
                        className={styles.removeFileButton}
                        onClick={() => removeFileFromContext(file.id)}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className={styles.inputRow}>
            <button
              type="button"
              className={styles.attachButton}
              onClick={() => void onPickAttachFiles?.()}
              disabled={!onPickAttachFiles || isLoading || modelMissing}
              title={t.chat.attachFile}
              aria-label={t.chat.attachFile}
            >
              <PlusIcon size={14} />
            </button>
            <textarea
              ref={textareaRef}
              className={styles.textarea}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onPaste={(e) => void handleInputPaste(e)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  if (!modelMissing) void handleSendMessage();
                }
              }}
              placeholder={modelMissing ? t.errors.selectModelFirst : t.chat.enterYourQuestion}
              disabled={isLoading || modelMissing}
              rows={1}
            />
            <button
              type="button"
              className={`${styles.sendButton} ${sendClassName}`}
              onClick={() => (showStop ? void handleStop() : void handleSendMessage())}
              disabled={(!canSend && !showStop) || isStopping}
              title={
                isStopping
                  ? t.chat.stopping
                  : showStop
                    ? t.chat.stopGenerating
                    : modelMissing
                      ? t.errors.selectModelFirst
                      : visionBlocked
                        ? VISION_UNSUPPORTED_ERROR
                        : undefined
              }
            >
              {showStop ? <StopIcon size={13} /> : <SendIcon size={14} />}
            </button>
          </div>

          {(metaLeft || metaToolbarRight || metaRight) && (
            <div className={styles.footerRow}>
              <div className={styles.footerLeft}>{metaRight}</div>
              <div className={styles.footerRight}>
                {metaToolbarRight}
                {metaLeft && metaToolbarRight && <span className={styles.footerDivider} aria-hidden />}
                {metaLeft}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
