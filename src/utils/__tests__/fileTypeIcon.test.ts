import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  getFileTypeIconName,
  getFileTypeIconUrl,
  MATERIAL_ICONS_BASE_URL,
} from '../fileTypeIcon';

const ICONS_DIR = resolve(process.cwd(), 'public/material-icons');

describe('fileTypeIcon', () => {
  it('uses markdown icon for markdown files including README and mdc', () => {
    expect(getFileTypeIconName('README.md', false)).toBe('markdown');
    expect(getFileTypeIconName('notes.markdown', false)).toBe('markdown');
    expect(getFileTypeIconName('开发规范.mdc', false)).toBe('markdown');
    expect(getFileTypeIconUrl('README.md', false)).toBe(
      `${MATERIAL_ICONS_BASE_URL}/markdown.svg`,
    );
  });

  it('uses json icon only for weak json mappings', () => {
    expect(getFileTypeIconName('package.json', false)).toBe('json');
    expect(getFileTypeIconName('tsconfig.app.json', false)).toBe('json');
    expect(getFileTypeIconName('package-lock.json', false)).toBe('json');
    expect(getFileTypeIconName('tauri.conf.json', false)).toBe('tauri');
  });

  it('fixes other weak fallback mappings', () => {
    expect(getFileTypeIconName('Cargo.toml', false)).toBe('rust');
    expect(getFileTypeIconName('.env', false)).toBe('key');
    expect(getFileTypeIconName('preview.yml', false)).toBe('yaml');
    expect(getFileTypeIconName('docker-compose.yml', false)).toBe('docker');
  });

  it('keeps specialized icons for common project files', () => {
    expect(getFileTypeIconName('eslint.config.ts', false)).toBe('eslint');
    expect(getFileTypeIconName('test-example.ts', false)).toBe('typescript');
    expect(getFileTypeIconName('vite.config.ts', false)).toBe('vite');
    expect(getFileTypeIconName('.gitignore', false)).toBe('git');
    expect(getFileTypeIconName('lib.rs', false)).toBe('rust');
    expect(getFileTypeIconName('App.tsx', false)).toBe('react_ts');
  });

  it('resolves directory icons including expanded state', () => {
    expect(getFileTypeIconName('src', true)).toBe('folder-src');
    expect(getFileTypeIconName('src', true, true)).toBe('folder-src-open');
    expect(getFileTypeIconName('node_modules', true)).toBe('folder-node');
    expect(getFileTypeIconName('newfolder', true)).toBe('folder');
  });

  it('maps icons to existing svg assets', () => {
    const samples = [
      'package.json',
      'README.md',
      'vite.config.ts',
      'src',
      'node_modules',
      'Cargo.toml',
      'tauri.conf.json',
      '.env',
      'preview.yml',
    ];

    for (const sample of samples) {
      const isDir = sample === 'src' || sample === 'node_modules';
      const iconName = getFileTypeIconName(sample, isDir);
      const iconPath = resolve(ICONS_DIR, `${iconName}.svg`);
      expect(existsSync(iconPath), `${sample} -> ${iconName}`).toBe(true);
    }
  });
});
