import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import AskToolResultCard, { parseAskToolAnswers } from './AskToolResultCard';

vi.mock('../../i18n', () => ({
  useTranslation: () => ({
    agentInternal: {
      askUserQuestion: '用户信息补充',
    },
    common: {
      completed: '完成',
      failed: '失败',
    },
  }),
}));

describe('parseAskToolAnswers', () => {
  it('extracts headers and answers from tool output', () => {
    const text = [
      '用户已回答问题：',
      '',
      '问题 1 [单选问答演示]: Which language?',
      '回答: Python',
    ].join('\n');

    const answers = parseAskToolAnswers(text, [
      { header: '单选问答演示', question: 'Which language?' },
    ]);

    expect(answers).toEqual([{ header: '单选问答演示', answer: 'Python' }]);
  });

  it('supports multiple questions', () => {
    const text = [
      '用户已回答问题：',
      '',
      '问题 1 [框架]: Pick one',
      '回答: React',
      '',
      '问题 2 [部署]: Pick host',
      '回答: Vercel',
    ].join('\n');

    const answers = parseAskToolAnswers(text, [
      { header: '框架', question: 'Pick one' },
      { header: '部署', question: 'Pick host' },
    ]);

    expect(answers).toEqual([
      { header: '框架', answer: 'React' },
      { header: '部署', answer: 'Vercel' },
    ]);
  });
});

describe('AskToolResultCard', () => {
  it('renders category, answer chip, and completed status', () => {
    render(
      <AskToolResultCard
        isError={false}
        questions={[{ header: '单选问答演示', question: 'Which language?' }]}
        outputText={[
          '用户已回答问题：',
          '',
          '问题 1 [单选问答演示]: Which language?',
          '回答: Python',
        ].join('\n')}
      />
    );

    expect(screen.getByText('用户信息补充')).toBeInTheDocument();
    expect(screen.getByText('单选问答演示')).toBeInTheDocument();
    expect(screen.getByText('Python')).toBeInTheDocument();
    expect(screen.getByText('完成')).toBeInTheDocument();
  });

  it('renders failure state', () => {
    render(<AskToolResultCard isError outputText="ask_user_question 工具未在此环境中支持" />);

    expect(screen.getByText('失败')).toBeInTheDocument();
    expect(screen.getByText('ask_user_question 工具未在此环境中支持')).toBeInTheDocument();
  });
});
