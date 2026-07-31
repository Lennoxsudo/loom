import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import { useTranslation } from '../../i18n';
import {
  useEnableAgentMemory,
  useEnableAgentMemoryUserProfile,
  useEnableAgentMemoryNotes,
  useEnableAgentSessionSearch,
  useEnableAgentMemoryReview,
  useAgentMemoryWriteApproval,
  useUpdateEnableAgentMemory,
  useUpdateEnableAgentMemoryUserProfile,
  useUpdateEnableAgentMemoryNotes,
  useUpdateEnableAgentSessionSearch,
  useUpdateEnableAgentMemoryReview,
  useUpdateAgentMemoryWriteApproval,
} from '../../stores';
import { useNotification } from '../../contexts/NotificationContext';
import {
  MEMORY_CHAR_LIMIT,
  USER_CHAR_LIMIT,
  entriesCharCount,
  getAgentMemoryDir,
  loadAgentMemoryEntries,
  removeAgentMemoryEntryByIndex,
  type AgentMemoryTarget,
} from '../../utils/agentMemory';
import pageStyles from './SettingsPage.module.css';
import panelStyles from './AgentSettingsView.module.css';
import styles from './AgentMemoryContent.module.css';
import {
  SettingsPanel,
  SettingsRow,
  SettingsSection,
  SettingsToggle,
} from './SettingsPrimitives';

type StorePreview = {
  entries: string[];
  used: number;
  limit: number;
};

function emptyStore(limit: number): StorePreview {
  return { entries: [], used: 0, limit };
}

function PanelSettingRow({
  title,
  description,
  control,
}: {
  title: string;
  description?: string;
  control: ReactNode;
}) {
  return (
    <div className={panelStyles.settingRow}>
      <div className={panelStyles.settingRowText}>
        <div className={panelStyles.settingRowTitle}>{title}</div>
        {description ? <div className={panelStyles.settingRowDesc}>{description}</div> : null}
      </div>
      <div className={panelStyles.settingRowControl}>{control}</div>
    </div>
  );
}

function UsageBar({ used, limit }: { used: number; limit: number }) {
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  return (
    <div className={styles.usageTrack} aria-hidden>
      <div
        className={`${styles.usageFill} ${pct >= 80 ? styles.usageFillHigh : ''}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function StorePreviewCard({
  title,
  store,
  emptyLabel,
  deleteLabel,
  deleting,
  onDelete,
}: {
  title: string;
  store: StorePreview;
  emptyLabel: string;
  deleteLabel: string;
  deleting: boolean;
  onDelete: (index: number) => void;
}) {
  const pct = store.limit > 0 ? Math.min(100, Math.round((store.used / store.limit) * 100)) : 0;
  return (
    <div className={styles.storeCard}>
      <div className={styles.storeTitleRow}>
        <div className={styles.storeTitle}>{title}</div>
        <div className={styles.storeUsage}>
          {pct}% — {store.used}/{store.limit}
        </div>
      </div>
      <UsageBar used={store.used} limit={store.limit} />
      {store.entries.length === 0 ? (
        <p className={styles.empty}>{emptyLabel}</p>
      ) : (
        <ul className={styles.entryList}>
          {store.entries.map((entry, index) => (
            <li key={`${index}-${entry.slice(0, 24)}`} className={styles.entryItem}>
              <p className={styles.entryText}>{entry}</p>
              <button
                type="button"
                className={styles.deleteBtn}
                disabled={deleting}
                onClick={() => onDelete(index)}
              >
                {deleteLabel}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function AgentMemoryContent({ variant = 'page' }: { variant?: 'page' | 'panel' }) {
  const t = useTranslation();
  const { showError, showSuccess } = useNotification();
  const enableAgentMemory = useEnableAgentMemory();
  const enableUserProfile = useEnableAgentMemoryUserProfile();
  const enableNotes = useEnableAgentMemoryNotes();
  const enableSessionSearch = useEnableAgentSessionSearch();
  const enableReview = useEnableAgentMemoryReview();
  const writeApproval = useAgentMemoryWriteApproval();
  const updateEnableAgentMemory = useUpdateEnableAgentMemory();
  const updateEnableUserProfile = useUpdateEnableAgentMemoryUserProfile();
  const updateEnableNotes = useUpdateEnableAgentMemoryNotes();
  const updateEnableSessionSearch = useUpdateEnableAgentSessionSearch();
  const updateEnableReview = useUpdateEnableAgentMemoryReview();
  const updateWriteApproval = useUpdateAgentMemoryWriteApproval();
  const [isSaving, setIsSaving] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [userStore, setUserStore] = useState<StorePreview>(() => emptyStore(USER_CHAR_LIMIT));
  const [memoryStore, setMemoryStore] = useState<StorePreview>(() =>
    emptyStore(MEMORY_CHAR_LIMIT)
  );

  const refreshPreview = useCallback(async () => {
    setPreviewLoading(true);
    try {
      const [userEntries, memoryEntries] = await Promise.all([
        loadAgentMemoryEntries('user'),
        loadAgentMemoryEntries('memory'),
      ]);
      setUserStore({
        entries: userEntries,
        used: entriesCharCount(userEntries),
        limit: USER_CHAR_LIMIT,
      });
      setMemoryStore({
        entries: memoryEntries,
        used: entriesCharCount(memoryEntries),
        limit: MEMORY_CHAR_LIMIT,
      });
    } catch {
      setUserStore(emptyStore(USER_CHAR_LIMIT));
      setMemoryStore(emptyStore(MEMORY_CHAR_LIMIT));
      showError(t.settingsAgentMemory.previewLoadFailed);
    } finally {
      setPreviewLoading(false);
    }
  }, [showError, t.settingsAgentMemory.previewLoadFailed]);

  useEffect(() => {
    void refreshPreview();
  }, [refreshPreview]);

  const openFolder = async () => {
    try {
      const dir = await getAgentMemoryDir();
      if (!dir) {
        showError(t.settingsAgentMemory.openFolderFailed);
        return;
      }
      await revealItemInDir(dir);
    } catch {
      showError(t.settingsAgentMemory.openFolderFailed);
    }
  };

  const deleteEntry = async (target: AgentMemoryTarget, index: number) => {
    setDeleting(true);
    try {
      const result = await removeAgentMemoryEntryByIndex(target, index, {
        enableAgentMemory: true,
        enableAgentMemoryUserProfile: true,
        enableAgentMemoryNotes: true,
      });
      if (!result.ok) {
        showError(result.error ?? t.settingsAgentMemory.previewDeleteFailed);
        return;
      }
      showSuccess(t.settingsAgentMemory.previewDeleted);
      await refreshPreview();
    } catch {
      showError(t.settingsAgentMemory.previewDeleteFailed);
    } finally {
      setDeleting(false);
    }
  };

  const runToggle = async (fn: () => Promise<void>) => {
    setIsSaving(true);
    try {
      await fn();
    } catch {
      showError(t.errors.updateFailed);
    } finally {
      setIsSaving(false);
    }
  };

  const master = (
    <SettingsToggle
      checked={enableAgentMemory}
      disabled={isSaving}
      ariaLabel={t.settingsAgentMemory.enable}
      onChange={(checked) => void runToggle(() => updateEnableAgentMemory(checked))}
    />
  );
  const userToggle = (
    <SettingsToggle
      checked={enableUserProfile}
      disabled={isSaving || !enableAgentMemory}
      ariaLabel={t.settingsAgentMemory.enableUserProfile}
      onChange={(checked) => void runToggle(() => updateEnableUserProfile(checked))}
    />
  );
  const notesToggle = (
    <SettingsToggle
      checked={enableNotes}
      disabled={isSaving || !enableAgentMemory}
      ariaLabel={t.settingsAgentMemory.enableNotes}
      onChange={(checked) => void runToggle(() => updateEnableNotes(checked))}
    />
  );
  const sessionSearchToggle = (
    <SettingsToggle
      checked={enableSessionSearch}
      disabled={isSaving}
      ariaLabel={t.settingsAgentMemory.enableSessionSearch}
      onChange={(checked) => void runToggle(() => updateEnableSessionSearch(checked))}
    />
  );
  const reviewToggle = (
    <SettingsToggle
      checked={enableReview}
      disabled={isSaving || !enableAgentMemory}
      ariaLabel={t.settingsAgentMemory.enableReview}
      onChange={(checked) => void runToggle(() => updateEnableReview(checked))}
    />
  );
  const approvalToggle = (
    <SettingsToggle
      checked={writeApproval}
      disabled={isSaving || !enableAgentMemory}
      ariaLabel={t.settingsAgentMemory.writeApproval}
      onChange={(checked) => void runToggle(() => updateWriteApproval(checked))}
    />
  );

  const previewBlock = (
    <div className={styles.previewSection}>
      <div className={styles.previewHeader}>
        <p className={panelStyles.settingRowDesc}>{t.settingsAgentMemory.previewDesc}</p>
        <div className={styles.previewActions}>
          <button
            type="button"
            className={styles.actionBtn}
            disabled={previewLoading}
            onClick={() => void refreshPreview()}
          >
            {t.settingsAgentMemory.previewRefresh}
          </button>
          <button type="button" className={styles.actionBtn} onClick={() => void openFolder()}>
            {t.settingsAgentMemory.openFolder}
          </button>
        </div>
      </div>
      <StorePreviewCard
        title={t.settingsAgentMemory.previewUser}
        store={userStore}
        emptyLabel={t.settingsAgentMemory.previewEmpty}
        deleteLabel={t.settingsAgentMemory.previewDelete}
        deleting={deleting}
        onDelete={(index) => void deleteEntry('user', index)}
      />
      <StorePreviewCard
        title={t.settingsAgentMemory.previewNotes}
        store={memoryStore}
        emptyLabel={t.settingsAgentMemory.previewEmpty}
        deleteLabel={t.settingsAgentMemory.previewDelete}
        deleting={deleting}
        onDelete={(index) => void deleteEntry('memory', index)}
      />
    </div>
  );

  if (variant === 'panel') {
    return (
      <>
        <PanelSettingRow
          title={t.settingsAgentMemory.enable}
          description={t.settingsAgentMemory.enableDesc}
          control={master}
        />
        <PanelSettingRow
          title={t.settingsAgentMemory.enableUserProfile}
          description={t.settingsAgentMemory.enableUserProfileDesc}
          control={userToggle}
        />
        <PanelSettingRow
          title={t.settingsAgentMemory.enableNotes}
          description={t.settingsAgentMemory.enableNotesDesc}
          control={notesToggle}
        />
        <PanelSettingRow
          title={t.settingsAgentMemory.enableSessionSearch}
          description={t.settingsAgentMemory.enableSessionSearchDesc}
          control={sessionSearchToggle}
        />
        <PanelSettingRow
          title={t.settingsAgentMemory.enableReview}
          description={t.settingsAgentMemory.enableReviewDesc}
          control={reviewToggle}
        />
        <PanelSettingRow
          title={t.settingsAgentMemory.writeApproval}
          description={t.settingsAgentMemory.writeApprovalDesc}
          control={approvalToggle}
        />
        <div className={panelStyles.settingRowTitle} style={{ marginTop: 12 }}>
          {t.settingsAgentMemory.previewTitle}
        </div>
        {previewBlock}
        <p className={panelStyles.settingRowDesc}>{t.settingsAgentMemory.storageHint}</p>
      </>
    );
  }

  return (
    <div className={pageStyles.root}>
      <header className={pageStyles.pageHeader}>
        <h2 className={pageStyles.pageTitle}>{t.settingsAgentMemory.title}</h2>
        <p className={pageStyles.pageDescription}>{t.settingsAgentMemory.description}</p>
      </header>

      <SettingsPanel>
        <SettingsSection title={t.settingsAgentMemory.sectionTitle}>
          <SettingsRow label={t.settingsAgentMemory.enable} control={master} />
          <SettingsRow label={t.settingsAgentMemory.enableUserProfile} control={userToggle} />
          <SettingsRow label={t.settingsAgentMemory.enableNotes} control={notesToggle} />
          <SettingsRow
            label={t.settingsAgentMemory.enableSessionSearch}
            control={sessionSearchToggle}
          />
          <SettingsRow label={t.settingsAgentMemory.enableReview} control={reviewToggle} />
          <SettingsRow label={t.settingsAgentMemory.writeApproval} control={approvalToggle} />
        </SettingsSection>
        <SettingsSection title={t.settingsAgentMemory.previewTitle}>{previewBlock}</SettingsSection>
        <p className={pageStyles.pageDescription}>{t.settingsAgentMemory.storageHint}</p>
      </SettingsPanel>
    </div>
  );
}
