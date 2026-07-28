import type { QueuedComposerItem } from '../../hooks/useChatSendDuringStreamingDispatch';
import styles from './ComposerSendQueue.module.css';

function buildPreview(
  item: QueuedComposerItem,
  labels: { noText: string; images: string; files: string }
): { text: string; hasText: boolean } {
  const text = item.inputValue.trim().replace(/\s+/g, ' ');
  if (text) {
    return { text, hasText: true };
  }

  const parts: string[] = [];
  if (item.attachedImages.length > 0) {
    parts.push(labels.images.replace('{count}', String(item.attachedImages.length)));
  }
  if (item.attachedFiles.length > 0) {
    parts.push(labels.files.replace('{count}', String(item.attachedFiles.length)));
  }
  return { text: parts.join(' · ') || labels.noText, hasText: false };
}

export interface ComposerSendQueueProps {
  items: QueuedComposerItem[];
  onRestore: (id: string) => void;
  onRemove: (id: string) => void;
  title: string;
  restoreLabel: string;
  removeLabel: string;
  noTextLabel: string;
  imagesLabel: string;
  filesLabel: string;
}

export default function ComposerSendQueue({
  items,
  onRestore,
  onRemove,
  title,
  restoreLabel,
  removeLabel,
  noTextLabel,
  imagesLabel,
  filesLabel,
}: ComposerSendQueueProps) {
  if (items.length === 0) {
    return null;
  }

  return (
    <div className={styles.queue} role="region" aria-label={title}>
      <div className={styles.header}>
        <span className={styles.title}>{title}</span>
        <span className={styles.count}>{items.length}</span>
      </div>
      <ul className={styles.list}>
        {items.map((item, index) => {
          const preview = buildPreview(item, {
            noText: noTextLabel,
            images: imagesLabel,
            files: filesLabel,
          });
          return (
            <li key={item.id} className={styles.item}>
              <span className={styles.index}>{index + 1}</span>
              <span className={`${styles.preview} ${preview.hasText ? '' : styles.meta}`}>
                {preview.text}
              </span>
              <div className={styles.actions}>
                <button
                  type="button"
                  className={`${styles.actionButton} ${styles.restoreButton}`}
                  onClick={() => onRestore(item.id)}
                  title={restoreLabel}
                  aria-label={restoreLabel}
                >
                  ↩
                </button>
                <button
                  type="button"
                  className={styles.actionButton}
                  onClick={() => onRemove(item.id)}
                  title={removeLabel}
                  aria-label={removeLabel}
                >
                  ✕
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
