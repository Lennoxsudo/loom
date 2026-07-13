import { describe, expect, it } from 'vitest';
import {
  buildChatCheckpointSessionKey,
  rebuildChatUserMessageContent,
  splitChatUserMessageContent,
} from './chatUserMessageEdit';

describe('chatUserMessageEdit', () => {
  const fileContext = '# File Context\n\n';

  it('splits file context prefix from body', () => {
    const content = `${fileContext}- a.ts (\`/a.ts\`)\n---\n\nPlease fix this.`;
    const { prefix, body } = splitChatUserMessageContent(content, fileContext);
    expect(prefix).toBe(`${fileContext}- a.ts (\`/a.ts\`)\n---\n\n`);
    expect(body).toBe('Please fix this.');
    expect(rebuildChatUserMessageContent(prefix, 'Revised task')).toBe(
      `${fileContext}- a.ts (\`/a.ts\`)\n---\n\nRevised task`
    );
  });

  it('returns full content as body when no file context', () => {
    const content = 'hello world';
    const { prefix, body } = splitChatUserMessageContent(content, fileContext);
    expect(prefix).toBe('');
    expect(body).toBe('hello world');
  });

  it('builds stable session keys', () => {
    expect(buildChatCheckpointSessionKey('D:\\proj\\App', 'conv-1')).toBe(
      'd:/proj/app::conv-1'
    );
    expect(buildChatCheckpointSessionKey('', 'conv-2')).toBe('no-project::conv-2');
  });
});
