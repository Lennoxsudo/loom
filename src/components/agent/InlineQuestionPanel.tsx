import React, { useState } from 'react';
import type { QuestionInput, UserAnswer } from '../../utils/aiTools/toolArgs';
import { useTranslation } from '../../i18n';
import styles from './InlineQuestionPanel.module.css';

interface InlineQuestionPanelProps {
  questions: QuestionInput[];
  onSubmit: (answers: UserAnswer[]) => void;
  onCancel: () => void;
}

const InlineQuestionPanel: React.FC<InlineQuestionPanelProps> = ({
  questions,
  onSubmit,
  onCancel,
}) => {
  const t = useTranslation();
  const [selections, setSelections] = useState<Record<number, string[]>>({});

  const handleToggle = (questionIndex: number, label: string, multiSelect: boolean) => {
    setSelections((prev) => {
      const current = prev[questionIndex] || [];
      if (multiSelect) {
        const next = current.includes(label)
          ? current.filter((l) => l !== label)
          : [...current, label];
        return { ...prev, [questionIndex]: next };
      }
      return { ...prev, [questionIndex]: [label] };
    });
  };

  const handleSubmit = () => {
    const answers: UserAnswer[] = questions.map((_, index) => ({
      questionIndex: index,
      selected: selections[index] || [],
    }));
    onSubmit(answers);
  };

  const allAnswered = questions.every((_, index) => {
    const selected = selections[index] || [];
    return selected.length > 0;
  });

  const answeredCount = questions.filter((_, index) => {
    const selected = selections[index] || [];
    return selected.length > 0;
  }).length;

  return (
    <div className={styles.panel} data-testid="inline-question-panel">
      <div className={styles.headerBar}>
        <div className={styles.headerMain}>
          <span className={styles.title}>{t.agentInline.needsConfirmation}</span>
          <span className={`${styles.progress} ${allAnswered ? styles.progressComplete : ''}`}>
            {answeredCount}/{questions.length}
          </span>
        </div>
        <div className={styles.actions}>
          <button type="button" className={styles.cancelBtn} onClick={onCancel}>
            {t.actions.cancel}
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!allAnswered}
            className={`${styles.confirmBtn} ${
              allAnswered ? styles.confirmBtnEnabled : styles.confirmBtnDisabled
            }`}
          >
            {t.agentInline.confirmSelection}
          </button>
        </div>
      </div>

      <div className={styles.divider} aria-hidden="true" />

      <div className={styles.body}>
        <div className={styles.questions}>
          {questions.map((q, qIndex) => {
            const selected = selections[qIndex] || [];
            const isMulti = q.multiSelect || false;

            return (
              <div key={qIndex} className={styles.questionBlock}>
                {(q.header || isMulti) && (
                  <div className={styles.questionMeta}>
                    {q.header && <span className={styles.category}>{q.header}</span>}
                    {isMulti && <span className={styles.multiHint}>{t.agentInline.multiSelectHint}</span>}
                  </div>
                )}

                <div className={styles.optionList}>
                  {q.options.map((opt, optIndex) => {
                    const isSelected = selected.includes(opt.label);

                    return (
                      <button
                        key={optIndex}
                        type="button"
                        aria-pressed={isSelected}
                        onClick={() => handleToggle(qIndex, opt.label, isMulti)}
                        className={`${styles.optionTile} ${
                          isSelected ? styles.optionTileSelected : ''
                        }`}
                      >
                        <span
                          className={`${styles.optionControl} ${
                            isMulti ? styles.optionControlSquare : ''
                          } ${isSelected ? styles.optionControlSelected : ''}`}
                          aria-hidden="true"
                        >
                          {isSelected &&
                            (isMulti ? (
                              <span className={styles.optionControlCheck}>
                                <svg
                                  width="9"
                                  height="9"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="3"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                >
                                  <polyline points="20 6 9 17 4 12" />
                                </svg>
                              </span>
                            ) : (
                              <span className={styles.optionControlDot} />
                            ))}
                        </span>

                        <span className={styles.optionBody}>
                          <span className={styles.optionLabel}>{opt.label}</span>
                          {opt.description && opt.description !== opt.label && (
                            <span className={styles.optionDesc}>{opt.description}</span>
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default InlineQuestionPanel;
