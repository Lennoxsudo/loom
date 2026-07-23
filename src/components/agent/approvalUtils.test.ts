import { describe, expect, it } from 'vitest';
import { buildToolApprovalRejectionText, getApprovalType } from './approvalUtils';

const labels = {
  rejectedToolResult: 'DENIED:{toolName}',
  rejectedToolResultWithTarget: 'DENIED:{toolName}:{target}',
};

describe('buildToolApprovalRejectionText', () => {
  it('includes tool name for generic rejection', () => {
    expect(buildToolApprovalRejectionText('delete_file', {}, labels)).toBe('DENIED:delete_file');
  });

  it('includes target path when available', () => {
    expect(buildToolApprovalRejectionText('delete_file', { path: 'src/foo.ts' }, labels)).toBe(
      'DENIED:delete_file:src/foo.ts'
    );
  });

  it('strips mcp prefix from tool name', () => {
    expect(
      buildToolApprovalRejectionText('mcp_server__delete_file', { path: 'a.ts' }, labels)
    ).toBe('DENIED:delete_file:a.ts');
  });

  it('treats graph_index index as command approval', () => {
    expect(getApprovalType('graph_index', 'graph_index', { action: 'index' })).toBe('command');
    expect(getApprovalType('graph_index', 'graph_index', { action: 'status' })).toBeNull();
    expect(getApprovalType('graph_query', 'graph_query', { action: 'search' })).toBeNull();
  });
});
