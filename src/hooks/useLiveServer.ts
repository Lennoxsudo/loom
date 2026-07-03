/**
 * Live Server 状态管理 Hook
 */

import { useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import { normalizePathForCompare, isPathUnderRoot, toRelativeUrlPath } from '../utils/pathUtils';

interface LiveServerStatus {
  running: boolean;
  port: number | null;
  root: string | null;
}

export interface UseLiveServerReturn {
  liveServerStatus: LiveServerStatus;
  setLiveServerStatus: React.Dispatch<React.SetStateAction<LiveServerStatus>>;
  getLiveServerStatus: () => Promise<LiveServerStatus>;
  ensureLiveServerStarted: (projectPath: string) => Promise<number>;
  openWithLiveServer: (filePath: string, projectPath: string) => Promise<void>;
  openInBrowserViaLiveServer: (filePath: string, projectPath: string) => Promise<void>;
  stopLiveServer: () => Promise<void>;
}

export function useLiveServer(): UseLiveServerReturn {
  const [liveServerStatus, setLiveServerStatus] = useState<LiveServerStatus>({
    running: false,
    port: null,
    root: null,
  });

  /**
   * 获取 Live Server 状态
   */
  const getLiveServerStatus = useCallback(async (): Promise<LiveServerStatus> => {
    const res = await invoke<{ running?: boolean; port?: number; root?: string }>('get_live_server_status');
    const out: LiveServerStatus = {
      running: !!res?.running,
      port: typeof res?.port === 'number' ? res.port : null,
      root: typeof res?.root === 'string' ? res.root : null,
    };
    setLiveServerStatus(out);
    return out;
  }, []);

  /**
   * 确保 Live Server 已启动
   */
  const ensureLiveServerStarted = useCallback(
    async (projectPath: string): Promise<number> => {
      if (!projectPath) throw new Error('请先打开一个文件夹');

      const startRes = await invoke<{ running?: boolean; port?: number; root?: string }>('start_live_server', { root: projectPath });
      const startPort = typeof startRes?.port === 'number' ? startRes.port : null;
      setLiveServerStatus({
        running: !!startRes?.running,
        port: startPort,
        root: typeof startRes?.root === 'string' ? startRes.root : projectPath,
      });
      if (startPort) return startPort;

      const start = Date.now();
      while (Date.now() - start < 2000) {
        const s = await getLiveServerStatus();
        if (s.running && s.port) return s.port;
        await new Promise((r) => setTimeout(r, 80));
      }

      throw new Error('Live Server 启动超时');
    },
    [getLiveServerStatus]
  );

  /**
   * 使用 Live Server 打开文件
   */
  const openWithLiveServer = useCallback(
    async (filePath: string, projectPath: string) => {
      if (!projectPath) throw new Error('请先打开一个文件夹');
      if (!isPathUnderRoot(filePath, projectPath)) throw new Error('文件不在当前项目目录内');

      const rel = toRelativeUrlPath(filePath, projectPath);
      if (!rel) throw new Error('无法计算相对路径');

      const port = await ensureLiveServerStarted(projectPath);
      const url = `http://127.0.0.1:${port}/${rel}`;
      await openUrl(url);
    },
    [ensureLiveServerStarted]
  );

  /**
   * 在浏览器中通过 Live Server 打开
   */
  const openInBrowserViaLiveServer = useCallback(
    async (filePath: string, projectPath: string) => {
      if (!projectPath) throw new Error('请先打开一个文件夹');
      if (!isPathUnderRoot(filePath, projectPath)) throw new Error('文件不在当前项目目录内');

      const rel = toRelativeUrlPath(filePath, projectPath);
      if (!rel) throw new Error('无法计算相对路径');

      const s = await getLiveServerStatus();
      if (!s.running || !s.port) throw new Error('Live Server 未启动');

      // 如果 Live Server root 与当前 projectPath 不同，避免误开
      if (s.root && normalizePathForCompare(s.root) !== normalizePathForCompare(projectPath)) {
        throw new Error('Live Server 运行目录与当前项目不一致');
      }

      const url = `http://127.0.0.1:${s.port}/${rel}`;
      await openUrl(url);
    },
    [getLiveServerStatus]
  );

  /**
   * 停止 Live Server
   */
  const stopLiveServer = useCallback(async () => {
    await invoke('stop_live_server');
    setLiveServerStatus({ running: false, port: null, root: null });
  }, []);

  return {
    liveServerStatus,
    setLiveServerStatus,
    getLiveServerStatus,
    ensureLiveServerStarted,
    openWithLiveServer,
    openInBrowserViaLiveServer,
    stopLiveServer,
  };
}
