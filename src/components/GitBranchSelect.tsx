import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDownIcon } from './shared/Icons';
import styles from './GitBranchSelect.module.css';

export type GitBranchSelectItem = {
  name: string;
  isCurrent: boolean;
  isRemote: boolean;
};

interface GitBranchSelectProps {
  branches: GitBranchSelectItem[];
  currentBranch: string;
  disabled?: boolean;
  switchBranchLabel: string;
  localGroupLabel: string;
  remoteGroupLabel: string;
  onSelect: (branchName: string) => void;
}

function isCheckoutableBranch(name: string): boolean {
  return !name.includes(' -> ');
}

function formatBranchLabel(name: string, isRemote: boolean): string {
  if (isRemote) {
    return name.replace(/^remotes\//, '');
  }
  return name;
}

export const GitBranchSelect = memo(function GitBranchSelect({
  branches,
  currentBranch,
  disabled = false,
  switchBranchLabel,
  localGroupLabel,
  remoteGroupLabel,
  onSelect,
}: GitBranchSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const { localBranches, remoteBranches } = useMemo(() => {
    const checkoutable = branches.filter((b) => isCheckoutableBranch(b.name));
    return {
      localBranches: checkoutable.filter((b) => !b.isRemote),
      remoteBranches: checkoutable.filter((b) => b.isRemote),
    };
  }, [branches]);

  const handleSelect = useCallback(
    (branchName: string) => {
      if (branchName === currentBranch) {
        setIsOpen(false);
        return;
      }
      onSelect(branchName);
      setIsOpen(false);
    },
    [currentBranch, onSelect]
  );

  useEffect(() => {
    if (!isOpen) return;
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
  }, [isOpen]);

  const renderBranchItem = (branch: GitBranchSelectItem) => {
    const isActive = branch.name === currentBranch || branch.isCurrent;
    return (
      <button
        key={branch.name}
        type="button"
        role="menuitem"
        className={`${styles.item} ${branch.isRemote ? styles.itemRemote : ''} ${
          isActive ? styles.itemActive : ''
        }`}
        title={branch.name}
        onClick={() => handleSelect(branch.name)}
      >
        <span className={styles.itemMarker} aria-hidden="true">
          {isActive ? '*' : ''}
        </span>
        <span className={styles.itemLabel}>
          {formatBranchLabel(branch.name, branch.isRemote)}
        </span>
      </button>
    );
  };

  return (
    <div className={styles.menuWrap} ref={wrapRef}>
      <button
        type="button"
        className={`${styles.trigger} ${isOpen ? styles.triggerOpen : ''}`}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        title={switchBranchLabel}
        onClick={() => {
          if (!disabled) setIsOpen((prev) => !prev);
        }}
      >
        <span className={styles.triggerLabel}>{currentBranch}</span>
        <span className={`${styles.chevron} ${isOpen ? styles.chevronOpen : ''}`}>
          <ChevronDownIcon size={10} />
        </span>
      </button>
      {isOpen && (
        <div className={styles.dropdown} role="menu" aria-label={switchBranchLabel}>
          {localBranches.length > 0 && (
            <>
              <div className={styles.groupLabel}>{localGroupLabel}</div>
              {localBranches.map(renderBranchItem)}
            </>
          )}
          {remoteBranches.length > 0 && (
            <>
              <div className={styles.groupLabel}>{remoteGroupLabel}</div>
              {remoteBranches.map(renderBranchItem)}
            </>
          )}
        </div>
      )}
    </div>
  );
});
