/**
 * Layout Store
 *
 * 使用 Zustand 管理布局相关状态，避免 Context 导致的不必要重渲染
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

type SidebarView = 'explorer' | 'search' | 'git';

interface LayoutState {
  sidebarWidth: number;
  isResizing: boolean;
  isChatPanelOpen: boolean;
  chatPanelWidth: number;
  isChatPanelResizing: boolean;
  isTerminalOpen: boolean;
  terminalHeight: number;
  isTerminalResizing: boolean;
  hasTerminals: boolean;
  activeSidebarView: SidebarView;
}

interface LayoutActions {
  setSidebarWidth: (width: number | ((prev: number) => number)) => void;
  setIsResizing: (resizing: boolean) => void;
  setIsChatPanelOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
  setChatPanelWidth: (width: number | ((prev: number) => number)) => void;
  setIsChatPanelResizing: (resizing: boolean) => void;
  setIsTerminalOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
  setTerminalHeight: (height: number | ((prev: number) => number)) => void;
  setIsTerminalResizing: (resizing: boolean) => void;
  setHasTerminals: (has: boolean) => void;
  setActiveSidebarView: (view: SidebarView) => void;
  resetLayout: () => void;
}

const initialState: LayoutState = {
  sidebarWidth: 250,
  isResizing: false,
  isChatPanelOpen: false,
  chatPanelWidth: 430,
  isChatPanelResizing: false,
  isTerminalOpen: false,
  terminalHeight: 240,
  isTerminalResizing: false,
  hasTerminals: false,
  activeSidebarView: 'explorer',
};

export const useLayoutStore = create<LayoutState & LayoutActions>()(
  devtools(
    (set) => ({
      ...initialState,

      setSidebarWidth: (width) =>
        set((state) => ({
          sidebarWidth: typeof width === 'function' ? width(state.sidebarWidth) : width,
        })),

      setIsResizing: (resizing) => set({ isResizing: resizing }),

      setIsChatPanelOpen: (open) =>
        set((state) => ({
          isChatPanelOpen: typeof open === 'function' ? open(state.isChatPanelOpen) : open,
        })),

      setChatPanelWidth: (width) =>
        set((state) => ({
          chatPanelWidth: typeof width === 'function' ? width(state.chatPanelWidth) : width,
        })),

      setIsChatPanelResizing: (resizing) => set({ isChatPanelResizing: resizing }),

      setIsTerminalOpen: (open) =>
        set((state) => ({
          isTerminalOpen: typeof open === 'function' ? open(state.isTerminalOpen) : open,
        })),

      setTerminalHeight: (height) =>
        set((state) => ({
          terminalHeight: typeof height === 'function' ? height(state.terminalHeight) : height,
        })),

      setIsTerminalResizing: (resizing) => set({ isTerminalResizing: resizing }),

      setHasTerminals: (has) => set({ hasTerminals: has }),

      setActiveSidebarView: (view) => set({ activeSidebarView: view }),

      resetLayout: () => set(initialState),
    }),
    {
      name: 'LayoutStore',
    }
  )
);

// 选择器 hooks，用于细粒度订阅，避免不必要的重渲染
export const useSidebarWidth = () => useLayoutStore((state) => state.sidebarWidth);
export const useIsResizing = () => useLayoutStore((state) => state.isResizing);
export const useIsChatPanelOpen = () => useLayoutStore((state) => state.isChatPanelOpen);
export const useChatPanelWidth = () => useLayoutStore((state) => state.chatPanelWidth);
export const useIsChatPanelResizing = () => useLayoutStore((state) => state.isChatPanelResizing);
export const useIsTerminalOpen = () => useLayoutStore((state) => state.isTerminalOpen);
export const useTerminalHeight = () => useLayoutStore((state) => state.terminalHeight);
export const useIsTerminalResizing = () => useLayoutStore((state) => state.isTerminalResizing);
export const useHasTerminals = () => useLayoutStore((state) => state.hasTerminals);
export const useActiveSidebarView = () => useLayoutStore((state) => state.activeSidebarView);

// Actions hook — 使用 getState() 获取稳定引用，避免每次渲染创建新对象
export const useLayoutActions = () => {
  const store = useLayoutStore;
  return {
    setSidebarWidth: store.getState().setSidebarWidth,
    setIsResizing: store.getState().setIsResizing,
    setIsChatPanelOpen: store.getState().setIsChatPanelOpen,
    setChatPanelWidth: store.getState().setChatPanelWidth,
    setIsChatPanelResizing: store.getState().setIsChatPanelResizing,
    setIsTerminalOpen: store.getState().setIsTerminalOpen,
    setTerminalHeight: store.getState().setTerminalHeight,
    setIsTerminalResizing: store.getState().setIsTerminalResizing,
    setHasTerminals: store.getState().setHasTerminals,
    setActiveSidebarView: store.getState().setActiveSidebarView,
  };
};
