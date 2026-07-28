import { memo, useEffect, useRef } from 'react';
import type { ContextAnnotationKind } from '../../utils/contextAnnotations';
import styles from './SlashSkillMenu.module.css';

export interface ContextMentionItem {
  kind: ContextAnnotationKind;
  /** Token inserted after @ */
  label: string;
  /** Absolute or relative path stored in annotation */
  path: string;
  description?: string;
}

export interface ContextMentionMenuProps {
  items: ContextMentionItem[];
  highlightIndex: number;
  onHighlight: (index: number) => void;
  onSelect: (item: ContextMentionItem) => void;
  label?: string;
}

const ContextMentionMenu = memo(function ContextMentionMenu({
  items,
  highlightIndex,
  onHighlight,
  onSelect,
  label = 'Context',
}: ContextMentionMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const active = menuRef.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    active?.scrollIntoView({ block: 'nearest' });
  }, [highlightIndex, items.length]);

  if (items.length === 0) return null;

  return (
    <div ref={menuRef} className={styles.menu} role="listbox" aria-label={label}>
      <ul className={styles.list}>
        {items.map((item, index) => {
          const active = index === highlightIndex;
          return (
            <li key={`${item.kind}:${item.label}`} role="presentation">
              <button
                type="button"
                role="option"
                aria-selected={active}
                className={`${styles.item} ${active ? styles.itemActive : ''}`}
                onMouseEnter={() => onHighlight(index)}
                onMouseDown={(e) => {
                  e.preventDefault();
                }}
                onClick={() => onSelect(item)}
              >
                <div className={styles.nameRow}>
                  <span className={styles.name}>@{item.label}</span>
                  <span className={styles.hint}>{item.kind}</span>
                </div>
                {item.description ? (
                  <div className={styles.description} title={item.description}>
                    {item.description}
                  </div>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
});

export default ContextMentionMenu;
