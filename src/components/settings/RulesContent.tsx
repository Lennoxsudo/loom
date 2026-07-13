import { useState, useEffect } from 'react';
import { useTranslation } from '../../i18n';
import {
  useChatRules,
  useRulesTemplates,
  useRulesLoaded,
  useLoadRules,
  useAddChatRule,
  useUpdateChatRule,
  useDeleteChatRule,
  useAddTemplate,
  useUpdateTemplate,
  useDeleteTemplate,
} from '../../stores/useRulesStore';
import type { RuleItem } from '../../types/rules';
import { ChevronDownIcon } from '../shared/Icons';
import pageStyles from './SettingsPage.module.css';
import { SettingsDeleteModal } from './SettingsDeleteModal';
import styles from './RulesContent.module.css';
import {
  SettingsBlockBody,
  SettingsPanel,
  SettingsSection,
} from './SettingsPrimitives';

function plainPreviewText(text: string, maxLen = 140): string {
  const plain = text
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!plain) return '';
  return plain.length > maxLen ? `${plain.slice(0, maxLen)}...` : plain;
}

function RuleCard({
  rule,
  onUpdate,
  onDelete,
}: {
  rule: RuleItem;
  onUpdate: (id: string, name: string, content: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const t = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [editName, setEditName] = useState(rule.name);
  const [editContent, setEditContent] = useState(rule.content);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const dirty = editName !== rule.name || editContent !== rule.content;

  const handleSave = async () => {
    if (!editName.trim()) {
      setError(t.settingsRules.nameRequired);
      return;
    }
    if (!editContent.trim()) {
      setError(t.settingsRules.contentRequired);
      return;
    }
    setSaving(true);
    setError('');
    try {
      await onUpdate(rule.id, editName.trim(), editContent);
      setExpanded(false);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setEditName(rule.name);
    setEditContent(rule.content);
    setError('');
    setExpanded(false);
  };

  const handleDelete = async () => {
    try {
      await onDelete(rule.id);
    } catch (e) {
      setError(String(e));
    }
    setConfirmingDelete(false);
  };

  const preview = plainPreviewText(rule.content);

  return (
    <div className={`${styles.listItem} ${expanded ? styles.listItemExpanded : ''}`}>
      <div
        className={`${styles.listItemHeader} ${expanded ? styles.listItemHeaderExpanded : ''}`}
        onClick={expanded ? undefined : () => setExpanded(true)}
      >
        <div className={styles.listItemMain}>
          <div className={styles.listItemNameRow}>
            <div className={styles.listItemName}>{rule.name}</div>
            <button
              type="button"
              className={styles.chevronBtn}
              aria-expanded={expanded}
              aria-label={expanded ? t.settingsRules.cancel : t.settingsRules.editRule}
              onClick={(e) => {
                e.stopPropagation();
                if (expanded) {
                  handleCancel();
                } else {
                  setExpanded(true);
                }
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
          <div className={styles.listItemActions} onClick={(e) => e.stopPropagation()}>
            <button type="button" className={styles.actionBtn} onClick={() => setExpanded(true)}>
              {t.settingsRules.editRule}
            </button>
            <button
              type="button"
              className={styles.deleteBtn}
              onClick={() => setConfirmingDelete(true)}
            >
              {t.settingsRules.deleteRule}
            </button>
          </div>
        ) : null}
      </div>
      {expanded && (
        <div className={styles.listItemBody} onClick={(e) => e.stopPropagation()}>
          <div className={styles.editorPanel}>
            <div className={styles.formField}>
              <label className={styles.formLabel}>{t.settingsRules.ruleName}</label>
              <input
                className={styles.formInput}
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder={t.settingsRules.ruleNamePlaceholder}
              />
            </div>
            <div className={`${styles.formField} ${styles.formFieldLast}`}>
              <label className={styles.formLabel}>{t.settingsRules.ruleContent}</label>
              <textarea
                className={`${styles.formTextarea} ${styles.formTextareaMono}`}
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                placeholder={t.settingsRules.ruleContentPlaceholder}
                spellCheck={false}
              />
            </div>
            {error ? <div className={styles.formError}>{error}</div> : null}
            <div className={styles.formFooter}>
              <button
                type="button"
                className={styles.deleteBtnFooter}
                onClick={() => setConfirmingDelete(true)}
              >
                {t.settingsRules.deleteRule}
              </button>
              <div className={styles.formFooterActions}>
                <button type="button" className={styles.cancelBtn} onClick={handleCancel}>
                  {t.settingsRules.cancel}
                </button>
                <button
                  type="button"
                  className={styles.saveBtn}
                  disabled={!dirty || saving}
                  onClick={() => void handleSave()}
                >
                  {saving ? t.settingsRules.saving : t.settingsRules.save}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {confirmingDelete && (
        <SettingsDeleteModal
          title={t.settingsRules.deleteRule}
          onCancel={() => setConfirmingDelete(false)}
          onConfirm={() => void handleDelete()}
          confirmLabel={t.settingsRules.deleteRule}
        >
          {t.settingsRules.confirmDelete}
        </SettingsDeleteModal>
      )}
    </div>
  );
}

function NewRuleForm({
  onSave,
  onCancel,
}: {
  onSave: (name: string, content: string) => Promise<void>;
  onCancel: () => void;
}) {
  const t = useTranslation();
  const [name, setName] = useState('');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    if (!name.trim()) {
      setError(t.settingsRules.nameRequired);
      return;
    }
    if (!content.trim()) {
      setError(t.settingsRules.contentRequired);
      return;
    }
    setSaving(true);
    setError('');
    try {
      await onSave(name.trim(), content);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.formBlock}>
      <div className={styles.editorPanel}>
        <div className={styles.formField}>
          <label className={styles.formLabel}>{t.settingsRules.ruleName}</label>
          <input
            className={styles.formInput}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t.settingsRules.ruleNamePlaceholder}
          />
        </div>
        <div className={`${styles.formField} ${styles.formFieldLast}`}>
          <label className={styles.formLabel}>{t.settingsRules.ruleContent}</label>
          <textarea
            className={`${styles.formTextarea} ${styles.formTextareaMono}`}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={t.settingsRules.ruleContentPlaceholder}
            spellCheck={false}
          />
        </div>
        {error ? <div className={styles.formError}>{error}</div> : null}
        <div className={styles.formFooter}>
          <div className={styles.formFooterActions}>
            <button type="button" className={styles.cancelBtn} onClick={onCancel}>
              {t.settingsRules.cancel}
            </button>
            <button
              type="button"
              className={styles.saveBtn}
              disabled={saving}
              onClick={() => void handleSave()}
            >
              {saving ? t.settingsRules.saving : t.settingsRules.save}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function AddRuleButton({ onClick }: { onClick: () => void }) {
  const t = useTranslation();

  return (
    <button type="button" className={styles.addBtn} onClick={onClick}>
      + {t.settingsRules.addRule}
    </button>
  );
}

export function RulesContent() {
  const t = useTranslation();
  const chatRules = useChatRules();
  const rulesTemplates = useRulesTemplates();
  const loaded = useRulesLoaded();
  const loadRules = useLoadRules();
  const addChatRule = useAddChatRule();
  const updateChatRule = useUpdateChatRule();
  const deleteChatRule = useDeleteChatRule();
  const addTemplate = useAddTemplate();
  const updateTemplate = useUpdateTemplate();
  const deleteTemplate = useDeleteTemplate();
  const [error, setError] = useState('');
  const [showNewChatRule, setShowNewChatRule] = useState(false);
  const [showNewTemplate, setShowNewTemplate] = useState(false);

  useEffect(() => {
    if (!loaded) {
      loadRules().catch((e) => setError(`${t.settingsRules.loadFailed}: ${String(e)}`));
    }
  }, [loaded, loadRules, t.settingsRules.loadFailed]);

  const handleAddChatRule = async (name: string, content: string) => {
    try {
      await addChatRule(name, content);
      setShowNewChatRule(false);
    } catch (e) {
      setError(`${t.settingsRules.saveFailed}: ${String(e)}`);
      throw e;
    }
  };

  const handleUpdateChatRule = async (id: string, name: string, content: string) => {
    try {
      await updateChatRule(id, name, content);
    } catch (e) {
      setError(`${t.settingsRules.saveFailed}: ${String(e)}`);
      throw e;
    }
  };

  const handleDeleteChatRule = async (id: string) => {
    try {
      await deleteChatRule(id);
    } catch (e) {
      setError(`${t.settingsRules.deleteFailed}: ${String(e)}`);
    }
  };

  const handleAddTemplate = async (name: string, content: string) => {
    try {
      await addTemplate(name, content);
      setShowNewTemplate(false);
    } catch (e) {
      setError(`${t.settingsRules.saveFailed}: ${String(e)}`);
      throw e;
    }
  };

  const handleUpdateTemplate = async (id: string, name: string, content: string) => {
    try {
      await updateTemplate(id, name, content);
    } catch (e) {
      setError(`${t.settingsRules.saveFailed}: ${String(e)}`);
      throw e;
    }
  };

  const handleDeleteTemplate = async (id: string) => {
    try {
      await deleteTemplate(id);
    } catch (e) {
      setError(`${t.settingsRules.deleteFailed}: ${String(e)}`);
    }
  };

  if (!loaded) {
    return <div className={pageStyles.loading}>{t.status.loading}</div>;
  }

  return (
    <div className={`${pageStyles.root} ${styles.root}`}>
      <header className={pageStyles.pageHeader}>
        <h2 className={pageStyles.pageTitle}>{t.settingsRules.title}</h2>
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
          title={t.settingsRules.chatRules}
          action={
            !showNewChatRule ? <AddRuleButton onClick={() => setShowNewChatRule(true)} /> : undefined
          }
        >
          {showNewChatRule ? (
            <SettingsBlockBody>
              <NewRuleForm
                onSave={handleAddChatRule}
                onCancel={() => setShowNewChatRule(false)}
              />
            </SettingsBlockBody>
          ) : null}
          {chatRules.length === 0 ? (
            <div className={styles.emptyInline}>{t.settingsRules.noChatRules}</div>
          ) : (
            <div className={styles.list}>
              {chatRules.map((rule) => (
                <RuleCard
                  key={rule.id}
                  rule={rule}
                  onUpdate={handleUpdateChatRule}
                  onDelete={handleDeleteChatRule}
                />
              ))}
            </div>
          )}
        </SettingsSection>

        <SettingsSection
          title={t.settingsRules.rulesTemplates}
          action={
            !showNewTemplate ? (
              <AddRuleButton onClick={() => setShowNewTemplate(true)} />
            ) : undefined
          }
        >
          {showNewTemplate ? (
            <SettingsBlockBody>
              <NewRuleForm
                onSave={handleAddTemplate}
                onCancel={() => setShowNewTemplate(false)}
              />
            </SettingsBlockBody>
          ) : null}
          {rulesTemplates.length === 0 ? (
            <div className={styles.emptyInline}>{t.settingsRules.noTemplates}</div>
          ) : (
            <div className={styles.list}>
              {rulesTemplates.map((rule) => (
                <RuleCard
                  key={rule.id}
                  rule={rule}
                  onUpdate={handleUpdateTemplate}
                  onDelete={handleDeleteTemplate}
                />
              ))}
            </div>
          )}
        </SettingsSection>
      </SettingsPanel>
    </div>
  );
}
