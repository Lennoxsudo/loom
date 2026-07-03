import { Fragment, memo, useMemo } from 'react';
import { useTranslation } from '../../i18n';
import { TOOL_RESULT_WIDTH } from './toolResultLayout';
import styles from './AskToolResultCard.module.css';

export type AskQuestionArg = {
  header: string;
  question: string;
};

export type AskAnswerPair = {
  header: string;
  answer: string;
};

export function parseAskToolAnswers(
  text: string,
  questions: AskQuestionArg[]
): AskAnswerPair[] {
  if (!text || questions.length === 0) return [];

  const textLines = text.split('\n');
  const answers: AskAnswerPair[] = [];

  questions.forEach((q, idx) => {
    const indexLineIndex = textLines.findIndex((line) => line.includes(`问题 ${idx + 1}`));
    if (indexLineIndex === -1 || indexLineIndex + 1 >= textLines.length) return;

    const answerLine = textLines[indexLineIndex + 1];
    const match = answerLine.match(/(?:回答|Answer):\s*(.*)/i);
    if (!match) return;

    answers.push({
      header: q.header || `问题 ${idx + 1}`,
      answer: match[1].trim(),
    });
  });

  return answers;
}

function QuestionIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
      <path
        d="M9.5 9.5a2.6 2.6 0 0 1 4.3 1.9c0 1.6-1.4 2.2-2 2.6-.4.3-.8.6-.8 1.2"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <circle cx="12" cy="17.2" r="1.1" fill="currentColor" />
    </svg>
  );
}

export type AskToolResultCardProps = {
  isError: boolean;
  errorText?: string;
  questions?: AskQuestionArg[];
  outputText: string;
};

const AskToolResultCard = memo(function AskToolResultCard({
  isError,
  errorText,
  questions = [],
  outputText,
}: AskToolResultCardProps) {
  const t = useTranslation();
  const categoryLabel = t.agentInternal.askUserQuestion;

  const answers = useMemo(
    () => (isError ? [] : parseAskToolAnswers(outputText, questions)),
    [isError, outputText, questions]
  );

  return (
    <div style={TOOL_RESULT_WIDTH}>
      <div className={`${styles.card} ${isError ? styles.cardError : ''}`}>
        <div className={styles.inner}>
          <div className={styles.main}>
            <div className={styles.headerRow}>
              <span className={`${styles.category} ${isError ? styles.categoryError : ''}`}>
                <span className={`${styles.categoryIcon} ${isError ? styles.categoryIconError : ''}`}>
                  <QuestionIcon />
                </span>
                {categoryLabel}
              </span>

              <span
                className={`${styles.status} ${isError ? styles.statusError : styles.statusSuccess}`}
              >
                <span className={styles.statusIcon} aria-hidden="true">
                  {isError ? '✘' : '✓'}
                </span>
                {isError ? t.common.failed : t.common.completed}
              </span>
            </div>

            {isError ? (
              <span className={styles.errorText}>{errorText || outputText}</span>
            ) : (
              answers.length > 0 && (
                <div className={styles.answers}>
                  {answers.map((item, idx) => (
                    <Fragment key={`${item.header}-${idx}`}>
                      <span className={styles.questionHeader}>{item.header}</span>
                      <span className={styles.answerChip} title={item.answer}>
                        {item.answer}
                      </span>
                    </Fragment>
                  ))}
                </div>
              )
            )}
          </div>
        </div>
      </div>
    </div>
  );
});

export default AskToolResultCard;
