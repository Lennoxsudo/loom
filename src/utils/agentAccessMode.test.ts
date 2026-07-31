import { describe, it, expect } from 'vitest';
import {
  shouldBlockTool,
  shouldRequestApproval,
  isReadOnlyTool,
  isCommandTool,
  isToolFilteredInReadOnlyProviderList,
} from './agentAccessMode';

describe('agentAccessMode', () => {
  it('identifies read-only tools', () => {
    expect(isReadOnlyTool('read')).toBe(true);
    expect(isReadOnlyTool('fetch')).toBe(true);
    expect(isReadOnlyTool('web_search')).toBe(true);
    expect(isReadOnlyTool('graph_query')).toBe(true);
    expect(isReadOnlyTool('graph_trace')).toBe(true);
    expect(isReadOnlyTool('graph_index')).toBe(false);
    expect(isReadOnlyTool('write')).toBe(false);
  });

  it('allows interactive and plan tools in read_only mode', () => {
    for (const name of [
      'todo',
      'TodoWrite',
      'memory',
      'agent_memory',
      'session_search',
      'ask',
      'ask_user_question',
      'update_plan',
      'exit_plan_mode',
      'skill',
      'load_skill',
    ]) {
      expect(isReadOnlyTool(name)).toBe(true);
      expect(shouldBlockTool('read_only', name)).toBe(false);
    }
  });

  it('allows web_search and graph read tools in read_only mode', () => {
    expect(shouldBlockTool('read_only', 'web_search')).toBe(false);
    expect(shouldBlockTool('read_only', 'fetch')).toBe(false);
    expect(shouldBlockTool('read_only', 'graph_query')).toBe(false);
    expect(shouldBlockTool('read_only', 'graph_trace')).toBe(false);
    expect(shouldBlockTool('read_only', 'graph_index')).toBe(true);
  });

  it('identifies command tools', () => {
    expect(isCommandTool('run_command')).toBe(true);
    expect(isCommandTool('read')).toBe(false);
  });

  it('blocks non-read-only tools in read_only mode', () => {
    expect(shouldBlockTool('read_only', 'read')).toBe(false);
    expect(shouldBlockTool('read_only', 'write')).toBe(true);
    expect(shouldBlockTool('read_only', 'run_command')).toBe(true);
    expect(shouldBlockTool('read_only', 'copy_file')).toBe(true);
    expect(shouldBlockTool('read_only', 'move_file')).toBe(true);
  });

  it('filters copy_file from read_only provider tool list like move_file', () => {
    expect(isToolFilteredInReadOnlyProviderList('copy_file')).toBe(true);
    expect(isToolFilteredInReadOnlyProviderList('move_file')).toBe(true);
    expect(isToolFilteredInReadOnlyProviderList('read')).toBe(false);
  });

  it('requests approval only for delete_file in auto mode', () => {
    expect(shouldRequestApproval('auto', 'run_command')).toBe(false);
    expect(shouldRequestApproval('auto', 'write')).toBe(false);
    expect(shouldRequestApproval('auto', 'edit_file')).toBe(false);
    expect(shouldRequestApproval('auto', 'delete_file')).toBe(true);
    expect(shouldRequestApproval('auto', 'create_folder')).toBe(false);
    expect(shouldRequestApproval('auto', 'read')).toBe(false);
    expect(shouldRequestApproval('auto', 'search_content')).toBe(false);
    expect(shouldRequestApproval('full_access', 'run_command')).toBe(false);
  });
});
