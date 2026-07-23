import { describe, it, expect } from 'vitest';
import { findBestToolMatch } from '../toolMatcher';

describe('toolMatcher: findBestToolMatch', () => {
  const candidates = [
    'term',
    'edit',
    'read',
    'write',
    'search',
    'finfo',
    'git',
    'sym',
    'todo',
    'ask',
    'fetch',
    'browser',
    'skill',
  ];

  it('should return null for empty or whitespace-only inputs', () => {
    expect(findBestToolMatch('', candidates)).toBeNull();
    expect(findBestToolMatch('   ', candidates)).toBeNull();
  });

  it('should return null for extremely short single-character inputs', () => {
    expect(findBestToolMatch('t', candidates)).toBeNull();
    expect(findBestToolMatch('f', candidates)).toBeNull();
  });

  it('should match valid substrings that are at least 2 characters long', () => {
    // 'search_file' matches 'search' through substring matching and token overlap
    expect(findBestToolMatch('search_file', candidates)).toBe('search');

    // 'terminal' should match 'term'
    expect(findBestToolMatch('terminal', candidates)).toBe('term');
  });

  it('should match tools based on token overlap', () => {
    // 'run_command' shares 'run' or similar with candidates, but wait:
    // Let's test custom candidates list
    const customCandidates = ['run_command', 'read_file', 'write_file'];

    // 'run' has overlap with 'run_command'
    expect(findBestToolMatch('run', customCandidates)).toBe('run_command');

    // 'read' matches 'read_file'
    expect(findBestToolMatch('read', customCandidates)).toBe('read_file');
  });

  it('should return null if score is below 50%', () => {
    expect(findBestToolMatch('unrelated_tool_name_completely', candidates)).toBeNull();
  });
});
