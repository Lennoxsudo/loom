import { isTauri } from '@tauri-apps/api/core';
import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { mcpClient } from '../utils/mcpClient';
import type { ToolDefinition } from '../types/ai';

interface ToolState {
  mcpTools: ToolDefinition[];
  isFetchingMcpTools: boolean;
  fetchMcpTools: () => Promise<void>;
  clearMcpTools: () => void;
}

export const useToolStore = create<ToolState>()(
  devtools(
    (set) => ({
      mcpTools: [],
      isFetchingMcpTools: false,

      fetchMcpTools: async () => {
        set({ isFetchingMcpTools: true });
        try {
          const mcpDefs = await mcpClient.getToolDefinitions();
          const tools: ToolDefinition[] = mcpDefs.map((def) => ({
            name: def.function.name,
            description: def.function.description,
            parameters: def.function.parameters as ToolDefinition['parameters'],
          }));
          set({ mcpTools: tools, isFetchingMcpTools: false });
        } catch (error) {
          console.error('[ToolStore] Failed to fetch MCP tools:', error);
          set({ mcpTools: [], isFetchingMcpTools: false });
        }
      },

      clearMcpTools: () => set({ mcpTools: [] }),
    }),
    { name: 'ToolStore' }
  )
);

let mcpListenerRegistered = false;
function registerMcpToolRefresh() {
  if (mcpListenerRegistered) return;
  if (!isTauri()) return;
  mcpListenerRegistered = true;
  mcpClient.onToolsInvalidated(() => {
    void useToolStore.getState().fetchMcpTools();
  });
  void useToolStore.getState().fetchMcpTools();
}

registerMcpToolRefresh();
