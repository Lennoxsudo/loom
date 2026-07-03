import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type { RuleItem } from '../types/rules';
import { loadRulesConfig, saveRulesConfig } from '../utils/rulesPersistence';

interface RulesState {
  chatRules: RuleItem[];
  rulesTemplates: RuleItem[];
  loaded: boolean;

  loadRules: () => Promise<void>;
  addChatRule: (name: string, content: string) => Promise<void>;
  updateChatRule: (id: string, name: string, content: string) => Promise<void>;
  deleteChatRule: (id: string) => Promise<void>;
  addTemplate: (name: string, content: string) => Promise<void>;
  updateTemplate: (id: string, name: string, content: string) => Promise<void>;
  deleteTemplate: (id: string) => Promise<void>;
}

function validateInput(name: string, content: string): void {
  if (!name.trim() || !content.trim()) {
    throw new Error('Name and content must not be empty');
  }
}

function createRuleItem(name: string, content: string): RuleItem {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    name,
    content,
    createdAt: now,
    updatedAt: now,
  };
}

export const useRulesStore = create<RulesState>()(
  devtools(
    (set, get) => ({
      chatRules: [],
      rulesTemplates: [],
      loaded: false,

      loadRules: async () => {
        const config = await loadRulesConfig();
        set({
          chatRules: config.chatRules,
          rulesTemplates: config.rulesTemplates,
          loaded: true,
        });
      },

      addChatRule: async (name: string, content: string) => {
        validateInput(name, content);
        const rule = createRuleItem(name, content);
        const chatRules = [...get().chatRules, rule];
        set({ chatRules });
        await saveRulesConfig({ chatRules, rulesTemplates: get().rulesTemplates });
      },

      updateChatRule: async (id: string, name: string, content: string) => {
        validateInput(name, content);
        const now = new Date().toISOString();
        const chatRules = get().chatRules.map((r) =>
          r.id === id ? { ...r, name, content, updatedAt: now } : r
        );
        set({ chatRules });
        await saveRulesConfig({ chatRules, rulesTemplates: get().rulesTemplates });
      },

      deleteChatRule: async (id: string) => {
        const chatRules = get().chatRules.filter((r) => r.id !== id);
        set({ chatRules });
        await saveRulesConfig({ chatRules, rulesTemplates: get().rulesTemplates });
      },

      addTemplate: async (name: string, content: string) => {
        validateInput(name, content);
        const template = createRuleItem(name, content);
        const rulesTemplates = [...get().rulesTemplates, template];
        set({ rulesTemplates });
        await saveRulesConfig({ chatRules: get().chatRules, rulesTemplates });
      },

      updateTemplate: async (id: string, name: string, content: string) => {
        validateInput(name, content);
        const now = new Date().toISOString();
        const rulesTemplates = get().rulesTemplates.map((r) =>
          r.id === id ? { ...r, name, content, updatedAt: now } : r
        );
        set({ rulesTemplates });
        await saveRulesConfig({ chatRules: get().chatRules, rulesTemplates });
      },

      deleteTemplate: async (id: string) => {
        const rulesTemplates = get().rulesTemplates.filter((r) => r.id !== id);
        set({ rulesTemplates });
        await saveRulesConfig({ chatRules: get().chatRules, rulesTemplates });
      },
    }),
    { name: 'RulesStore' }
  )
);

// 细粒度选择器 hooks，避免全量订阅导致不必要的重渲染
export const useChatRules = () => useRulesStore((state) => state.chatRules);
export const useRulesTemplates = () => useRulesStore((state) => state.rulesTemplates);
export const useRulesLoaded = () => useRulesStore((state) => state.loaded);
export const useLoadRules = () => useRulesStore((state) => state.loadRules);
export const useAddChatRule = () => useRulesStore((state) => state.addChatRule);
export const useUpdateChatRule = () => useRulesStore((state) => state.updateChatRule);
export const useDeleteChatRule = () => useRulesStore((state) => state.deleteChatRule);
export const useAddTemplate = () => useRulesStore((state) => state.addTemplate);
export const useUpdateTemplate = () => useRulesStore((state) => state.updateTemplate);
export const useDeleteTemplate = () => useRulesStore((state) => state.deleteTemplate);
