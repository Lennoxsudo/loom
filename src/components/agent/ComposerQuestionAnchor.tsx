import type { ReactNode } from 'react';
import type { QuestionInput, UserAnswer } from '../../features/agent-engine/toolArgs';
import InlineQuestionPanel from './InlineQuestionPanel';
import styles from './ComposerQuestionAnchor.module.css';

export type ComposerQuestionAnchorProps = {
  questions: QuestionInput[] | null | undefined;
  onSubmit: (answers: UserAnswer[]) => void;
  onCancel: () => void;
  children: ReactNode;
};

export default function ComposerQuestionAnchor({
  questions,
  onSubmit,
  onCancel,
  children,
}: ComposerQuestionAnchorProps) {
  const showPanel = questions != null && questions.length > 0;

  return (
    <div className={styles.anchor}>
      {showPanel && (
        <div className={styles.overlay} data-testid="inline-question-overlay">
          <InlineQuestionPanel
            questions={questions}
            onSubmit={onSubmit}
            onCancel={onCancel}
          />
        </div>
      )}
      {children}
    </div>
  );
}
