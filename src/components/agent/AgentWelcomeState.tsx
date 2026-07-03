import { memo } from 'react';
import { useTranslation } from '../../i18n';
import styles from './AgentWelcomeState.module.css';

export interface AgentWelcomeStateProps {
  projectName: string;
  composer: React.ReactNode;
  contextBar: React.ReactNode;
  exiting?: boolean;
}

const AgentWelcomeState = memo(function AgentWelcomeState({
  projectName,
  composer,
  contextBar,
  exiting = false,
}: AgentWelcomeStateProps) {
  const t = useTranslation();
  const displayName = projectName.trim() || '—';

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
      <h1 className={styles.title}>
        {t.agent.welcomeBuildPrompt.replace('{projectName}', displayName)}
      </h1>
      <div className={styles.composerWrap}>{composer}</div>
      <div className={styles.contextWrap}>{contextBar}</div>
    </div>
  );
});

export default AgentWelcomeState;
