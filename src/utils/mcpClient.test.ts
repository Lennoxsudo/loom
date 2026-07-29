import { describe, expect, it } from 'vitest';
import {
  resolveMcpServerDisplayState,
  type McpServerStatusEntry,
} from './mcpClient';

const running: McpServerStatusEntry = {
  server_id: 'demo',
  server_name: 'demo',
  is_running: true,
  is_initialized: true,
};

describe('resolveMcpServerDisplayState', () => {
  it('returns disabled when server is disabled', () => {
    expect(resolveMcpServerDisplayState(false, running, null, 'demo')).toBe('disabled');
  });

  it('returns starting when busy', () => {
    expect(resolveMcpServerDisplayState(true, undefined, 'demo', 'demo')).toBe('starting');
  });

  it('returns running when initialized', () => {
    expect(resolveMcpServerDisplayState(true, running, null, 'demo')).toBe('running');
  });

  it('returns disconnected when enabled but not running', () => {
    expect(
      resolveMcpServerDisplayState(
        true,
        { ...running, is_running: false, is_initialized: false },
        null,
        'demo'
      )
    ).toBe('disconnected');
  });
});
