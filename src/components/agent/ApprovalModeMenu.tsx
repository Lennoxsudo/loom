import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDownIcon } from '../shared/Icons';
import { useTranslation } from '../../i18n';
import { useAgentAccessMode, useUpdateAgentAccessMode } from '../../stores';
import type { AgentAccessMode } from '../../types/settings';
import styles from './ApprovalModeMenu.module.css';

const MODE_ORDER: AgentAccessMode[] = ['read_only', 'auto', 'full_access'];

export interface ApprovalModeMenuProps {
  variant?: 'dropdown' | 'inline';
  onSelect?: () => void;
}

const ApprovalModeMenu = memo(function ApprovalModeMenu({
  variant = 'dropdown',
  onSelect,
}: ApprovalModeMenuProps) {
  const t = useTranslation();
  const accessMode = useAgentAccessMode();
  const updateAccessMode = useUpdateAgentAccessMode();
  const [isOpen, setIsOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const labels: Record<AgentAccessMode, string> = {
    read_only: t.agent.approvalMode.readOnly,
    auto: t.agent.approvalMode.auto,
    full_access: t.agent.approvalMode.fullAccess,
  };

  const badges: Record<AgentAccessMode, string> = {
    read_only: t.settingsAgent.accessMode.readOnlyBadge,
    auto: t.settingsAgent.accessMode.autoBadge,
    full_access: t.settingsAgent.accessMode.fullAccessBadge,
  };

  const handleSelect = useCallback(
    (mode: AgentAccessMode) => {
      void updateAccessMode(mode);
      setIsOpen(false);
      onSelect?.();
    },
    [onSelect, updateAccessMode]
  );

  const renderItems = () =>
    MODE_ORDER.map((mode) => (
      <button
        key={mode}
        type="button"
        role="menuitem"
        className={`${styles.item} ${accessMode === mode ? styles.itemActive : ''}`}
        onClick={() => handleSelect(mode)}
      >
        <span>{labels[mode]}</span>
        <span className={styles.itemBadge}>{badges[mode]}</span>
      </button>
    ));

  useEffect(() => {
    if (variant !== 'dropdown' || !isOpen) return;
    const onMouseDown = (event: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [isOpen, variant]);

  if (variant === 'inline') {
    return (
      <div className={styles.inlineList} role="menu">
        {renderItems()}
      </div>
    );
  }

  return (
    <div className={styles.menuWrap} ref={wrapRef}>
      <button
        type="button"
        className={`${styles.trigger} ${isOpen ? styles.triggerOpen : ''}`}
        onClick={() => setIsOpen((prev) => !prev)}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        title={t.agent.approvalMode.menuLabel}
      >
        <span>{labels[accessMode]}</span>
        <ChevronDownIcon size={10} />
      </button>
      {isOpen && (
        <div className={styles.dropdown} role="menu">
          {renderItems()}
        </div>
      )}
    </div>
  );
});

export default ApprovalModeMenu;
