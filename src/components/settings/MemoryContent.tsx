import { useEffect, useState } from 'react';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import { useTranslation } from '../../i18n';
import { useFileStore } from '../../stores';
import {
  deleteProjectMemory,
  deleteProjectMemoryByFilePath,
  listAllProjectMemoryGroups,
  serializeMemoryEntry,
  upsertProjectMemory,
  type ProjectMemoryEntry,
  type ProjectMemoryGroup,
} from '../../utils/projectMemory';
import { invoke } from '@tauri-apps/api/core';
import {
  showError as globalShowError,
  showSuccess as globalShowSuccess,
} from '../../utils/notification';
import { ChevronDownIcon } from '../shared/Icons';
import pageStyles from './SettingsPage.module.css';
import { SettingsDeleteModal } from './SettingsDeleteModal';
import styles from './SkillsContent.module.css';
import memStyles from './MemoryContent.module.css';
import {
  SettingsBlockBody,
  SettingsPanel,
  SettingsSection,
} from './SettingsPrimitives';

function parseTagsInput(raw: string): string[] {
  return raw
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}

function MemoryCard({
  entry,
  onSave,
  onDelete,
}: {
  entry: ProjectMemoryEntry;
  onSave: (input: {
    id: string;
    title: string;
    body: string;
    tags: string[];
  }) => Promise<void>;
    onDelete: () => Promise<void>;
}) {
  const t = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [editTitle, setEditTitle] = useState(entry.title);
  const [editBody, setEditBody] = useState(entry.body);
  const [editTags, setEditTags] = useState(entry.tags.join(', '));
  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    if (!expanded) {
      setEditTitle(entry.title);
      setEditBody(entry.body);
      setEditTags(entry.tags.join(', '));
    }
  }, [entry, expanded]);

  const handleCancel = () => {
    setEditTitle(entry.title);
    setEditBody(entry.body);
    setEditTags(entry.tags.join(', '));
    setExpanded(false);
  };

  const handleSave = async () => {
    const title = editTitle.trim();
    const body = editBody.trim();
    if (!title) {
      globalShowError(t.settingsMemory.titleRequired);
      return;
    }
    if (!body) {
      globalShowError(t.settingsMemory.bodyRequired);
      return;
    }
    setSaving(true);
    try {
      await onSave({
        id: entry.id,
        title,
        body,
        tags: parseTagsInput(editTags),
      });
      setExpanded(false);
    } finally {
      setSaving(false);
    }
  };

  const preview = entry.body.slice(0, 120) + (entry.body.length > 120 ? '...' : '');

  return (
    <div className={`${styles.listItem} ${expanded ? styles.listItemExpanded : ''}`}>
      <div
        className={`${styles.listItemHeader} ${expanded ? styles.listItemHeaderExpanded : ''}`}
        onClick={expanded ? undefined : () => setExpanded(true)}
      >
        <div className={styles.listItemMain}>
          <div className={styles.listItemNameRow}>
            <div className={styles.listItemName}>{entry.title}</div>
            <button
              type="button"
              className={styles.chevronBtn}
              aria-expanded={expanded}
              aria-label={expanded ? t.settingsMemory.cancel : t.settingsMemory.edit}
              onClick={(e) => {
                e.stopPropagation();
                if (expanded) handleCancel();
                else setExpanded(true);
              }}
            >
              <span className={`${styles.chevron} ${expanded ? styles.chevronExpanded : ''}`}>
                <ChevronDownIcon size={12} />
              </span>
            </button>
          </div>
          {!expanded && preview ? <div className={styles.listItemPreview}>{preview}</div> : null}
        </div>
        {!expanded ? (
          <>
            <span className={styles.scopeBadge}>{entry.id}</span>
            <div className={styles.listItemActions} onClick={(e) => e.stopPropagation()}>
              <button type="button" className={styles.actionBtn} onClick={() => setExpanded(true)}>
                {t.settingsMemory.edit}
              </button>
              <button
                type="button"
                className={styles.deleteBtn}
                onClick={() => setConfirmingDelete(true)}
              >
                {t.settingsMemory.delete}
              </button>
            </div>
          </>
        ) : null}
      </div>
      {expanded && (
        <div className={styles.listItemBody} onClick={(e) => e.stopPropagation()}>
          <div className={styles.editorPanel}>
            <div className={styles.formField}>
              <label className={styles.formLabel}>{t.settingsMemory.entryTitle}</label>
              <input
                className={styles.formInput}
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                placeholder={t.settingsMemory.titlePlaceholder}
              />
            </div>
            <div className={styles.formField}>
              <label className={styles.formLabel}>{t.settingsMemory.tags}</label>
              <input
                className={styles.formInput}
                value={editTags}
                onChange={(e) => setEditTags(e.target.value)}
                placeholder={t.settingsMemory.tagsPlaceholder}
              />
            </div>
            <div className={`${styles.formField} ${styles.formFieldLast}`}>
              <label className={styles.formLabel}>{t.settingsMemory.body}</label>
              <textarea
                className={styles.formTextarea}
                value={editBody}
                onChange={(e) => setEditBody(e.target.value)}
                placeholder={t.settingsMemory.bodyPlaceholder}
              />
            </div>
            <div className={styles.formFooter}>
              <button
                type="button"
                className={styles.deleteBtnFooter}
                onClick={() => setConfirmingDelete(true)}
              >
                {t.settingsMemory.delete}
              </button>
              <div className={styles.formFooterActions}>
                <button type="button" className={styles.cancelBtn} onClick={handleCancel}>
                  {t.settingsMemory.cancel}
                </button>
                <button
                  type="button"
                  className={styles.saveBtn}
                  disabled={saving}
                  onClick={() => void handleSave()}
                >
                  {saving ? t.settingsMemory.saving : t.settingsMemory.save}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {confirmingDelete ? (
        <SettingsDeleteModal
          title={t.settingsMemory.delete}
          onCancel={() => setConfirmingDelete(false)}
          confirmLabel={t.settingsMemory.delete}
          onConfirm={() => {
            setConfirmingDelete(false);
            void onDelete();
          }}
        >
          {t.settingsMemory.confirmDelete}
        </SettingsDeleteModal>
      ) : null}
    </div>
  );
}

function NewMemoryForm({
  onSave,
  onCancel,
}: {
  onSave: (input: { title: string; body: string; tags: string[] }) => Promise<void>;
  onCancel: () => void;
}) {
  const t = useTranslation();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [tags, setTags] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    const trimmedTitle = title.trim();
    const trimmedBody = body.trim();
    if (!trimmedTitle) {
      globalShowError(t.settingsMemory.titleRequired);
      return;
    }
    if (!trimmedBody) {
      globalShowError(t.settingsMemory.bodyRequired);
      return;
    }
    setSaving(true);
    try {
      await onSave({
        title: trimmedTitle,
        body: trimmedBody,
        tags: parseTagsInput(tags),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.formBlock}>
      <div className={styles.formBlockInner}>
        <div className={styles.formField}>
          <label className={styles.formLabel}>{t.settingsMemory.entryTitle}</label>
          <input
            className={styles.formInput}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t.settingsMemory.titlePlaceholder}
          />
        </div>
        <div className={styles.formField}>
          <label className={styles.formLabel}>{t.settingsMemory.tags}</label>
          <input
            className={styles.formInput}
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder={t.settingsMemory.tagsPlaceholder}
          />
        </div>
        <div className={`${styles.formField} ${styles.formFieldLast}`}>
          <label className={styles.formLabel}>{t.settingsMemory.body}</label>
          <textarea
            className={styles.formTextarea}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={t.settingsMemory.bodyPlaceholder}
          />
        </div>
        <div className={styles.formFooter}>
          <div className={styles.formFooterActions}>
            <button type="button" className={styles.cancelBtn} onClick={onCancel}>
              {t.settingsMemory.cancel}
            </button>
            <button
              type="button"
              className={styles.saveBtn}
              disabled={saving}
              onClick={() => void handleSave()}
            >
              {saving ? t.settingsMemory.saving : t.settingsMemory.save}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export type MemoryContentProps = {
  variant?: 'page' | 'panel';
};

export function MemoryContent({ variant = 'panel' }: MemoryContentProps) {
  const t = useTranslation();
  const currentProjectPath = useFileStore((s) => s.projectPath);
  const [groups, setGroups] = useState<ProjectMemoryGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [newForKey, setNewForKey] = useState<string | null>(null);
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(() => new Set());

  const loadAll = async (options?: { initial?: boolean }) => {
    const isInitial = options?.initial ?? false;
    if (isInitial) setLoading(true);
    setError('');
    try {
      const next = await listAllProjectMemoryGroups(currentProjectPath);
      setGroups(next);
      if (isInitial) {
        const prefer = currentProjectPath?.trim() || '';
        const initial = new Set<string>();
        if (prefer) {
          const match = next.find((g) => g.projectPath === prefer);
          if (match) initial.add(match.projectKey);
        } else if (next.length === 1) {
          initial.add(next[0]!.projectKey);
        }
        setExpandedKeys(initial);
      }
    } catch (e) {
      setError(`${t.settingsMemory.loadFailed}: ${String(e)}`);
    } finally {
      if (isInitial) setLoading(false);
    }
  };

  useEffect(() => {
    void loadAll({ initial: true });
  }, [currentProjectPath]);

  const toggleGroup = (projectKey: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(projectKey)) next.delete(projectKey);
      else next.add(projectKey);
      return next;
    });
  };

  const handleUpsert = async (
    group: ProjectMemoryGroup,
    input: { id?: string; title: string; body: string; tags: string[] },
    existing?: ProjectMemoryEntry
  ) => {
    try {
      if (group.projectPath.trim()) {
        await upsertProjectMemory(group.projectPath, input);
      } else if (existing?.filePath) {
        const entry = {
          id: input.id || existing.id,
          title: input.title,
          body: input.body,
          tags: input.tags,
          source: existing.source,
          updatedAt: new Date().toISOString(),
        };
        await invoke('write_file_content', {
          filePath: existing.filePath,
          content: serializeMemoryEntry(entry),
        });
      } else {
        throw new Error(t.settingsMemory.unknownProject);
      }
      await loadAll();
    } catch (e) {
      setError(`${t.settingsMemory.saveFailed}: ${String(e)}`);
      throw e;
    }
  };

  const handleDelete = async (group: ProjectMemoryGroup, entry: ProjectMemoryEntry) => {
    try {
      if (group.projectPath.trim()) {
        await deleteProjectMemory(group.projectPath, entry.id);
      } else {
        await deleteProjectMemoryByFilePath(entry.filePath);
      }
      await loadAll();
    } catch (e) {
      setError(`${t.settingsMemory.deleteFailed}: ${String(e)}`);
    }
  };

  const copyDir = async (memoryDir: string) => {
    try {
      await navigator.clipboard.writeText(memoryDir);
      globalShowSuccess(t.settingsMemory.pathCopied);
    } catch {
      globalShowError(t.common.copyFailed);
    }
  };

  const openDir = async (memoryDir: string) => {
    try {
      await revealItemInDir(memoryDir);
    } catch {
      globalShowError(t.settingsMemory.openFolderFailed);
    }
  };

  if (loading) {
    return <div className={pageStyles.loading}>{t.common.loading}</div>;
  }

  return (
    <div className={`${variant === 'page' ? pageStyles.root : ''} ${styles.root}`.trim()}>
      {variant === 'page' ? (
        <header className={pageStyles.pageHeader}>
          <h2 className={pageStyles.pageTitle}>{t.settingsMemory.title}</h2>
          <p className={pageStyles.pageDescription}>{t.settingsMemory.description}</p>
        </header>
      ) : (
        <p className={pageStyles.pageDescription} style={{ marginBottom: 16 }}>
          {t.settingsMemory.description}
        </p>
      )}

      {error ? (
        <div className={`${pageStyles.message} ${pageStyles.messageError}`}>
          <span>{error}</span>
          <button type="button" className={pageStyles.messageClose} onClick={() => setError('')}>
            ×
          </button>
        </div>
      ) : null}

      <SettingsPanel>
        <SettingsSection
          title={t.settingsMemory.sectionTitle}
          description={t.settingsMemory.sectionHint}
        >
          <SettingsBlockBody>
            {groups.length === 0 ? (
              <div className={styles.emptyInline}>{t.settingsMemory.emptyAll}</div>
            ) : (
              <div className={styles.list}>
                {groups.map((group) => {
                  const expanded = expandedKeys.has(group.projectKey);
                  const canCreate = Boolean(group.projectPath.trim());
                  const showingNew = newForKey === group.projectKey;
                  const pathLabel = group.projectPath.trim() || t.settingsMemory.unknownProject;

                  return (
                    <div key={group.projectKey} className={memStyles.projectGroup}>
                      <div
                        className={`${memStyles.projectHeader} ${expanded ? memStyles.projectHeaderExpanded : ''}`}
                        onClick={() => toggleGroup(group.projectKey)}
                      >
                        <div className={memStyles.projectMain}>
                          <div className={memStyles.projectNameRow}>
                            <span
                              className={`${styles.chevron} ${expanded ? styles.chevronExpanded : ''}`}
                            >
                              <ChevronDownIcon size={12} />
                            </span>
                            <div className={memStyles.projectName}>{group.displayName}</div>
                            <span className={memStyles.projectCount}>{group.entries.length}</span>
                          </div>
                          <div className={memStyles.projectPath} title={pathLabel}>
                            {pathLabel}
                          </div>
                        </div>
                        <div
                          className={memStyles.projectActions}
                          onClick={(e) => e.stopPropagation()}
                        >
                          {canCreate ? (
                            <button
                              type="button"
                              className={styles.addBtn}
                              onClick={() => {
                                setExpandedKeys((prev) => new Set(prev).add(group.projectKey));
                                setNewForKey(group.projectKey);
                              }}
                            >
                              + {t.settingsMemory.newEntry}
                            </button>
                          ) : null}
                        </div>
                      </div>

                      {expanded ? (
                        <div className={memStyles.projectBody}>
                          <div className={styles.pathBlock}>
                            <div className={styles.pathRow}>
                              <div className={styles.pathDisplay} title={group.memoryDir}>
                                {group.memoryDir}
                              </div>
                              <button
                                type="button"
                                className={styles.pathOpenButton}
                                onClick={() => void openDir(group.memoryDir)}
                              >
                                {t.settingsMemory.openFolder}
                              </button>
                              <button
                                type="button"
                                className={styles.pathCopyButton}
                                onClick={() => void copyDir(group.memoryDir)}
                              >
                                {t.settingsMemory.copyPath}
                              </button>
                            </div>
                          </div>

                          {showingNew && canCreate ? (
                            <NewMemoryForm
                              onCancel={() => setNewForKey(null)}
                              onSave={async (input) => {
                                await handleUpsert(group, input);
                                setNewForKey(null);
                              }}
                            />
                          ) : null}

                          {group.entries.length === 0 && !showingNew ? (
                            <div className={styles.emptyInline}>{t.settingsMemory.empty}</div>
                          ) : group.entries.length > 0 ? (
                            <div className={styles.list}>
                              {group.entries.map((entry) => (
                                <MemoryCard
                                  key={`${group.projectKey}:${entry.id}`}
                                  entry={entry}
                                  onSave={(input) => handleUpsert(group, input, entry)}
                                  onDelete={async () => {
                                    await handleDelete(group, entry);
                                  }}
                                />
                              ))}
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </SettingsBlockBody>
        </SettingsSection>
      </SettingsPanel>
    </div>
  );
}

