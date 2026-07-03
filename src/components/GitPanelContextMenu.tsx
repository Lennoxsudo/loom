import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import fileTreeContextStyles from './FileTreeContextMenu.module.css';

export type GitPanelMenuEntry =
  | { kind: 'item'; key: string; label: string; onSelect: () => void; danger?: boolean }
  | { kind: 'sep'; key: string };

type GitPanelContextMenuProps = {
  x: number;
  y: number;
  onClose: () => void;
  entries: GitPanelMenuEntry[];
};

export function GitPanelContextMenu({ x, y, onClose, entries }: GitPanelContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y, ready: false });

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) {
      setPosition({ left: x, top: y, ready: true });
      return;
    }

    const margin = 8;
    const rect = menu.getBoundingClientRect();
    const maxLeft = Math.max(margin, window.innerWidth - rect.width - margin);
    const maxTop = Math.max(margin, window.innerHeight - rect.height - margin);

    setPosition({
      left: Math.min(Math.max(x, margin), maxLeft),
      top: Math.min(Math.max(y, margin), maxTop),
      ready: true,
    });
  }, [x, y]);

  useEffect(() => {
    const handleMouseDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('mousedown', handleMouseDown, true);
    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('blur', onClose);
    window.addEventListener('resize', onClose);

    return () => {
      window.removeEventListener('mousedown', handleMouseDown, true);
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('blur', onClose);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      role="menu"
      className={fileTreeContextStyles.contextMenu}
      style={{
        left: position.left,
        top: position.top,
        visibility: position.ready ? 'visible' : 'hidden',
      }}
      onMouseDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      {entries.map((entry) => {
        if (entry.kind === 'sep') {
          return <div key={entry.key} className={fileTreeContextStyles.menuSeparator} />;
        }
        const cls =
          entry.danger === true
            ? `${fileTreeContextStyles.menuItem} ${fileTreeContextStyles.menuItemDanger}`
            : fileTreeContextStyles.menuItem;
        return (
          <div
            key={entry.key}
            role="menuitem"
            className={cls}
            onMouseDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              entry.onSelect();
              onClose();
            }}
          >
            {entry.label}
          </div>
        );
      })}
    </div>
  );
}
