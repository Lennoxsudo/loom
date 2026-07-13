import { memo, useMemo, type CSSProperties } from 'react';
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
        <div className={styles.headerRow}>
          <span className={`${styles.category} ${isError ? styles.categoryError : ''}`}>
            {categoryLabel}
          </span>

          <span className={styles.statusPill}>
            {isError ? t.common.failed : t.common.completed}
          </span>
        </div>

        {isError ? (
          <span className={styles.errorText}>{errorText || outputText}</span>
        ) : (
          answers.length > 0 && (
            <div
              className={`${styles.answers} ${
                answers.length === 1 ? styles.answersCompact : ''
              }`}
            >
              {answers.map((item, idx) => (
                <div
                  key={`${item.header}-${idx}`}
                  className={styles.answerRow}
                  style={{ '--row-index': idx } as CSSProperties}
                >
                  <span className={styles.questionHeader}>{item.header}</span>
                  <span className={styles.answerValue} title={item.answer}>
                    {item.answer}
                  </span>
                </div>
              ))}
            </div>
          )
        )}
      </div>
    </div>
  );
});

export default AskToolResultCard;
