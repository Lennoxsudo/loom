import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type { FileNode } from '../components/FileTree';

interface FileState {
  projectName: string;
  projectPath: string;
  fileTree: FileNode[];
  expandedDirs: Set<string>;
  loadingDirs: Set<string>;
  isFileTreeCollapsed: boolean;
  explorerWorkingDir: string | null;
}

interface FileActions {
  setProjectName: (name: string) => void;
  setProjectPath: (path: string) => void;
  setFileTree: (tree: FileNode[] | ((prev: FileNode[]) => FileNode[])) => void;
  setExpandedDirs: (dirs: Set<string> | ((prev: Set<string>) => Set<string>)) => void;
  setLoadingDirs: (dirs: Set<string> | ((prev: Set<string>) => Set<string>)) => void;
  setIsFileTreeCollapsed: (collapsed: boolean) => void;
  setExplorerWorkingDir: (dir: string | null) => void;
  toggleExpandedDir: (dirPath: string) => void;
  addExpandedDir: (dirPath: string) => void;
  removeExpandedDir: (dirPath: string) => void;
  addLoadingDir: (dirPath: string) => void;
  removeLoadingDir: (dirPath: string) => void;
  resetFile: () => void;
}

const initialState: FileState = {
  projectName: '',
  projectPath: '',
  fileTree: [],
  expandedDirs: new Set(),
  loadingDirs: new Set(),
  isFileTreeCollapsed: false,
  explorerWorkingDir: null,
};

export const useFileStore = create<FileState & FileActions>()(
  devtools(
    (set) => ({
      ...initialState,

      setProjectName: (name) => set({ projectName: name }),

      setProjectPath: (path) => set({ projectPath: path }),

      setFileTree: (tree) =>
        set((state) => ({
          fileTree: typeof tree === 'function' ? tree(state.fileTree) : tree,
        })),

      setExpandedDirs: (dirs) =>
        set((state) => ({
          expandedDirs: typeof dirs === 'function' ? dirs(state.expandedDirs) : dirs,
        })),

      setLoadingDirs: (dirs) =>
        set((state) => ({
          loadingDirs: typeof dirs === 'function' ? dirs(state.loadingDirs) : dirs,
        })),

      setIsFileTreeCollapsed: (collapsed) => set({ isFileTreeCollapsed: collapsed }),

      setExplorerWorkingDir: (dir) => set({ explorerWorkingDir: dir }),

      toggleExpandedDir: (dirPath) =>
        set((state) => {
          const next = new Set(state.expandedDirs);
          if (next.has(dirPath)) {
            next.delete(dirPath);
          } else {
            next.add(dirPath);
          }
          return { expandedDirs: next };
        }),

      addExpandedDir: (dirPath) =>
        set((state) => {
          const next = new Set(state.expandedDirs);
          next.add(dirPath);
          return { expandedDirs: next };
        }),

      removeExpandedDir: (dirPath) =>
        set((state) => {
          const next = new Set(state.expandedDirs);
          next.delete(dirPath);
          return { expandedDirs: next };
        }),

      addLoadingDir: (dirPath) =>
        set((state) => {
          const next = new Set(state.loadingDirs);
          next.add(dirPath);
          return { loadingDirs: next };
        }),

      removeLoadingDir: (dirPath) =>
        set((state) => {
          const next = new Set(state.loadingDirs);
          next.delete(dirPath);
          return { loadingDirs: next };
        }),

      resetFile: () => set(initialState),
    }),
    {
      name: 'FileStore',
    }
  )
);
