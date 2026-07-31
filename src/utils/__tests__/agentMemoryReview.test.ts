import { describe, expect, it } from 'vitest';
import {
  extractFromUserText,
  extractMemoryCandidatesFromMessages,
  turnAlreadyWroteAgentMemory,
} from '../agentMemoryReview';
import type { ChatMessage } from '../../types/chat';

function msg(
  partial: Partial<ChatMessage> & Pick<ChatMessage, 'id' | 'role' | 'text'>
): ChatMessage {
  return {
    createdAt: Date.now(),
    ...partial,
  };
}

describe('agentMemoryReview', () => {
  it('extracts explicit remember and preference cues', () => {
    const remember = extractFromUserText('请记住：回复尽量简短');
    expect(remember.length).toBeGreaterThan(0);
    expect(remember[0]?.content).toMatch(/简短/);

    const prefer = extractFromUserText('我偏好 TypeScript');
    expect(prefer.some((c) => c.target === 'user')).toBe(true);
  });

  it('ignores ordinary task chatter', () => {
    expect(extractFromUserText('帮我改一下这个按钮颜色')).toEqual([]);
    expect(extractFromUserText('run the tests please')).toEqual([]);
  });

  it('pulls candidates from the latest turn user messages', () => {
    const messages = [
      msg({ id: '1', role: 'user', text: 'hello' }),
      msg({ id: '2', role: 'assistant', text: 'hi' }),
      msg({ id: '3', role: 'user', text: '记住：用 pnpm' }),
      msg({ id: '4', role: 'assistant', text: 'ok' }),
    ];
    const candidates = extractMemoryCandidatesFromMessages(messages);
    expect(candidates.some((c) => c.content.includes('pnpm'))).toBe(true);
  });

  it('detects agent_memory tool writes in the turn', () => {
    const messages = [
      msg({ id: '1', role: 'user', text: '记住 foo' }),
      msg({
        id: '2',
        role: 'tool',
        text: 'Added entry (3 chars). Usage 3/2200.',
        tool_name: 'agent_memory',
      }),
      msg({ id: '3', role: 'assistant', text: 'done' }),
    ];
    expect(turnAlreadyWroteAgentMemory(messages)).toBe(true);
    expect(
      turnAlreadyWroteAgentMemory([
        msg({ id: '1', role: 'user', text: 'hi' }),
        msg({ id: '2', role: 'assistant', text: 'yo' }),
      ])
    ).toBe(false);
  });
});
