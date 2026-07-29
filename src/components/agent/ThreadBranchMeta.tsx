import { memo } from 'react';
import { useTranslation } from '../../i18n';
import styles from './ThreadBranchMeta.module.css';

export interface ThreadBranchMetaProps {
  branchName?: string;
  branchMismatch?: boolean;
}

const ThreadBranchMeta = memo(function ThreadBranchMeta({
  branchName,
  branchMismatch,
}: ThreadBranchMetaProps) {
  const t = useTranslation();

  if (!branchName && !branchMismatch) return null;

  const mismatchHint = branchName
    ? t.agent.threads.branchMismatchHint.replace('{branch}', branchName)
    : t.agent.threads.branchMismatch;

  return (
    <span className={styles.meta}>
      {branchName ? (
        <span className={styles.branchCapsule} title={branchName}>
          {branchName}
        </span>
      ) : null}
      {branchMismatch ? (
        <span
          className={styles.warningCapsule}
          title={mismatchHint}
          data-testid="thread-branch-mismatch"
        >
          {t.agent.threads.branchMismatch}
        </span>
      ) : null}
    </span>
  );
});

export default ThreadBranchMeta;
