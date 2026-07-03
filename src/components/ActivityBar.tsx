import { memo } from 'react';
import { useTranslation } from '../i18n';
import {
  ChatActivityIcon,
  ExplorerActivityIcon,
  SearchActivityIcon,
  SettingsActivityIcon,
  SourceControlActivityIcon,
  TerminalActivityIcon,
} from './activity/ActivityBarIcons';
import styles from './ActivityBar.module.css';

const ACTIVITY_BAR_WIDTH = 48;

type ActivityBarProps = {
  isExplorerActive: boolean;
  onToggleExplorer: () => void;
  isSearchActive?: boolean;
  onToggleSearch?: () => void;
  isGitActive?: boolean;
  onToggleGit?: () => void;
  isChatActive?: boolean;
  onToggleChat?: () => void;
  isTerminalActive?: boolean;
  onToggleTerminal?: () => void;
  onClickSettings?: () => void;
  width?: number;
};

function ActivityBarBase({
  isExplorerActive,
  onToggleExplorer,
  isSearchActive = false,
  onToggleSearch,
  isGitActive = false,
  onToggleGit,
  isChatActive = false,
  onToggleChat,
  isTerminalActive = false,
  onToggleTerminal,
  onClickSettings,
  width = ACTIVITY_BAR_WIDTH,
}: ActivityBarProps) {
  const t = useTranslation();

  return (
    <div className={styles.activityBar} style={{ width: `${width}px` }}>
      <button
        type="button"
        onClick={onToggleExplorer}
        title={t.labels.explorer}
        aria-label={t.labels.explorer}
        className={isExplorerActive ? styles.buttonActive : styles.button}
      >
        <ExplorerActivityIcon className={styles.icon} />
      </button>

      <button
        type="button"
        onClick={() => onToggleSearch?.()}
        title={t.labels.search}
        aria-label={t.labels.search}
        className={isSearchActive ? styles.buttonActive : styles.button}
      >
        <SearchActivityIcon className={styles.icon} />
      </button>

      <button
        type="button"
        onClick={() => onToggleGit?.()}
        title={t.labels.sourceControl}
        aria-label={t.labels.sourceControl}
        className={isGitActive ? styles.buttonActive : styles.button}
      >
        <SourceControlActivityIcon className={styles.icon} />
      </button>

      <button
        type="button"
        onClick={() => onToggleChat?.()}
        title={t.labels.chat}
        aria-label={t.labels.chat}
        className={isChatActive ? styles.buttonActive : styles.button}
      >
        <ChatActivityIcon className={styles.icon} />
      </button>

      <button
        type="button"
        onClick={() => onToggleTerminal?.()}
        title={t.labels.terminal}
        aria-label={t.labels.terminal}
        className={isTerminalActive ? styles.buttonActive : styles.button}
      >
        <TerminalActivityIcon className={styles.icon} />
      </button>

      <div className={styles.spacer} />

      <button
        type="button"
        onClick={onClickSettings}
        title={t.labels.settings}
        aria-label={t.labels.settings}
        className={styles.button}
      >
        <SettingsActivityIcon className={styles.icon} />
      </button>
    </div>
  );
}

export default memo(ActivityBarBase);
