import React, {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  loadPlan,
  peekPlan,
  setPlan,
  inferPlanTitle,
  PLAN_UPDATED_EVENT,
  type PlanDocument,
  type PlanDocumentStatus,
} from '../../features/agent-engine/planStore';
import { openPlanInEditor, syncPlanToOpenEditor } from '../../utils/planEditorBridge';
import { useTranslation } from '../../i18n';
import styles from './PlanDocumentPanel.module.css';

export type PlanReviewRequest = {
  conversationId: string;
  plan: string;
  title?: string;
};

/** overlay = Chat floating accordion; inline = Agent bottom half/full preview */
export type PlanDocumentPanelVariant = 'overlay' | 'inline';

/** half = peek preview; full = expanded editor */
export type PlanExpandLevel = 'half' | 'full';

interface PlanDocumentPanelProps {
  conversationId: string;
  /**
   * `overlay`: floating accordion (legacy).
   * `inline`: in-flow panel anchored after the plan-tool turn in the message list.
   */
  variant?: PlanDocumentPanelVariant;
  /** When true, force full expand (e.g. pending review gate). */
  forceExpand?: boolean;
  /**
   * Show header "预览" to open plan in the main editor.
   * Default: true for overlay, false for inline (Agent).
   * Chat inline layout should pass true.
   */
  showOpenInEditor?: boolean;
  /**
   * Auto-open plan in the main editor when content appears / is updated.
   * Default false.
   */
  autoOpenInEditor?: boolean;
  /** Called when user accepts the plan and starts execution. */
  onAccept?: (plan: PlanDocument) => void;
  style?: React.CSSProperties;
  onLayoutChange?: (detail: { overlayHeight: number }) => void;
}

function statusBadgeClass(status: PlanDocumentStatus): string {
  switch (status) {
    case 'pending_review':
      return styles.badgePending;
    case 'accepted':
      return styles.badgeAccepted;
    case 'rejected':
      return styles.badgeRejected;
    default:
      return styles.badgeDraft;
  }
}

const PlanDocumentPanel: React.FC<PlanDocumentPanelProps> = ({
  conversationId,
  variant = 'overlay',
  forceExpand = false,
  showOpenInEditor,
  autoOpenInEditor,
  onAccept,
  style,
  onLayoutChange,
}) => {
  const t = useTranslation();
  const isInline = variant === 'inline';
  const canOpenInEditor = showOpenInEditor ?? !isInline;
  const shouldAutoOpenEditor = autoOpenInEditor ?? false;

  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const autoOpenedContentRef = useRef<string>('');
  /** Once the user collapses, do not auto-expand until conversation changes or status leaves review. */
  const userCollapsedRef = useRef(false);
  const lastPlanStatusRef = useRef<PlanDocumentStatus | null>(null);
  const prevForceExpandRef = useRef(false);

  const [plan, setPlanState] = useState<PlanDocument>(() =>
    conversationId ? loadPlan(conversationId) : peekPlan(''),
  );
  /** overlay: collapsed header vs open panel */
  const [overlayOpen, setOverlayOpen] = useState(false);
  /** inline: half peek vs full expand — default half */
  const [expandLevel, setExpandLevel] = useState<PlanExpandLevel>('half');
  const [draftContent, setDraftContent] = useState(plan.content);
  const [draftTitle, setDraftTitle] = useState(plan.title);

  const openInMainEditor = useCallback(
    (doc: PlanDocument, activate = true) => {
      if (!conversationId || !doc.content.trim()) return;
      openPlanInEditor(conversationId, doc, {
        activate,
        forceContent: true,
      });
    },
    [conversationId],
  );

  // Conversation switch only — reset expand preference for the new thread
  useEffect(() => {
    userCollapsedRef.current = false;
    lastPlanStatusRef.current = null;
    prevForceExpandRef.current = false;

    if (!conversationId) {
      setPlanState(peekPlan(''));
      setDraftContent('');
      setDraftTitle('');
      autoOpenedContentRef.current = '';
      setExpandLevel('half');
      setOverlayOpen(false);
      return;
    }
    const next = loadPlan(conversationId);
    setPlanState(next);
    setDraftContent(next.content);
    setDraftTitle(next.title);
    lastPlanStatusRef.current = next.status;

    // Initial expand: full when already pending review, else half
    if (isInline) {
      setExpandLevel(next.status === 'pending_review' ? 'full' : 'half');
    } else {
      setOverlayOpen(next.status === 'pending_review');
    }

    if (shouldAutoOpenEditor && next.content.trim()) {
      openInMainEditor(next, true);
      autoOpenedContentRef.current = next.content;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-seed on conversation change
  }, [conversationId]);

  // forceExpand rising edge only (e.g. exit_plan_mode just fired) — never fight user collapse
  useEffect(() => {
    const wasForced = prevForceExpandRef.current;
    prevForceExpandRef.current = forceExpand;
    if (!forceExpand || wasForced) return;
    if (userCollapsedRef.current) return;
    if (isInline) setExpandLevel('full');
    else setOverlayOpen(true);
  }, [forceExpand, isInline]);

  useEffect(() => {
    const onUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ conversationId: string; plan: PlanDocument }>).detail;
      if (!detail || detail.conversationId !== conversationId) return;

      const prevStatus = lastPlanStatusRef.current;
      lastPlanStatusRef.current = detail.plan.status;
      const nextContent = detail.plan.content ?? '';
      const nextTitle = detail.plan.title ?? '';

      // Always apply store updates (including main-editor edits via onPlanEditorContentChange).
      setPlanState(detail.plan);
      setDraftContent(nextContent);
      setDraftTitle(nextTitle);

      // Auto-expand only when status *enters* pending_review — never on every content save
      if (
        detail.plan.status === 'pending_review' &&
        prevStatus !== 'pending_review' &&
        !userCollapsedRef.current
      ) {
        if (isInline) setExpandLevel('full');
        else setOverlayOpen(true);
      }
      if (detail.plan.status !== 'pending_review' && prevStatus === 'pending_review') {
        userCollapsedRef.current = false;
      }

      // Only push panel → editor when auto-open is enabled. Never force-overwrite the
      // main editor while the user is editing there (editor is already source of this event).
      if (shouldAutoOpenEditor && nextContent.trim()) {
        const hadOpened = Boolean(autoOpenedContentRef.current);
        const isNewOrChanged = autoOpenedContentRef.current !== nextContent;
        if (!hadOpened) {
          openInMainEditor(detail.plan, true);
          autoOpenedContentRef.current = nextContent;
        } else if (isNewOrChanged) {
          // Track latest content so we do not re-open; do not forceContent while user may type.
          autoOpenedContentRef.current = nextContent;
        }
      }
    };
    window.addEventListener(PLAN_UPDATED_EVENT, onUpdated);
    return () => window.removeEventListener(PLAN_UPDATED_EVENT, onUpdated);
  }, [conversationId, isInline, shouldAutoOpenEditor, openInMainEditor]);

  const fullLineCount = useMemo(() => {
    if (!draftContent) return 8;
    // Count visual lines (hard newlines); +2 breathing room for wrap/caret.
    return Math.max(8, draftContent.split('\n').length + 2);
  }, [draftContent]);

  /** Estimated px height so full plan is never clipped even if scrollHeight mis-reports. */
  const fullEditorHeightPx = useMemo(() => {
    // font-size 13 * line-height 1.55 ≈ 20.15; padding ~20
    const linePx = 13 * 1.55;
    const paddingPx = 24;
    return Math.ceil(fullLineCount * linePx + paddingPx);
  }, [fullLineCount]);

  // Full expand: force textarea to reveal every line (rows + measured/estimated height).
  useLayoutEffect(() => {
    if (!isInline || expandLevel !== 'full') {
      const el = editorRef.current;
      if (el) el.style.height = '';
      return;
    }
    const el = editorRef.current;
    if (!el) return;

    const fit = () => {
      el.style.height = '0px';
      const measured = el.scrollHeight;
      // Prefer the larger of measured vs line-count estimate so nothing is clipped.
      const next = Math.max(measured, fullEditorHeightPx, 120);
      el.style.height = `${next}px`;
    };

    fit();
    const raf = requestAnimationFrame(fit);
    return () => cancelAnimationFrame(raf);
  }, [isInline, expandLevel, draftContent, draftTitle, plan.status, fullLineCount, fullEditorHeightPx]);

  // Report height for bottom-dock layout (overlay open panel or inline body)
  useEffect(() => {
    if (!onLayoutChange) return;
    const el = isInline ? rootRef.current : panelRef.current;
    const active = isInline || overlayOpen;
    if (!active || !el) {
      onLayoutChange({ overlayHeight: 0 });
      return;
    }
    const ro = new ResizeObserver(() => {
      onLayoutChange({ overlayHeight: el.offsetHeight || 0 });
    });
    ro.observe(el);
    onLayoutChange({ overlayHeight: el.offsetHeight || 0 });
    return () => {
      ro.disconnect();
      onLayoutChange({ overlayHeight: 0 });
    };
  }, [isInline, overlayOpen, expandLevel, onLayoutChange, plan.status, draftContent]);

  const hasContent = Boolean(plan.content.trim() || draftContent.trim());
  const isReviewing = plan.status === 'pending_review';

  const statusLabel = useMemo(() => {
    switch (plan.status) {
      case 'pending_review':
        return t.agent.planPanel.statusPending;
      case 'accepted':
        return t.agent.planPanel.statusAccepted;
      case 'rejected':
        return t.agent.planPanel.statusRejected;
      default:
        return t.agent.planPanel.statusDraft;
    }
  }, [plan.status, t.agent.planPanel]);

  const resolvedTitle =
    draftTitle.trim() || plan.title.trim() || inferPlanTitle(draftContent) || '';
  const summaryTitle = resolvedTitle || t.agent.planPanel.defaultTitle;

  // Backfill empty title field from plan body (models often omit tool `title`).
  useEffect(() => {
    if (draftTitle.trim()) return;
    const inferred = plan.title.trim() || inferPlanTitle(draftContent);
    if (!inferred) return;
    setDraftTitle(inferred);
    if (conversationId && !plan.title.trim()) {
      setPlan(conversationId, { title: inferred });
    }
  }, [conversationId, draftContent, draftTitle, plan.title]);

  const persistDraft = useCallback(() => {
    if (!conversationId) return plan;
    const title =
      draftTitle.trim() || plan.title.trim() || inferPlanTitle(draftContent) || '';
    return setPlan(conversationId, {
      content: draftContent,
      title,
      status:
        plan.status === 'accepted'
          ? 'accepted'
          : plan.status === 'pending_review'
            ? 'pending_review'
            : 'draft',
    });
  }, [conversationId, draftContent, draftTitle, plan]);

  const handleAccept = useCallback(() => {
    if (!conversationId) return;
    const title =
      draftTitle.trim() || plan.title.trim() || inferPlanTitle(draftContent) || '';
    const saved = setPlan(conversationId, {
      content: draftContent,
      title,
      status: 'accepted',
    });
    setPlanState(saved);
    onAccept?.(saved);
  }, [conversationId, draftContent, draftTitle, plan.title, onAccept]);

  const handleBlurPersist = useCallback(() => {
    if (!conversationId) return;
    const saved = persistDraft();
    setPlanState(saved);
    syncPlanToOpenEditor(conversationId, saved, { force: true });
  }, [conversationId, persistDraft]);

  /** Chat only: open plan as markdown tab in the main editor. */
  const handleOpenInEditor = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!conversationId) return;
      const saved = persistDraft();
      setPlanState(saved);
      openInMainEditor(saved, true);
      autoOpenedContentRef.current = saved.content;
    },
    [conversationId, openInMainEditor, persistDraft],
  );

  const toggleExpand = useCallback(() => {
    if (isInline) {
      setExpandLevel((prev) => {
        const next = prev === 'half' ? 'full' : 'half';
        userCollapsedRef.current = next === 'half';
        return next;
      });
    } else {
      setOverlayOpen((v) => {
        const next = !v;
        userCollapsedRef.current = !next;
        return next;
      });
    }
  }, [isInline]);

  /** Expand half → full when clicking empty body chrome (not the editor). */
  const handleHalfBodyClick = useCallback(
    (e: React.MouseEvent) => {
      if (!isInline || expandLevel !== 'half') return;
      // Keep typing in the textarea without forcing expand on every click.
      if (
        e.target instanceof HTMLElement &&
        (e.target.closest('textarea') || e.target.closest('input'))
      ) {
        return;
      }
      userCollapsedRef.current = false;
      setExpandLevel('full');
    },
    [isInline, expandLevel],
  );

  if (!conversationId || (!hasContent && !isReviewing)) {
    return null;
  }

  const bodyOpen = isInline || overlayOpen;
  const isFull = isInline ? expandLevel === 'full' : overlayOpen;
  const showTitleRow = isFull;

  const contentBlock = (
    <>
      {showTitleRow && (
        <div className={styles.titleRow}>
          <input
            className={styles.titleInput}
            value={draftTitle}
            onChange={(e) => setDraftTitle(e.target.value)}
            onBlur={handleBlurPersist}
            placeholder={t.agent.planPanel.titlePlaceholder}
            aria-label={t.agent.planPanel.titlePlaceholder}
          />
        </div>
      )}
      <textarea
        ref={editorRef}
        className={styles.editor}
        value={draftContent}
        rows={isInline && expandLevel === 'full' ? fullLineCount : undefined}
        style={
          isInline && expandLevel === 'full'
            ? { height: fullEditorHeightPx, minHeight: fullEditorHeightPx }
            : undefined
        }
        onChange={(e) => {
          setDraftContent(e.target.value);
          if (isInline && expandLevel === 'full') {
            const el = e.target;
            el.style.height = '0px';
            const next = Math.max(el.scrollHeight, 120);
            el.style.height = `${next}px`;
            el.style.minHeight = `${next}px`;
          }
        }}
        onBlur={handleBlurPersist}
        placeholder={t.agent.planPanel.editorPlaceholder}
        spellCheck={false}
        aria-label={t.agent.planPanel.editorPlaceholder}
      />
    </>
  );

  const actionsBlock = (
    <div className={styles.actions}>
      <span className={styles.hint}>
        {isReviewing
          ? t.agent.planPanel.reviewHint
          : isInline && expandLevel === 'half'
            ? t.agent.planPanel.halfPreviewHint
            : t.agent.planPanel.editHint}
      </span>
      {isReviewing && (
        <button
          type="button"
          className={`${styles.btn} ${styles.btnPrimary}`}
          onClick={handleAccept}
          disabled={!draftContent.trim()}
        >
          {t.agent.planPanel.acceptExecute}
        </button>
      )}
      {!isReviewing && isFull && (
        <button
          type="button"
          className={`${styles.btn} ${styles.btnSecondary}`}
          onClick={handleBlurPersist}
          disabled={!draftContent.trim()}
        >
          {t.agent.planPanel.saveDraft}
        </button>
      )}
    </div>
  );

  return (
    <div
      className={`${styles.root} ${isInline ? styles.rootInline : ''}`}
      ref={rootRef}
      style={style}
      data-testid="plan-document-panel"
      data-variant={variant}
      data-expand={isInline ? expandLevel : overlayOpen ? 'full' : 'collapsed'}
    >
      <div className={`${styles.header} ${isInline ? styles.headerInline : ''}`}>
        <button
          type="button"
          className={styles.headerMain}
          onClick={toggleExpand}
          aria-expanded={isFull}
        >
          <div className={styles.summary}>
            <span className={`${styles.badge} ${statusBadgeClass(plan.status)}`}>{statusLabel}</span>
            <span className={styles.summaryText}>{summaryTitle}</span>
            {!isInline && (
              <span className={styles.summaryMeta}>{t.agent.planPanel.planLabel}</span>
            )}
          </div>
          <span className={styles.headerTrailing} aria-hidden={!isInline}>
            {isInline && (
              <span className={styles.expandHint}>
                {expandLevel === 'half'
                  ? t.agent.planPanel.expandFull
                  : t.agent.planPanel.collapseHalf}
              </span>
            )}
            <span
              className={`${styles.chevron} ${isFull ? styles.chevronExpanded : ''}`}
              aria-hidden
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </span>
          </span>
        </button>
        {canOpenInEditor && (
          <button
            type="button"
            className={styles.headerAction}
            onClick={handleOpenInEditor}
            disabled={!draftContent.trim()}
            title={t.agent.planPanel.openInEditor}
            aria-label={t.agent.planPanel.openInEditor}
          >
            {t.agent.planPanel.openInEditorShort}
          </button>
        )}
      </div>

      {isInline ? (
        <>
          <div
            ref={panelRef}
            className={`${styles.inlineBody} ${
              expandLevel === 'full' ? styles.inlineBodyFull : styles.inlineBodyHalf
            }`}
            onClick={expandLevel === 'half' ? handleHalfBodyClick : undefined}
          >
            {contentBlock}
            {expandLevel === 'half' && <div className={styles.inlineBodyFade} aria-hidden />}
          </div>
          {actionsBlock}
        </>
      ) : (
        <div
          ref={panelRef}
          className={`${styles.panel} ${bodyOpen ? styles.panelOpen : ''}`}
          aria-hidden={!bodyOpen}
        >
          {contentBlock}
          {actionsBlock}
        </div>
      )}
    </div>
  );
};

export default memo(PlanDocumentPanel);
