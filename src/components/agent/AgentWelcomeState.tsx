import { memo } from 'react';
import { useTranslation } from '../../i18n';
import styles from './AgentWelcomeState.module.css';

export interface AgentWelcomeStateProps {
  projectName: string;
  composer: React.ReactNode;
  contextBar: React.ReactNode;
  exiting?: boolean;
  onPromptSelect?: (prompt: string) => void;
}

const AgentWelcomeState = memo(function AgentWelcomeState({
  projectName,
  composer,
  contextBar,
  exiting = false,
  onPromptSelect,
}: AgentWelcomeStateProps) {
  const t = useTranslation();
  const displayName = projectName.trim() || '—';

  const starterPrompts = [
    t.agent.emptyStateProjectStructure,
    t.agent.emptyStateDebugError,
    t.agent.emptyStateRefactorCode,
    t.agent.emptyStateAddTests,
    t.agent.emptyStateReadRules,
  ];

  return (
    <div
      className={styles.welcome}
      data-testid="agent-welcome-state"
      style={{
        opacity: exiting ? 0 : 1,
        transform: exiting ? 'translateY(-8px)' : 'none',
        transition: 'opacity 0.24s ease, transform 0.24s ease',
      }}
    >
      <header className={styles.header}>
        <h1 className={styles.title}>
          {t.agent.welcomeBuildPrompt.replace('{projectName}', displayName)}
        </h1>
        <p className={styles.subtitle}>{t.agent.emptyStateSubtitle}</p>
      </header>

      <div className={styles.chips} aria-label={t.agent.emptyStateTitle}>
        {starterPrompts.map((prompt) => (
          <button
            key={prompt}
            type="button"
            className={styles.chip}
            onClick={() => onPromptSelect?.(prompt)}
          >
            {prompt}
          </button>
        ))}
      </div>

      <div className={styles.composerWrap}>{composer}</div>
      <div className={styles.contextWrap}>{contextBar}</div>
    </div>
  );
});

export default AgentWelcomeState;
