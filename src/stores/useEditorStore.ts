import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type { EditorGroupId, EditorGroupState, OpenFile, SplitDirection } from '../types/app';

interface EditorContextMenu {
  x: number;
  y: number;
  groupId: EditorGroupId;
}

interface TabToClose {
  groupId: EditorGroupId;
  filePath: string;
}

interface EditorState {
  openFilesByPath: Record<string, OpenFile>;
  editorGroups: EditorGroupState[];
  activeGroupId: EditorGroupId;
  hoveredTabId: string | null;
  splitDirection: SplitDirection;
  splitRatioRow: number;
  splitRatioColumn: number;
  isEditorSplitResizing: boolean;
  modalOpen: boolean;
  tabToClose: TabToClose | null;
  editorContextMenu: EditorContextMenu | null;
}

interface EditorActions {
  setOpenFilesByPath: (
    files: Record<string, OpenFile> | ((prev: Record<string, OpenFile>) => Record<string, OpenFile>)
  ) => void;
  setEditorGroups: (
    groups: EditorGroupState[] | ((prev: EditorGroupState[]) => EditorGroupState[])
  ) => void;
  setActiveGroupId: (id: EditorGroupId) => void;
  setHoveredTabId: (id: string | null) => void;
  setSplitDirection: (direction: SplitDirection) => void;
  setSplitRatioRow: (ratio: number) => void;
  setSplitRatioColumn: (ratio: number) => void;
  setIsEditorSplitResizing: (resizing: boolean) => void;
  setModalOpen: (open: boolean) => void;
  setTabToClose: (tab: TabToClose | null) => void;
  setEditorContextMenu: (menu: EditorContextMenu | null) => void;
}

const initialState: EditorState = {
  openFilesByPath: {},
  editorGroups: [{ id: 'group-1', tabPaths: [], activePath: null }],
  activeGroupId: 'group-1',
  hoveredTabId: null,
  splitDirection: 'row',
  splitRatioRow: 0.5,
  splitRatioColumn: 0.5,
  isEditorSplitResizing: false,
  modalOpen: false,
  tabToClose: null,
  editorContextMenu: null,
};

export const useEditorStore = create<EditorState & EditorActions>()(
  devtools(
    (set) => ({
      ...initialState,

      setOpenFilesByPath: (files) =>
        set((state) => ({
          openFilesByPath: typeof files === 'function' ? files(state.openFilesByPath) : files,
        })),

      setEditorGroups: (groups) =>
        set((state) => ({
          editorGroups: typeof groups === 'function' ? groups(state.editorGroups) : groups,
        })),

      setActiveGroupId: (id) => set({ activeGroupId: id }),

      setHoveredTabId: (id) => set({ hoveredTabId: id }),

      setSplitDirection: (direction) => set({ splitDirection: direction }),

      setSplitRatioRow: (ratio) => set({ splitRatioRow: ratio }),

      setSplitRatioColumn: (ratio) => set({ splitRatioColumn: ratio }),

      setIsEditorSplitResizing: (resizing) => set({ isEditorSplitResizing: resizing }),

      setModalOpen: (open) => set({ modalOpen: open }),

      setTabToClose: (tab) => set({ tabToClose: tab }),

      setEditorContextMenu: (menu) => set({ editorContextMenu: menu }),
    }),
    {
      name: 'EditorStore',
    }
  )
);

// 细粒度选择器 hooks，用于避免不必要的重渲染
export const useEditorOpenFiles = () => useEditorStore((state) => state.openFilesByPath);
export const useEditorGroups = () => useEditorStore((state) => state.editorGroups);
export const useEditorActiveGroupId = () => useEditorStore((state) => state.activeGroupId);
export const useEditorHoveredTabId = () => useEditorStore((state) => state.hoveredTabId);
export const useEditorSplitDirection = () => useEditorStore((state) => state.splitDirection);
export const useEditorSplitRatioRow = () => useEditorStore((state) => state.splitRatioRow);
export const useEditorSplitRatioColumn = () => useEditorStore((state) => state.splitRatioColumn);
export const useEditorIsSplitResizing = () =>
  useEditorStore((state) => state.isEditorSplitResizing);
export const useEditorModalOpen = () => useEditorStore((state) => state.modalOpen);
export const useEditorTabToClose = () => useEditorStore((state) => state.tabToClose);
export const useEditorContextMenu = () => useEditorStore((state) => state.editorContextMenu);

// Actions hooks — 使用 useStore.getState() 获取稳定的 action 引用，避免每次渲染创建新对象
export const useEditorActions = () => {
  const store = useEditorStore;
  return {
    setOpenFilesByPath: store.getState().setOpenFilesByPath,
    setEditorGroups: store.getState().setEditorGroups,
    setActiveGroupId: store.getState().setActiveGroupId,
    setHoveredTabId: store.getState().setHoveredTabId,
    setSplitDirection: store.getState().setSplitDirection,
    setSplitRatioRow: store.getState().setSplitRatioRow,
    setSplitRatioColumn: store.getState().setSplitRatioColumn,
    setIsEditorSplitResizing: store.getState().setIsEditorSplitResizing,
    setModalOpen: store.getState().setModalOpen,
    setTabToClose: store.getState().setTabToClose,
    setEditorContextMenu: store.getState().setEditorContextMenu,
  };
};
