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
import pageStyles from './SettingsPage.module.css';
import { SettingsDeleteModal } from './SettingsDeleteModal';
import listStyles from './SettingsExpandableList.module.css';
import {
  SettingsBlockBody,
  SettingsPanel,
  SettingsSection,
} from './SettingsPrimitives';

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

  return (
    <div className={listStyles.listItem}>
      <div className={listStyles.listItemHeader} onClick={() => setExpanded(!expanded)}>
        <div className={listStyles.listItemInfo}>
          <div className={listStyles.listItemName}>{rule.name}</div>
          {!expanded && (
            <div className={listStyles.listItemPreview}>
              {rule.content.slice(0, 80)}
              {rule.content.length > 80 ? '...' : ''}
            </div>
          )}
        </div>
        <div className={listStyles.listItemActions} onClick={(e) => e.stopPropagation()}>
          <button type="button" className={listStyles.actionBtn} onClick={() => setExpanded(!expanded)}>
            {t.settingsRules.editRule}
          </button>
          <button
            type="button"
            className={listStyles.deleteBtn}
            onClick={() => setConfirmingDelete(true)}
          >
            {t.settingsRules.deleteRule}
          </button>
        </div>
      </div>
      {expanded && (
        <div className={listStyles.listItemBody}>
          <div className={listStyles.formField} style={{ marginTop: 8 }}>
            <label className={listStyles.formLabel}>{t.settingsRules.ruleName}</label>
            <input
              className={listStyles.formInput}
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              placeholder={t.settingsRules.ruleNamePlaceholder}
            />
          </div>
          <div className={listStyles.formField}>
            <label className={listStyles.formLabel}>{t.settingsRules.ruleContent}</label>
            <textarea
              className={listStyles.formTextarea}
              style={{ marginTop: 0 }}
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              placeholder={t.settingsRules.ruleContentPlaceholder}
            />
          </div>
          {error ? <div className={listStyles.formError}>{error}</div> : null}
          <div className={listStyles.formFooter}>
            <button type="button" className={listStyles.cancelBtn} onClick={handleCancel}>
              {t.settingsRules.cancel}
            </button>
            <button
              type="button"
              className={listStyles.saveBtn}
              disabled={!dirty || saving}
              onClick={() => void handleSave()}
            >
              {saving ? t.settingsRules.saving : t.settingsRules.save}
            </button>
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
    <div className={listStyles.formBlock}>
      <div className={listStyles.formField}>
        <label className={listStyles.formLabel}>{t.settingsRules.ruleName}</label>
        <input
          className={listStyles.formInput}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t.settingsRules.ruleNamePlaceholder}
        />
      </div>
      <div className={listStyles.formField}>
        <label className={listStyles.formLabel}>{t.settingsRules.ruleContent}</label>
        <textarea
          className={listStyles.formTextarea}
          style={{ marginTop: 0 }}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder={t.settingsRules.ruleContentPlaceholder}
        />
      </div>
      {error ? <div className={listStyles.formError}>{error}</div> : null}
      <div className={listStyles.formFooter}>
        <button type="button" className={listStyles.cancelBtn} onClick={onCancel}>
          {t.settingsRules.cancel}
        </button>
        <button
          type="button"
          className={listStyles.saveBtn}
          disabled={saving}
          onClick={() => void handleSave()}
        >
          {saving ? t.settingsRules.saving : t.settingsRules.save}
        </button>
      </div>
    </div>
  );
}

function AddRuleButton({ onClick }: { onClick: () => void }) {
  const t = useTranslation();

  return (
    <button type="button" className={listStyles.addBtn} onClick={onClick}>
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
    <div className={pageStyles.root}>
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
            <div className={listStyles.emptyInline}>{t.settingsRules.noChatRules}</div>
          ) : (
            <div className={listStyles.list}>
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
            <div className={listStyles.emptyInline}>{t.settingsRules.noTemplates}</div>
          ) : (
            <div className={listStyles.list}>
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
