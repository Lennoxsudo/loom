import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import FileTree, { type FileNode } from './FileTree';
import { I18nProvider } from '../i18n';

vi.mock('@dnd-kit/core', () => ({
  useDraggable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: () => {},
    isDragging: false,
  }),
  useDroppable: () => ({
    setNodeRef: () => {},
    isOver: false,
  }),
}));

const baseNodes: FileNode[] = [
  {
    name: 'node_modules',
    path: 'D:\\demo\\node_modules',
    is_dir: true,
    children_loaded: false,
  },
  ...Array.from({ length: 20 }, (_, index) => ({
    name: `file-${index}.ts`,
    path: `D:\\demo\\file-${index}.ts`,
    is_dir: false,
    children_loaded: false,
  })),
];

const expandedNodes: FileNode[] = [
  {
    name: 'node_modules',
    path: 'D:\\demo\\node_modules',
    is_dir: true,
    children_loaded: true,
    children: Array.from({ length: 120 }, (_, index) => ({
      name: `dep-${index}.js`,
      path: `D:\\demo\\node_modules\\dep-${index}.js`,
      is_dir: false,
      children_loaded: false,
    })),
  },
  ...baseNodes.slice(1),
];

const activeFilePath = 'D:\\demo\\file-18.ts';

describe('FileTree auto reveal', () => {
  const clientHeightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');

  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get: () => 260,
    });
  });

  afterEach(() => {
    cleanup();
    if (clientHeightDescriptor) {
      Object.defineProperty(HTMLElement.prototype, 'clientHeight', clientHeightDescriptor);
    } else {
      Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
        configurable: true,
        get: () => 0,
      });
    }
  });

  test('does not re-scroll current file when expanding an unrelated directory', async () => {
    const view = render(
      <I18nProvider>
        <FileTree
          nodes={baseNodes}
          onSelectFile={() => {}}
          activeFilePath={activeFilePath}
          expandedDirs={new Set()}
          loadingDirs={new Set()}
          onToggleDir={() => {}}
        />
      </I18nProvider>
    );

    const scrollContainer = view.container.firstElementChild as HTMLDivElement;

    await waitFor(() => {
      expect(scrollContainer.scrollTop).toBeGreaterThan(0);
    });

    const initialScrollTop = scrollContainer.scrollTop;

    view.rerender(
      <I18nProvider>
        <FileTree
          nodes={expandedNodes}
          onSelectFile={() => {}}
          activeFilePath={activeFilePath}
          expandedDirs={new Set(['D:\\demo\\node_modules'])}
          loadingDirs={new Set()}
          onToggleDir={() => {}}
        />
      </I18nProvider>
    );

    await waitFor(() => {
      expect(scrollContainer.scrollTop).toBe(initialScrollTop);
    });
  });

  test('compacts single-child directory chains like VS Code', async () => {
    const user = userEvent.setup();
    const onToggleDir = vi.fn();

    render(
      <I18nProvider>
        <FileTree
          nodes={[
            {
              name: 'src',
              path: 'D:\\demo\\src',
              is_dir: true,
              children_loaded: true,
              children: [
                {
                  name: 'components',
                  path: 'D:\\demo\\src\\components',
                  is_dir: true,
                  children_loaded: true,
                  children: [
                    {
                      name: 'ui',
                      path: 'D:\\demo\\src\\components\\ui',
                      is_dir: true,
                      children_loaded: true,
                      children: [
                        {
                          name: 'Button.tsx',
                          path: 'D:\\demo\\src\\components\\ui\\Button.tsx',
                          is_dir: false,
                          children_loaded: false,
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ]}
          onSelectFile={() => {}}
          expandedDirs={new Set()}
          loadingDirs={new Set()}
          onToggleDir={onToggleDir}
        />
      </I18nProvider>
    );

    const compactRow = screen.getByText('src/components/ui');
    expect(compactRow).toBeInTheDocument();
    expect(screen.queryByText('src')).not.toBeInTheDocument();
    expect(screen.queryByText('components')).not.toBeInTheDocument();
    expect(screen.queryByText('ui')).not.toBeInTheDocument();

    await user.click(compactRow);
    expect(onToggleDir).toHaveBeenCalledWith('D:\\demo\\src\\components\\ui');
  });
});
