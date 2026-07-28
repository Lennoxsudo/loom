import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { SendIcon, StopIcon, PlusIcon, ChevronDownIcon } from '../shared/Icons';
import { FileTypeIcon } from '../shared/FileTypeIcon';
import AgentProviderProfileModelSelector from './AgentProviderProfileModelSelector';
import TokenRingIndicator from '../chat/TokenRingIndicator';
import ApprovalModeMenu from './ApprovalModeMenu';
import ChatModeToggle from '../chat/ChatModeToggle';
import SlashSkillMenu from '../shared/SlashSkillMenu';
import ContextMentionMenu from '../shared/ContextMentionMenu';
import ComposerSendQueue from '../shared/ComposerSendQueue';
import { useSlashSkillAutocomplete } from '../../hooks/useSlashSkillAutocomplete';
import { useContextMentionAutocomplete } from '../../hooks/useContextMentionAutocomplete';
import { useTranslation } from '../../i18n';
import type { AgentProtocolSelection } from '../../utils/agentPersistence';
import type { ProviderProfileOption } from '../../utils/aiProviderRuntime';
import type { SkillEntry } from '../../utils/skills';
import type { AttachedFile } from '../chat/types';
import type { PendingImageAttachment } from '../../types/chat';
import type { QueuedComposerItem } from '../../hooks/useChatSendDuringStreamingDispatch';
import type { ContextAnnotation } from '../../utils/contextAnnotations';
import { dedupeContextAnnotations } from '../../utils/contextAnnotations';
import styles from './AgentComposer.module.css';

type SideCapsuleKind = 'skill' | 'mcp';

export function insertComposerMention(
  current: string,
  mention: string,
  selectionStart: number,
  selectionEnd: number
): { nextValue: string; cursor: number } {
  const token = `@${mention}`;
  const before = current.slice(0, selectionStart);
  const after = current.slice(selectionEnd);
  const needsLeadingSpace = before.length > 0 && !/\s$/.test(before);
  const needsTrailingSpace = after.length > 0 && !/^\s/.test(after);
  const insertion = `${needsLeadingSpace ? ' ' : ''}${token}${needsTrailingSpace ? ' ' : ''}`;
  const nextValue = before + insertion + after;
  const cursor = before.length + insertion.length;
  return { nextValue, cursor };
}

interface SideResourceCapsuleProps {
  label: string;
  count: number;
  items: string[];
  emptyLabel: string;
  title: string;
  isOpen: boolean;
  onToggle: () => void;
  onSelectItem: (item: string) => void;
  disabled?: boolean;
}

const SideResourceCapsule = memo(function SideResourceCapsule({
  label,
  count,
  items,
  emptyLabel,
  title,
  isOpen,
  onToggle,
  onSelectItem,
  disabled = false,
}: SideResourceCapsuleProps) {
  return (
    <div className={styles.sideIndicatorWrap}>
      <button
        type="button"
        className={`${styles.sideIndicatorCapsule} ${isOpen ? styles.sideIndicatorCapsuleOpen : ''}`}
        title={title}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        onClick={onToggle}
      >
        <span className={styles.sideIndicatorLabel}>{label}</span>
        <span className={styles.sideIndicatorMeta}>
          <span className={styles.sideIndicatorCount}>{count}</span>
          <span
            className={`${styles.sideIndicatorChevron} ${isOpen ? styles.sideIndicatorChevronOpen : ''}`}
          >
            <ChevronDownIcon size={8} />
          </span>
        </span>
      </button>
      {isOpen && (
        <div className={styles.sideIndicatorDropdown} role="listbox" aria-label={title}>
          {items.length === 0 ? (
            <div className={styles.sideIndicatorEmpty}>{emptyLabel}</div>
          ) : (
            <ul className={styles.sideIndicatorList}>
              {items.map((item) => (
                <li key={item} role="presentation">
                  <button
                    type="button"
                    className={styles.sideIndicatorItem}
                    role="option"
                    title={item}
                    disabled={disabled}
                    onClick={() => onSelectItem(item)}
                  >
                    {item}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
});

export interface AgentComposerProps {
  inputValue: string;
  setInputValue: React.Dispatch<React.SetStateAction<string>>;
  isLoading: boolean;
  isStopping: boolean;
  canSend: boolean;
  showStop: boolean;
  disabled: boolean;
  isDragOver: boolean;
  attachedFiles: AttachedFile[];
  attachedImages: PendingImageAttachment[];
  contextAnnotations?: ContextAnnotation[];
  onContextAnnotationsChange?: (next: ContextAnnotation[]) => void;
  projectPath?: string;
  queuedMessages?: QueuedComposerItem[];
  onRestoreQueuedMessage?: (id: string) => void;
  onRemoveQueuedMessage?: (id: string) => void;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  inputCardRef: React.RefObject<HTMLDivElement | null>;
  imageInputRef: React.RefObject<HTMLInputElement | null>;
  handleDragOver: (e: React.DragEvent) => void;
  handleDragLeave: (e: React.DragEvent) => void;
  handleDrop: (e: React.DragEvent) => Promise<void>;
  handleInputPaste: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void;
  removeFileFromContext: (id: string) => void;
  removeImageFromContext: (id: string) => void;
  handleSend: () => Promise<void>;
  handleStop: () => Promise<void>;
  handleImageInputChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  selectedProvider: AgentProtocolSelection;
  onSelectProvider: (provider: AgentProtocolSelection) => void;
  selectedProfileId: string;
  selectedProfileName: string;
  availableProfiles: ProviderProfileOption[];
  onSelectProfile: (profileId: string) => void;
  selectedModel: string;
  onSelectModel: (model: string) => void;
  availableModels: string[];
  safeTotalTokens: number;
  ctxPercent: number;
  maxContextTokens: number;
  centered?: boolean;
  skillsCount?: number;
  mcpCount?: number;
  skillNames?: string[];
  /** Full skill entries for / autocomplete (user-invocable preferred). */
  invocableSkills?: SkillEntry[];
  mcpToolNames?: string[];
  agentMode?: 'plan' | 'always-allow';
  onAgentModeChange?: (mode: 'plan' | 'always-allow') => void;
}

const AgentComposer = memo(function AgentComposer({
  inputValue,
  setInputValue,
  isLoading: _isLoading,
  isStopping,
  canSend,
  showStop,
  disabled,
  isDragOver,
  attachedFiles,
  attachedImages,
  contextAnnotations = [],
  onContextAnnotationsChange,
  projectPath = '',
  queuedMessages = [],
  onRestoreQueuedMessage,
  onRemoveQueuedMessage,
  textareaRef,
  inputCardRef,
  imageInputRef,
  handleDragOver,
  handleDragLeave,
  handleDrop,
  handleInputPaste,
  removeFileFromContext,
  removeImageFromContext,
  handleSend,
  handleStop,
  handleImageInputChange,
  selectedProvider,
  onSelectProvider,
  selectedProfileId,
  selectedProfileName,
  availableProfiles,
  onSelectProfile,
  selectedModel,
  onSelectModel,
  availableModels,
  safeTotalTokens,
  ctxPercent,
  maxContextTokens,
  centered = false,
  skillsCount = 0,
  mcpCount = 0,
  skillNames = [],
  invocableSkills = [],
  mcpToolNames = [],
  agentMode = 'always-allow',
  onAgentModeChange,
}: AgentComposerProps) {
  const t = useTranslation();
  const [openSideCapsule, setOpenSideCapsule] = useState<SideCapsuleKind | null>(null);
  const sideCapsulesRef = useRef<HTMLDivElement>(null);

  const getCursor = useCallback(
    () => textareaRef.current?.selectionStart ?? inputValue.length,
    [textareaRef, inputValue.length]
  );
  const focusAndSetCursor = useCallback(
    (cursor: number) => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(cursor, cursor);
    },
    [textareaRef]
  );
  const slash = useSlashSkillAutocomplete({
    value: inputValue,
    skills: invocableSkills,
    disabled,
    getCursor,
    setValue: (next) => setInputValue(next),
    focusAndSetCursor,
  });

  const addContextAnnotation = useCallback(
    (annotation: ContextAnnotation) => {
      if (!onContextAnnotationsChange) return;
      onContextAnnotationsChange(dedupeContextAnnotations([...contextAnnotations, annotation]));
    },
    [contextAnnotations, onContextAnnotationsChange]
  );

  const removeContextAnnotation = useCallback(
    (id: string) => {
      if (!onContextAnnotationsChange) return;
      onContextAnnotationsChange(contextAnnotations.filter((a) => a.id !== id));
    },
    [contextAnnotations, onContextAnnotationsChange]
  );

  const mention = useContextMentionAutocomplete({
    value: inputValue,
    projectPath,
    disabled: disabled || !projectPath.trim(),
    suppress: slash.isOpen,
    getCursor,
    setValue: (next) => setInputValue(next),
    focusAndSetCursor,
    onAddAnnotation: addContextAnnotation,
    codebaseDescription: t.chat.contextAnnotationCodebase,
  });

  useEffect(() => {
    if (!openSideCapsule) return;
    const onMouseDown = (event: MouseEvent) => {
      if (sideCapsulesRef.current && !sideCapsulesRef.current.contains(event.target as Node)) {
        setOpenSideCapsule(null);
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [openSideCapsule]);

  const toggleSideCapsule = (kind: SideCapsuleKind) => {
    setOpenSideCapsule((prev) => (prev === kind ? null : kind));
  };

  const handleSelectMention = useCallback(
    (item: string) => {
      if (disabled) return;
      const textarea = textareaRef.current;
      const selectionStart = textarea?.selectionStart ?? inputValue.length;
      const selectionEnd = textarea?.selectionEnd ?? inputValue.length;
      const { nextValue, cursor } = insertComposerMention(
        inputValue,
        item,
        selectionStart,
        selectionEnd
      );
      setInputValue(nextValue);
      setOpenSideCapsule(null);
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(cursor, cursor);
      });
    },
    [disabled, inputValue, setInputValue, textareaRef]
  );

  const sendClass = showStop ? styles.sendStop : canSend ? styles.sendActive : styles.sendDisabled;

  return (
    <div className={styles.shell} style={centered ? undefined : { maxWidth: 'none' }}>
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        multiple
        onChange={handleImageInputChange}
        style={{ display: 'none' }}
      />
      <div className={styles.sideIndicators} ref={sideCapsulesRef}>
        <SideResourceCapsule
          label="SKILL"
          count={skillsCount}
          items={skillNames}
          emptyLabel={t.agent.sideCapsules.noSkills}
          title={t.settingsSkills?.title || 'Skills'}
          isOpen={openSideCapsule === 'skill'}
          onToggle={() => toggleSideCapsule('skill')}
          onSelectItem={handleSelectMention}
          disabled={disabled}
        />
        <SideResourceCapsule
          label="MCP"
          count={mcpCount}
          items={mcpToolNames}
          emptyLabel={t.agent.sideCapsules.noMcp}
          title="MCP"
          isOpen={openSideCapsule === 'mcp'}
          onToggle={() => toggleSideCapsule('mcp')}
          onSelectItem={handleSelectMention}
          disabled={disabled}
        />
      </div>
      <div
        ref={inputCardRef}
        className={`${styles.card} ${isDragOver ? styles.cardDragOver : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={(e) => void handleDrop(e)}
        style={{ position: 'relative' }}
      >
        {slash.isOpen && (
          <SlashSkillMenu
            skills={slash.filtered}
            highlightIndex={slash.highlightIndex}
            onHighlight={slash.setHighlightIndex}
            onSelect={slash.selectSkill}
            label={t.settingsSkills?.title || 'Skills'}
          />
        )}
        {!slash.isOpen && mention.isOpen && (
          <ContextMentionMenu
            items={mention.items}
            highlightIndex={mention.highlightIndex}
            onHighlight={mention.setHighlightIndex}
            onSelect={mention.selectItem}
            label={t.chat.contextAnnotation.replace(/^#\s*/, '').trim() || 'Context'}
          />
        )}
        <ComposerSendQueue
          items={queuedMessages}
          onRestore={onRestoreQueuedMessage ?? (() => undefined)}
          onRemove={onRemoveQueuedMessage ?? (() => undefined)}
          title={t.chat.sendQueueTitle}
          restoreLabel={t.chat.sendQueueRestore}
          removeLabel={t.chat.sendQueueRemove}
          noTextLabel={t.chat.noText}
          imagesLabel={t.chat.sendQueueImages}
          filesLabel={t.chat.sendQueueFiles}
        />
        {(attachedFiles.length > 0 ||
          attachedImages.length > 0 ||
          contextAnnotations.length > 0) && (
          <div className={styles.attachments}>
            {attachedImages.length > 0 && (
              <div className={styles.imageGrid}>
                {attachedImages.map((image, index) => (
                  <div key={image.id} className={styles.imageThumb}>
                    <img
                      src={image.previewUrl}
                      alt={image.fileName || `image-${index + 1}`}
                      draggable={false}
                    />
                    <button
                      type="button"
                      className={styles.removeButton}
                      onClick={() => removeImageFromContext(image.id)}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
            {(attachedFiles.length > 0 || contextAnnotations.length > 0) && (
              <div className={styles.fileGrid}>
                {contextAnnotations.map((ann) => (
                  <div key={ann.id} className={styles.fileChip} title={ann.path}>
                    <span className={styles.fileName}>@{ann.label}</span>
                    <button
                      type="button"
                      className={styles.removeButton}
                      aria-label={t.chat.contextAnnotationRemove}
                      onClick={() => removeContextAnnotation(ann.id)}
                    >
                      ✕
                    </button>
                  </div>
                ))}
                {attachedFiles.map((file) => (
                  <div key={file.id} className={styles.fileChip}>
                    <FileTypeIcon name={file.name} size={11} />
                    <span className={styles.fileName}>{file.name}</span>
                    <button
                      type="button"
                      className={styles.removeButton}
                      onClick={() => removeFileFromContext(file.id)}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className={styles.inputRow}>
          <button
            type="button"
            className={styles.attachButton}
            onClick={() => imageInputRef.current?.click()}
            disabled={disabled}
            title={t.image.dragDropHint}
            aria-label={t.image.dragDropHint}
          >
            <PlusIcon size={14} />
          </button>
          <textarea
            ref={textareaRef}
            className={styles.textarea}
            value={inputValue}
            onChange={(e) => {
              setInputValue(e.target.value);
              requestAnimationFrame(() => {
                slash.refreshCursor();
                mention.refreshCursor();
              });
            }}
            onClick={() => {
              slash.refreshCursor();
              mention.refreshCursor();
            }}
            onKeyUp={() => {
              slash.refreshCursor();
              mention.refreshCursor();
            }}
            onSelect={() => {
              slash.refreshCursor();
              mention.refreshCursor();
            }}
            onPaste={handleInputPaste}
            onKeyDown={(e) => {
              if (slash.onKeyDown(e)) return;
              if (mention.onKeyDown(e)) return;
              if (e.key === 'Enter' && !e.shiftKey && !disabled) {
                e.preventDefault();
                void handleSend();
              }
            }}
            placeholder={disabled ? t.agent.selectAgentFirst : t.agent.composerPlaceholder}
            disabled={disabled}
            rows={1}
          />
        </div>

        <div className={styles.toolbar}>
          <div className={styles.toolbarLeft}>
            {maxContextTokens > 0 && (
              <div className={styles.contextRing}>
                <TokenRingIndicator
                  safeTotalTokens={safeTotalTokens}
                  ctxPercent={ctxPercent}
                  MAX_CONTEXT_TOKENS={maxContextTokens}
                  t={t}
                />
              </div>
            )}
            {onAgentModeChange && (
              <ChatModeToggle
                chatMode={agentMode}
                setChatMode={(next) => {
                  const value = typeof next === 'function' ? next(agentMode) : next;
                  onAgentModeChange(value);
                }}
                variant="composer"
                compact
                t={t}
              />
            )}
            <ApprovalModeMenu />
          </div>
          <div className={styles.toolbarCenter}>
            <AgentProviderProfileModelSelector
              selectedProvider={selectedProvider}
              onSelectProvider={onSelectProvider}
              selectedProfileId={selectedProfileId}
              selectedProfileName={selectedProfileName}
              availableProfiles={availableProfiles}
              onSelectProfile={onSelectProfile}
              selectedModel={selectedModel}
              onSelectModel={onSelectModel}
              availableModels={availableModels}
              selectProfileLabel={t.agent.selectProfile}
              selectModelLabel={t.common.selectModel}
              profileLabel={t.agent.profileLabel}
              autoRoutingLabel={t.agent.autoRouting}
              builtinProtocolLabel={t.settingsBuiltin.protocolLabel}
              variant="ghost"
            />
          </div>
          <div className={styles.toolbarRight}>
            <button
              type="button"
              className={`${styles.sendButton} ${sendClass}`}
              onClick={() => (showStop ? void handleStop() : void handleSend())}
              disabled={(!canSend && !showStop) || isStopping}
              title={showStop ? t.chat.stopGenerating : undefined}
              aria-label={showStop ? t.actions.stop : t.actions.send}
            >
              {showStop ? <StopIcon size={14} /> : <SendIcon size={14} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});

export default AgentComposer;
