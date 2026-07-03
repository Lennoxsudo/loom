import styles from './ChatModeToggle.module.css';

export interface ChatModeToggleProps {
  chatMode: 'plan' | 'always-allow';
  setChatMode: React.Dispatch<React.SetStateAction<'plan' | 'always-allow'>>;
  compact?: boolean;
  variant?: 'segmented' | 'composer';
  t: {
    agent: {
      planMode: string;
      planModeShort: string;
      planModeDesc: string;
      alwaysAllowMode: string;
      alwaysAllowModeShort: string;
      alwaysAllowModeDesc: string;
    };
  };
}

export default function ChatModeToggle({
  chatMode,
  setChatMode,
  compact = false,
  variant = 'segmented',
  t,
}: ChatModeToggleProps) {
  const planLabel = compact ? t.agent.planModeShort : t.agent.planMode;
  const allowLabel = compact ? t.agent.alwaysAllowModeShort : t.agent.alwaysAllowMode;

  if (variant === 'composer') {
    const activeLabel = chatMode === 'plan' ? planLabel : allowLabel;
    const nextMode = chatMode === 'plan' ? 'always-allow' : 'plan';
    const activeTitle =
      chatMode === 'plan' ? t.agent.planModeDesc : t.agent.alwaysAllowModeDesc;

    return (
      <button
        type="button"
        className={`${styles.composerModePill} ${
          chatMode === 'always-allow' ? styles.composerModePillAllow : styles.composerModePillPlan
        }`}
        title={activeTitle}
        onClick={() => setChatMode(nextMode)}
      >
        {activeLabel}
      </button>
    );
  }

  return (
    <div
      className={`${styles.segmented} ${compact ? styles.segmentedCompact : ''}`}
      role="group"
      aria-label={t.agent.planMode}
    >
      <button
        type="button"
        className={`${styles.segment} ${chatMode === 'plan' ? styles.segmentActivePlan : ''}`}
        title={t.agent.planModeDesc}
        onClick={() => setChatMode('plan')}
      >
        {planLabel}
      </button>
      <button
        type="button"
        className={`${styles.segment} ${chatMode === 'always-allow' ? styles.segmentActiveAllow : ''}`}
        title={t.agent.alwaysAllowModeDesc}
        onClick={() => setChatMode('always-allow')}
      >
        {allowLabel}
      </button>
    </div>
  );
}
