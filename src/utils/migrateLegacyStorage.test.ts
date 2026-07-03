import { beforeEach, describe, expect, it } from 'vitest';
import { migrateLegacyStorageKeys } from './migrateLegacyStorage';

describe('migrateLegacyStorageKeys', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('copies colon-prefixed legacy keys to loom keys', () => {
    localStorage.setItem('aiasprrato:chat-modes:v1', '["agent"]');

    migrateLegacyStorageKeys();

    expect(localStorage.getItem('loom:chat-modes:v1')).toBe('["agent"]');
  });

  it('copies dot-prefixed legacy keys to loom keys', () => {
    localStorage.setItem('aiasprrato.todo_write.items.conv-1', '[]');

    migrateLegacyStorageKeys();

    expect(localStorage.getItem('loom.todo_write.items.conv-1')).toBe('[]');
  });

  it('does not overwrite existing loom keys', () => {
    localStorage.setItem('aiasprrato:chat-modes:v1', '["legacy"]');
    localStorage.setItem('loom:chat-modes:v1', '["current"]');

    migrateLegacyStorageKeys();

    expect(localStorage.getItem('loom:chat-modes:v1')).toBe('["current"]');
  });

  it('skips migration when already migrated', () => {
    localStorage.setItem('aiasprrato:chat-modes:v1', '["agent"]');
    localStorage.setItem('loom.migrated', 'v1');

    migrateLegacyStorageKeys();

    expect(localStorage.getItem('loom:chat-modes:v1')).toBeNull();
  });

  it('sets migration flag after running', () => {
    localStorage.setItem('aiasprrato:chat-modes:v1', '["agent"]');

    migrateLegacyStorageKeys();

    expect(localStorage.getItem('loom.migrated')).toBe('v1');
  });
});
