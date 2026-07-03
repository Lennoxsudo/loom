import { useState, useEffect } from 'react';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import { useTranslation } from '../../i18n';
import { useFileStore } from '../../stores';
import {
  type SkillEntry,
  getSkillsList,
  saveSkill,
  deleteSkill,
  clearSkillsCache,
  ensureGlobalSkillsDir,
  getGlobalSkillsDir,
} from '../../utils/skills';
import {
  showError as globalShowError,
  showSuccess as globalShowSuccess,
} from '../../utils/notification';
import pageStyles from './SettingsPage.module.css';
import { SettingsDeleteModal } from './SettingsDeleteModal';
import listStyles from './SettingsExpandableList.module.css';
import styles from './SkillsContent.module.css';
import primitiveStyles from './SettingsPrimitives.module.css';
import {
  SettingsBlockBody,
  SettingsPanel,
  SettingsRow,
  SettingsSection,
  SettingsSegmented,
} from './SettingsPrimitives';

function SkillCard({
  skill,
  onSave,
  onDelete,
}: {
  skill: SkillEntry;
  onSave: (name: string, content: string, scope: 'global' | 'project') => Promise<void>;
  onDelete: (name: string, scope: 'global' | 'project') => Promise<void>;
}) {
  const t = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [editContent, setEditContent] = useState(skill.content);
  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const dirty = editContent !== skill.content;

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(skill.name, editContent, skill.scope);
      setExpanded(false);
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setEditContent(skill.content);
    setExpanded(false);
  };

  const handleDelete = async () => {
    try {
      await onDelete(skill.name, skill.scope);
    } catch {
      // error handled by parent
    }
    setConfirmingDelete(false);
  };

  return (
    <div className={listStyles.listItem}>
      <div className={listStyles.listItemHeader} onClick={() => setExpanded(!expanded)}>
        <div className={listStyles.listItemInfo}>
          <div className={listStyles.listItemName}>{skill.name}</div>
          {!expanded && (
            <div className={listStyles.listItemPreview}>
              {skill.description
                ? skill.description
                : skill.content.slice(0, 80) + (skill.content.length > 80 ? '...' : '')}
            </div>
          )}
        </div>
        <span
          className={
            skill.scope === 'global' ? styles.scopeBadgeGlobal : styles.scopeBadgeProject
          }
        >
          {skill.scope === 'global' ? t.settingsSkills.global : t.settingsSkills.project}
        </span>
        <div className={listStyles.listItemActions} onClick={(e) => e.stopPropagation()}>
          <button type="button" className={listStyles.actionBtn} onClick={() => setExpanded(!expanded)}>
            {t.settingsSkills.editSkill}
          </button>
          <button
            type="button"
            className={listStyles.deleteBtn}
            onClick={() => setConfirmingDelete(true)}
          >
            {t.settingsSkills.deleteSkill}
          </button>
        </div>
      </div>
      {expanded && (
        <div className={listStyles.listItemBody}>
          <textarea
            className={listStyles.formTextarea}
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            placeholder={t.settingsSkills.skillContentPlaceholder}
          />
          <div className={listStyles.formFooter}>
            <button type="button" className={listStyles.cancelBtn} onClick={handleCancel}>
              {t.settingsSkills.cancel}
            </button>
            <button
              type="button"
              className={listStyles.saveBtn}
              disabled={!dirty || saving}
              onClick={() => void handleSave()}
            >
              {saving ? t.settingsSkills.saving : t.settingsSkills.save}
            </button>
          </div>
        </div>
      )}
      {confirmingDelete && (
        <SettingsDeleteModal
          title={t.settingsSkills.deleteSkill}
          onCancel={() => setConfirmingDelete(false)}
          onConfirm={() => void handleDelete()}
          confirmLabel={t.settingsSkills.deleteSkill}
        >
          {t.settingsSkills.confirmDelete}
        </SettingsDeleteModal>
      )}
    </div>
  );
}

function NewSkillForm({
  defaultScope,
  hasProject,
  onSave,
  onCancel,
}: {
  defaultScope: 'global' | 'project';
  hasProject: boolean;
  onSave: (name: string, content: string, scope: 'global' | 'project') => Promise<void>;
  onCancel: () => void;
}) {
  const t = useTranslation();
  const [name, setName] = useState('');
  const [content, setContent] = useState('');
  const [scope, setScope] = useState<'global' | 'project'>(defaultScope);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const scopeOptions = hasProject
    ? [
        { value: 'global' as const, label: t.settingsSkills.global },
        { value: 'project' as const, label: t.settingsSkills.project },
      ]
    : [{ value: 'global' as const, label: t.settingsSkills.global }];

  const handleSave = async () => {
    if (!name.trim()) {
      setError(t.settingsSkills.nameRequired);
      return;
    }
    if (!content.trim()) {
      setError(t.settingsSkills.contentRequired);
      return;
    }
    setSaving(true);
    setError('');
    try {
      await onSave(name.trim(), content, scope);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={listStyles.formBlock}>
      <SettingsRow
        label={t.settingsSkills.scope}
        control={
          <SettingsSegmented
            value={hasProject ? scope : 'global'}
            options={scopeOptions}
            onChange={(nextScope) => setScope(nextScope)}
          />
        }
      />
      <div className={listStyles.formField}>
        <label className={listStyles.formLabel}>{t.settingsSkills.skillName}</label>
        <input
          className={listStyles.formInput}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t.settingsSkills.skillNamePlaceholder}
        />
      </div>
      <div className={listStyles.formField}>
        <label className={listStyles.formLabel}>{t.settingsSkills.skillContent}</label>
        <textarea
          className={listStyles.formTextarea}
          style={{ marginTop: 0 }}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder={t.settingsSkills.skillContentPlaceholder}
        />
      </div>
      {error ? <div className={listStyles.formError}>{error}</div> : null}
      <div className={listStyles.formFooter}>
        <button type="button" className={listStyles.cancelBtn} onClick={onCancel}>
          {t.settingsSkills.cancel}
        </button>
        <button
          type="button"
          className={listStyles.saveBtn}
          disabled={saving}
          onClick={() => void handleSave()}
        >
          {saving ? t.settingsSkills.saving : t.settingsSkills.save}
        </button>
      </div>
    </div>
  );
}

function SkillsPathRow({
  path,
  onCopy,
  onOpen,
}: {
  path: string;
  onCopy: () => void;
  onOpen: () => void;
}) {
  const t = useTranslation();

  return (
    <div className={styles.pathBlock}>
      <div className={primitiveStyles.pathRow}>
        <div className={primitiveStyles.pathDisplay} title={path}>
          {path}
        </div>
        <button type="button" className={primitiveStyles.pathOpenButton} onClick={onOpen}>
          {t.settingsSkills.openFolder}
        </button>
        <button type="button" className={primitiveStyles.pathCopyButton} onClick={onCopy}>
          {t.settingsSkills.copyPath}
        </button>
      </div>
    </div>
  );
}

export function SkillsContent() {
  const t = useTranslation();
  const projectPath = useFileStore((s) => s.projectPath);
  const [globalSkills, setGlobalSkills] = useState<SkillEntry[]>([]);
  const [projectSkills, setProjectSkills] = useState<SkillEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showNewForm, setShowNewForm] = useState(false);
  const [globalDir, setGlobalDir] = useState('');
  const hasProject = !!projectPath;

  const loadAll = async (options?: { initial?: boolean }) => {
    const isInitial = options?.initial ?? false;
    if (isInitial) {
      setLoading(true);
    }
    setError('');
    try {
      const result = await getSkillsList(projectPath);
      setGlobalSkills(result.global);
      setProjectSkills(result.project);
      const dir = await getGlobalSkillsDir();
      setGlobalDir(dir);
    } catch (e) {
      setError(`${t.settingsSkills.loadFailed}: ${String(e)}`);
    } finally {
      if (isInitial) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    void loadAll({ initial: true });
  }, [projectPath]);

  const handleSave = async (name: string, content: string, scope: 'global' | 'project') => {
    try {
      await saveSkill(name, content, scope, projectPath);
      clearSkillsCache();
      await loadAll();
    } catch (e) {
      setError(`${t.settingsSkills.saveFailed}: ${String(e)}`);
      throw e;
    }
  };

  const handleDelete = async (name: string, scope: 'global' | 'project') => {
    try {
      await deleteSkill(name, scope, projectPath);
      clearSkillsCache();
      await loadAll();
    } catch (e) {
      setError(`${t.settingsSkills.deleteFailed}: ${String(e)}`);
    }
  };

  const handleNewSave = async (name: string, content: string, scope: 'global' | 'project') => {
    await handleSave(name, content, scope);
    setShowNewForm(false);
  };

  const copyGlobalDir = async () => {
    try {
      await navigator.clipboard.writeText(globalDir);
      globalShowSuccess(t.settingsSkills.pathCopied);
    } catch {
      globalShowError(t.common.copyFailed);
    }
  };

  const openGlobalDirInExplorer = async () => {
    try {
      await ensureGlobalSkillsDir();
      const dir = globalDir || (await getGlobalSkillsDir());
      await revealItemInDir(dir);
    } catch {
      globalShowError(t.settingsSkills.openFolderFailed);
    }
  };

  if (loading) {
    return <div className={pageStyles.loading}>{t.status.loading}</div>;
  }

  return (
    <div className={pageStyles.root}>
      <header className={pageStyles.pageHeader}>
        <h2 className={pageStyles.pageTitle}>{t.settingsSkills.title}</h2>
      </header>

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
          title={t.settingsSkills.globalSkills}
          description={t.settingsSkills.globalHint}
          action={
            !showNewForm ? (
              <button type="button" className={listStyles.addBtn} onClick={() => setShowNewForm(true)}>
                + {t.settingsSkills.newSkill}
              </button>
            ) : undefined
          }
        >
          {showNewForm ? (
            <SettingsBlockBody>
              <NewSkillForm
                defaultScope={hasProject ? 'project' : 'global'}
                hasProject={hasProject}
                onSave={handleNewSave}
                onCancel={() => setShowNewForm(false)}
              />
            </SettingsBlockBody>
          ) : null}
          {globalDir ? (
            <SkillsPathRow
              path={globalDir}
              onCopy={() => void copyGlobalDir()}
              onOpen={() => void openGlobalDirInExplorer()}
            />
          ) : null}
          {globalSkills.length === 0 ? (
            <div className={listStyles.emptyInline}>{t.settingsSkills.noGlobalSkills}</div>
          ) : (
            <div className={listStyles.list}>
              {globalSkills.map((skill) => (
                <SkillCard
                  key={skill.name}
                  skill={skill}
                  onSave={handleSave}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          )}
        </SettingsSection>

        <SettingsSection
          title={t.settingsSkills.projectSkills}
          description={t.settingsSkills.projectHint}
        >
          {!hasProject ? (
            <div className={listStyles.emptyInline}>{t.settingsSkills.noProjectOpen}</div>
          ) : projectSkills.length === 0 ? (
            <div className={listStyles.emptyInline}>{t.settingsSkills.noProjectSkills}</div>
          ) : (
            <div className={listStyles.list}>
              {projectSkills.map((skill) => (
                <SkillCard
                  key={skill.name}
                  skill={skill}
                  onSave={handleSave}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          )}
        </SettingsSection>
      </SettingsPanel>
    </div>
  );
}
