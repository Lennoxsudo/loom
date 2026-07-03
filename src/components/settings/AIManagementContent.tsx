import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from '../../i18n';
import {
  showError as globalShowError,
  showSuccess as globalShowSuccess,
} from '../../utils/notification';
import { DeleteConfirmModal } from './DeleteConfirmModal';
import { CloseIcon, EditIcon, PlusIcon } from '../shared/Icons';
import pageStyles from './SettingsPage.module.css';
import styles from './AIManagementContent.module.css';
import {
  SettingsBlockBody,
  SettingsPanel,
  SettingsSection,
} from './SettingsPrimitives';

interface PromptItem {
  id: string;
  name: string;
  content: string;
  created_at: string;
  updated_at: string;
}

function PromptCard({
  prompt,
  onEdit,
  onDelete,
}: {
  prompt: PromptItem;
  onEdit: (prompt: PromptItem) => void;
  onDelete: (prompt: PromptItem) => void;
}) {
  const t = useTranslation();

  return (
    <div className={styles.promptRow}>
      <div className={styles.promptMain}>
        <div className={styles.promptName}>{prompt.name}</div>
        <div className={styles.promptPreview}>{prompt.content || t.common.noContent}</div>
        <div className={styles.promptMeta}>
          {t.common.updatedAt} {new Date(prompt.updated_at).toLocaleString()}
        </div>
      </div>
      <div className={styles.promptActions}>
        <button
          type="button"
          className={styles.iconBtn}
          onClick={() => onEdit(prompt)}
          title={t.actions.edit}
        >
          <EditIcon size={12} />
        </button>
        <button
          type="button"
          className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
          onClick={() => onDelete(prompt)}
          title={t.actions.delete}
        >
          <CloseIcon size={12} />
        </button>
      </div>
    </div>
  );
}

function PromptForm({
  prompt,
  isSaving,
  onChange,
  onSave,
  onCancel,
}: {
  prompt: PromptItem;
  isSaving: boolean;
  onChange: (prompt: PromptItem) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const t = useTranslation();

  return (
    <div className={styles.formBlock}>
      <div className={styles.formField}>
        <label className={styles.formLabel}>
          {t.common.name}
          <span className={styles.formLabelRequired}>*</span>
        </label>
        <input
          type="text"
          className={styles.formInput}
          value={prompt.name}
          onChange={(e) => onChange({ ...prompt, name: e.target.value })}
          placeholder={t.settingsAiManagement.promptNamePlaceholder}
        />
      </div>
      <div className={styles.formField}>
        <label className={styles.formLabel}>{t.common.content}</label>
        <textarea
          className={styles.formTextarea}
          value={prompt.content}
          onChange={(e) => onChange({ ...prompt, content: e.target.value })}
          placeholder={t.settingsAiManagement.promptContentPlaceholder}
        />
      </div>
      <div className={styles.formFooter}>
        <button type="button" className={styles.cancelBtn} onClick={onCancel}>
          {t.actions.cancel}
        </button>
        <button type="button" className={styles.saveBtn} disabled={isSaving} onClick={onSave}>
          {isSaving ? t.common.saving : t.actions.save}
        </button>
      </div>
    </div>
  );
}

function PromptsPathRow({ path, onCopy }: { path: string; onCopy: () => void }) {
  const t = useTranslation();

  return (
    <div className={styles.pathBlock}>
      <p className={styles.pathLabel}>{t.labels.conversationStorage}</p>
      <div className={styles.pathRow}>
        <div className={styles.pathDisplay} title={path}>
          {path}
        </div>
        <button type="button" className={styles.pathCopyButton} onClick={onCopy}>
          {t.settingsAiManagement.copyPath}
        </button>
      </div>
    </div>
  );
}

export function AIManagementContent() {
  const t = useTranslation();
  const [prompts, setPrompts] = useState<PromptItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [editingPrompt, setEditingPrompt] = useState<PromptItem | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState('');
  const [promptsStoragePath, setPromptsStoragePath] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<{
    isOpen: boolean;
    promptId: string;
    promptName: string;
  }>({
    isOpen: false,
    promptId: '',
    promptName: '',
  });

  useEffect(() => {
    const loadPrompts = async () => {
      try {
        const [promptsStr, storagePath] = await Promise.all([
          invoke<string>('load_prompts'),
          invoke<string>('get_prompts_config_path'),
        ]);
        setPromptsStoragePath(storagePath);
        if (promptsStr) {
          const loadedPrompts = JSON.parse(promptsStr) as PromptItem[];
          setPrompts(loadedPrompts);
        }
      } catch (error) {
        console.error(t.settingsAiManagement.errors.loadFailed, error);
      } finally {
        setIsLoading(false);
      }
    };
    void loadPrompts();
  }, [t.settingsAiManagement.errors.loadFailed]);

  const savePromptsToBackend = async (updatedPrompts: PromptItem[]) => {
    setIsSaving(true);
    setError('');
    try {
      await invoke<string>('save_prompts', { prompts: JSON.stringify(updatedPrompts, null, 2) });
      setPrompts(updatedPrompts);
    } catch (err) {
      setError(t.settingsAiManagement.errors.saveFailed.replace('{error}', String(err)));
    } finally {
      setIsSaving(false);
    }
  };

  const handleCreatePrompt = () => {
    const now = new Date().toISOString();
    setEditingPrompt({
      id: `prompt-${Date.now()}`,
      name: '',
      content: '',
      created_at: now,
      updated_at: now,
    });
    setIsCreating(true);
  };

  const handleSavePrompt = () => {
    if (!editingPrompt) return;
    if (!editingPrompt.name.trim()) {
      setError(t.settingsAiManagement.errors.nameRequired);
      return;
    }

    const now = new Date().toISOString();
    const updatedPrompt = { ...editingPrompt, updated_at: now };

    const updatedPrompts = isCreating
      ? [updatedPrompt, ...prompts]
      : prompts.map((p) => (p.id === updatedPrompt.id ? updatedPrompt : p));

    void savePromptsToBackend(updatedPrompts);
    setEditingPrompt(null);
    setIsCreating(false);
  };

  const handleDeletePrompt = (id: string) => {
    const updatedPrompts = prompts.filter((p) => p.id !== id);
    void savePromptsToBackend(updatedPrompts);
  };

  const handleCancelEdit = () => {
    setEditingPrompt(null);
    setIsCreating(false);
  };

  const copyStoragePath = async () => {
    if (!promptsStoragePath) {
      return;
    }
    try {
      await navigator.clipboard.writeText(promptsStoragePath);
      globalShowSuccess(t.settingsAiManagement.pathCopied);
    } catch {
      globalShowError(t.common.copyFailed);
    }
  };

  if (isLoading) {
    return <div className={pageStyles.loading}>{t.common.loading}</div>;
  }

  return (
    <div className={pageStyles.root}>
      <header className={pageStyles.pageHeader}>
        <h2 className={pageStyles.pageTitle}>{t.settingsAiManagement.title}</h2>
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
          title={t.settingsAiManagement.listTitle}
          description={
            prompts.length === 0 && !editingPrompt ? t.settingsAiManagement.noPromptsHint : undefined
          }
          action={
            !editingPrompt ? (
              <button type="button" className={pageStyles.ghostAddButton} onClick={handleCreatePrompt}>
                <PlusIcon size={12} />
                {t.settingsAiManagement.newPrompt}
              </button>
            ) : undefined
          }
        >
          <SettingsBlockBody>
            <PromptsPathRow path={promptsStoragePath} onCopy={() => void copyStoragePath()} />

            {editingPrompt ? (
              <PromptForm
                prompt={editingPrompt}
                isSaving={isSaving}
                onChange={setEditingPrompt}
                onSave={handleSavePrompt}
                onCancel={handleCancelEdit}
              />
            ) : null}

            {prompts.length === 0 && !editingPrompt ? (
              <div className={styles.emptyState}>{t.settingsAiManagement.noPrompts}</div>
            ) : prompts.length > 0 ? (
              <div className={styles.promptList}>
                {prompts.map((prompt) => (
                  <PromptCard
                    key={prompt.id}
                    prompt={prompt}
                    onEdit={(item) => {
                      setEditingPrompt(item);
                      setIsCreating(false);
                    }}
                    onDelete={(item) => {
                      setDeleteConfirm({
                        isOpen: true,
                        promptId: item.id,
                        promptName: item.name,
                      });
                    }}
                  />
                ))}
              </div>
            ) : null}
          </SettingsBlockBody>
        </SettingsSection>
      </SettingsPanel>

      <DeleteConfirmModal
        isOpen={deleteConfirm.isOpen}
        promptName={deleteConfirm.promptName}
        onConfirm={() => {
          handleDeletePrompt(deleteConfirm.promptId);
          setDeleteConfirm({ isOpen: false, promptId: '', promptName: '' });
        }}
        onCancel={() => {
          setDeleteConfirm({ isOpen: false, promptId: '', promptName: '' });
        }}
      />
    </div>
  );
}
