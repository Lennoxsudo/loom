/**
 * Rules 配置持久化工具
 *
 * 负责 Rules 配置（Chat Rules + Templates）的文件系统读写。
 * 存储路径：{appDataDir}/rules.json
 */

import { invoke } from '@tauri-apps/api/core';
import type { RulesConfig } from '../types/rules';
import {
  GRAPH_RULES_TEMPLATE_CONTENT,
  GRAPH_RULES_TEMPLATE_ID,
  GRAPH_RULES_TEMPLATE_NAME,
} from '../config/graphRulesTemplate';

const RULES_FILE_NAME = 'rules.json';

/** 空默认配置 */
const DEFAULT_RULES_CONFIG: RulesConfig = {
  chatRules: [],
  rulesTemplates: [],
};

function ensureGraphRulesTemplate(config: RulesConfig): RulesConfig {
  const hasTemplate = config.rulesTemplates.some((item) => item.id === GRAPH_RULES_TEMPLATE_ID);
  if (hasTemplate) {
    return config;
  }

  const now = new Date().toISOString();
  return {
    ...config,
    rulesTemplates: [
      ...config.rulesTemplates,
      {
        id: GRAPH_RULES_TEMPLATE_ID,
        name: GRAPH_RULES_TEMPLATE_NAME,
        content: GRAPH_RULES_TEMPLATE_CONTENT,
        createdAt: now,
        updatedAt: now,
      },
    ],
  };
}

let _appDataPath: string | null = null;

async function getAppDataPath(): Promise<string> {
  if (_appDataPath) return _appDataPath;
  _appDataPath = await invoke<string>('get_app_data_path');
  return _appDataPath;
}

function joinPath(base: string, file: string): string {
  const sep = base.includes('\\') ? '\\' : '/';
  return `${base.replace(/[\\/]+$/, '')}${sep}${file}`;
}

/**
 * 从文件系统加载 Rules 配置。
 * 加载失败（文件不存在或 JSON 解析错误）时返回空默认配置并记录警告。
 */
export async function loadRulesConfig(): Promise<RulesConfig> {
  try {
    const appDataPath = await getAppDataPath();
    const filePath = joinPath(appDataPath, RULES_FILE_NAME);
    const content = await invoke<string>('read_file_content', { filePath });
    const parsed = JSON.parse(content) as RulesConfig;
    const base: RulesConfig = {
      chatRules: Array.isArray(parsed.chatRules) ? parsed.chatRules : [],
      rulesTemplates: Array.isArray(parsed.rulesTemplates) ? parsed.rulesTemplates : [],
    };
    const config = ensureGraphRulesTemplate(base);
    if (config.rulesTemplates.length !== base.rulesTemplates.length) {
      await saveRulesConfig(config);
    }
    return config;
  } catch (e) {
    console.warn('[Rules] 加载配置失败，使用默认配置:', e);
    const config = ensureGraphRulesTemplate({ ...DEFAULT_RULES_CONFIG });
    try {
      await saveRulesConfig(config);
    } catch {
      // ignore first-save errors
    }
    return config;
  }
}

/**
 * 将 Rules 配置保存到文件系统。
 */
export async function saveRulesConfig(config: RulesConfig): Promise<void> {
  const appDataPath = await getAppDataPath();
  const filePath = joinPath(appDataPath, RULES_FILE_NAME);
  const content = JSON.stringify(config, null, 2);
  await invoke('write_file_content', { filePath, content });
}
