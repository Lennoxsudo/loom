/**
 * useLayoutResize Hook
 * 
 * 处理布局 resize 相关的鼠标事件
 * 使用 requestAnimationFrame 节流，确保每帧最多更新一次
 */

import { useEffect, useRef, useCallback } from 'react';
import { useLayoutStore } from '../stores/useLayoutStore';

const ACTIVITY_BAR_WIDTH = 48;

export function useLayoutResize(editorAreaRef: React.RefObject<HTMLDivElement | null>) {
  const isResizing = useLayoutStore((state) => state.isResizing);
  const isChatPanelResizing = useLayoutStore((state) => state.isChatPanelResizing);
  const isTerminalResizing = useLayoutStore((state) => state.isTerminalResizing);
  
  const setSidebarWidth = useLayoutStore((state) => state.setSidebarWidth);
  const setIsResizing = useLayoutStore((state) => state.setIsResizing);
  const setChatPanelWidth = useLayoutStore((state) => state.setChatPanelWidth);
  const setIsChatPanelResizing = useLayoutStore((state) => state.setIsChatPanelResizing);
  const setTerminalHeight = useLayoutStore((state) => state.setTerminalHeight);
  const setIsTerminalResizing = useLayoutStore((state) => state.setIsTerminalResizing);

  // 使用 ref 存储最新的 editorAreaRef.current
  const editorAreaRefCurrent = useRef<HTMLDivElement | null>(null);
  editorAreaRefCurrent.current = editorAreaRef.current;

  // RAF 节流相关的 ref
  const rafIdRef = useRef<number | null>(null);
  const pendingValueRef = useRef<number | null>(null);

  // 通用的 RAF 节流更新函数
  const scheduleUpdate = useCallback((updateFn: (value: number) => void) => {
    return (value: number) => {
      pendingValueRef.current = value;
      
      if (rafIdRef.current === null) {
        rafIdRef.current = requestAnimationFrame(() => {
          if (pendingValueRef.current !== null) {
            updateFn(pendingValueRef.current);
            pendingValueRef.current = null;
          }
          rafIdRef.current = null;
        });
      }
    };
  }, []);

  // 清理 RAF
  useEffect(() => {
    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
      }
    };
  }, []);

  // 侧边栏 resize
  const handleSidebarResizeStart = useCallback(() => {
    setIsResizing(true);
  }, [setIsResizing]);

  useEffect(() => {
    if (!isResizing) return;

    const throttledSetWidth = scheduleUpdate(setSidebarWidth);

    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = Math.max(150, Math.min(e.clientX - ACTIVITY_BAR_WIDTH, 600));
      throttledSetWidth(newWidth);
    };

    const handleMouseUp = () => {
      // 确保最后一次更新被应用
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      if (pendingValueRef.current !== null) {
        setSidebarWidth(pendingValueRef.current);
        pendingValueRef.current = null;
      }
      setIsResizing(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    // 添加拖拽时的全局样式
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing, setSidebarWidth, setIsResizing, scheduleUpdate]);

  // 聊天面板 resize
  const handleChatPanelResizeStart = useCallback(() => {
    setIsChatPanelResizing(true);
  }, [setIsChatPanelResizing]);

  useEffect(() => {
    if (!isChatPanelResizing) return;

    const throttledSetWidth = scheduleUpdate(setChatPanelWidth);

    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = Math.max(250, Math.min(window.innerWidth - e.clientX, 600));
      throttledSetWidth(newWidth);
    };

    const handleMouseUp = () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      if (pendingValueRef.current !== null) {
        setChatPanelWidth(pendingValueRef.current);
        pendingValueRef.current = null;
      }
      setIsChatPanelResizing(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isChatPanelResizing, setChatPanelWidth, setIsChatPanelResizing, scheduleUpdate]);

  // 终端 resize
  const handleTerminalResizeStart = useCallback(() => {
    setIsTerminalResizing(true);
  }, [setIsTerminalResizing]);

  useEffect(() => {
    if (!isTerminalResizing) return;

    const throttledSetHeight = scheduleUpdate(setTerminalHeight);

    const handleMouseMove = (e: MouseEvent) => {
      const rect = editorAreaRefCurrent.current?.getBoundingClientRect();
      if (!rect) return;

      const nextHeight = Math.max(
        140,
        Math.min(rect.height - (e.clientY - rect.top), rect.height - 180)
      );
      throttledSetHeight(nextHeight);
    };

    const handleMouseUp = () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      if (pendingValueRef.current !== null) {
        setTerminalHeight(pendingValueRef.current);
        pendingValueRef.current = null;
      }
      setIsTerminalResizing(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isTerminalResizing, setTerminalHeight, setIsTerminalResizing, scheduleUpdate]);

  return {
    handleSidebarResizeStart,
    handleChatPanelResizeStart,
    handleTerminalResizeStart,
  };
}