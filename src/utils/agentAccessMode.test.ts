import { describe, it, expect } from 'vitest';
import {
  shouldBlockTool,
  shouldRequestApproval,
  isReadOnlyTool,
  isCommandTool,
} from './agentAccessMode';

describe('agentAccessMode', () => {
  it('identifies read-only tools', () => {
    expect(isReadOnlyTool('read')).toBe(true);
    expect(isReadOnlyTool('write')).toBe(false);
  });

  it('identifies command tools', () => {
    expect(isCommandTool('run_command')).toBe(true);
    expect(isCommandTool('read')).toBe(false);
  });

  it('blocks non-read-only tools in read_only mode', () => {
    expect(shouldBlockTool('read_only', 'read')).toBe(false);
    expect(shouldBlockTool('read_only', 'write')).toBe(true);
    expect(shouldBlockTool('read_only', 'run_command')).toBe(true);
  });

  it('requests approval for commands and write tools in auto mode', () => {
    expect(shouldRequestApproval('auto', 'run_command')).toBe(true);
    expect(shouldRequestApproval('auto', 'write')).toBe(true);
    expect(shouldRequestApproval('auto', 'edit_file')).toBe(true);
    expect(shouldRequestApproval('auto', 'delete_file')).toBe(true);
    expect(shouldRequestApproval('auto', 'create_folder')).toBe(true);
    expect(shouldRequestApproval('auto', 'read')).toBe(false);
    expect(shouldRequestApproval('auto', 'search_content')).toBe(false);
    expect(shouldRequestApproval('full_access', 'run_command')).toBe(false);
  });
});
