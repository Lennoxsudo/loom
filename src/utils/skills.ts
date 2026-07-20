/**
 * Skills 上下文加载器 + CRUD
 *
 * 采用类似 Claude Code CLI 的目录结构：
 * - 全局 skills：{appDataDir}/skills/<skill-name>/SKILL.md
 * - 项目 skills：{projectPath}/.skills/<skill-name>/SKILL.md
 *
 * 每个 skill 是一个子目录，目录名即 skill 名称，
 * 目录内 SKILL.md 为必需的定义文件，可包含其他辅助文件。
 * 项目级同名 skill 覆盖全局级。结果带内存缓存 + TTL。
 *
 * ## 懒加载机制（Lazy Loading）
 *
 * 会话初始化时只注入所有 skill 的 name + description 索引到 system prompt，
 * 完整内容通过 `load_skill` AI 工具按需加载，避免上下文占用过多 token。
 *
 * SKILL.md 支持 YAML frontmatter，格式：
 * ```
 * ---
 * description: 简短描述（一行，说明此 skill 的用途）
 * argument-hint: "[summary]"
 * user-invocable: true
 * ---
 * 完整 skill 内容...（可用 $ARGUMENTS 占位）
 * ```
 *
 * 如果未提供 frontmatter，description 默认取内容首行（去除 # 前缀）。
 * user-invocable 默认 true；为 false 时不出现在 / 补全，仍可通过 load_skill 加载。
 */

import { invoke } from '@tauri-apps/api/core';

export interface SkillEntry {
  name: string;
  /** 从 frontmatter 解析的简短描述，用于索引注入 */
  description: string;
  /** SKILL.md 的完整内容（不含 frontmatter） */
  content: string;
  scope: 'global' | 'project';
  /** 是否可在 Composer 通过 /name 调用；默认 true */
  userInvocable: boolean;
  /** / 补全菜单参数提示，如 [summary] */
  argumentHint: string;
}

interface CacheEntry {
  skills: SkillEntry[];
  timestamp: number;
}

const CACHE_TTL_MS = 30_000;
const SKILL_FILE_NAME = 'SKILL.md';
const SKILLS_DIR_NAME = 'skills';
const PROJECT_SKILLS_DIR_NAME = '.skills';

let _cache: CacheEntry | null = null;
let _lastProjectPath = '';
let _appDataPath: string | null = null;

async function getAppDataPath(): Promise<string> {
  if (_appDataPath) return _appDataPath;
  try {
    const path = await invoke<string>('get_app_data_path');
    // Mocks may return `{}` / null — only accept real strings.
    _appDataPath = typeof path === 'string' && path.length > 0 ? path : '';
  } catch {
    _appDataPath = '';
  }
  return _appDataPath ?? '';
}

function joinPath(base: string, ...parts: string[]): string {
  const baseStr = typeof base === 'string' ? base : '';
  if (!baseStr) {
    return parts.filter(Boolean).join('/');
  }
  const sep = baseStr.includes('\\') ? '\\' : '/';
  return [baseStr.replace(/[\\/]+$/, ''), ...parts].join(sep);
}

/** 列出目录下的子目录名 */
async function listSubDirs(dirPath: string): Promise<string[]> {
  try {
    const nodes = await invoke<Array<{ name: string; is_dir: boolean }>>(
      'read_folder_children',
      { folderPath: dirPath }
    );
    return nodes.filter((n) => n.is_dir).map((n) => n.name);
  } catch {
    return [];
  }
}

async function readFileContent(filePath: string): Promise<string | null> {
  try {
    return await invoke<string>('read_file_content', { filePath });
  } catch {
    return null;
  }
}

// ── Frontmatter 解析 ────────────────────────────────────────────

export interface SkillFrontmatter {
  description: string;
  body: string;
  userInvocable: boolean;
  argumentHint: string;
}

function parseYamlScalar(value: string): string {
  return value.trim().replace(/^['"]|['"]$/g, '');
}

function parseYamlBool(value: string, defaultValue: boolean): boolean {
  const normalized = parseYamlScalar(value).toLowerCase();
  if (normalized === 'true' || normalized === 'yes' || normalized === '1') return true;
  if (normalized === 'false' || normalized === 'no' || normalized === '0') return false;
  return defaultValue;
}

/**
 * 解析 SKILL.md 的 YAML frontmatter。
 *
 * 支持字段：description、user-invocable、argument-hint。
 * body 是去掉 frontmatter 后的正文。
 * 如果没有 frontmatter，description 默认取正文首行（去除 # 前缀和空白）。
 */
export function parseFrontmatter(raw: string): SkillFrontmatter {
  const match = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);

  if (match) {
    const yaml = match[1];
    const body = raw.slice(match[0].length).trim();

    let description = '';
    let userInvocable = true;
    let argumentHint = '';

    for (const line of yaml.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const colonIdx = trimmed.indexOf(':');
      if (colonIdx === -1) continue;
      const key = trimmed.slice(0, colonIdx).trim();
      const rawValue = trimmed.slice(colonIdx + 1).trim();
      if (key === 'description') {
        description = parseYamlScalar(rawValue);
      } else if (key === 'user-invocable' || key === 'userInvocable') {
        userInvocable = parseYamlBool(rawValue, true);
      } else if (key === 'argument-hint' || key === 'argumentHint') {
        argumentHint = parseYamlScalar(rawValue);
      }
    }

    if (!description) {
      description = extractFirstLineAsDescription(body);
    }

    return { description, body, userInvocable, argumentHint };
  }

  // 无 frontmatter
  const body = raw.trim();
  return {
    description: extractFirstLineAsDescription(body),
    body,
    userInvocable: true,
    argumentHint: '',
  };
}

/** 从正文首行提取描述（去除 # 前缀） */
function extractFirstLineAsDescription(body: string): string {
  const firstLine = body.split('\n')[0] || '';
  return firstLine.replace(/^#+\s*/, '').trim().slice(0, 120);
}

/**
 * 从 skills 根目录加载所有 skill。
 * 遍历子目录，读取每个子目录下的 SKILL.md，解析 frontmatter 提取 description。
 */
async function loadSkillsFromDir(
  dirPath: string,
  scope: 'global' | 'project'
): Promise<SkillEntry[]> {
  const subDirs = await listSubDirs(dirPath);
  const entries: SkillEntry[] = [];

  const results = await Promise.allSettled(
    subDirs.map(async (dirName) => {
      const skillFile = joinPath(dirPath, dirName, SKILL_FILE_NAME);
      const raw = await readFileContent(skillFile);
      if (raw && raw.trim()) {
        const { description, body, userInvocable, argumentHint } = parseFrontmatter(raw);
        return {
          name: dirName,
          description,
          content: body,
          scope,
          userInvocable,
          argumentHint,
        } as SkillEntry;
      }
      return null;
    })
  );

  for (const r of results) {
    if (r.status === 'fulfilled' && r.value) {
      entries.push(r.value);
    }
  }

  return entries;
}

function mergeSkills(globalSkills: SkillEntry[], projectSkills: SkillEntry[]): SkillEntry[] {
  const projectNames = new Set(projectSkills.map((s) => s.name));
  const filtered = globalSkills.filter((s) => !projectNames.has(s.name));
  return [...filtered, ...projectSkills];
}

/**
 * 格式化 Skills 索引上下文（仅包含 name + description）。
 *
 * 此函数生成的索引字符串注入到 system prompt 中，占用极少 token。
 * LLM 根据此索引判断是否需要调用 load_skill 工具加载完整内容。
 */
function formatSkillsIndex(skills: SkillEntry[]): string {
  if (skills.length === 0) return '';

  const items = skills.map(
    (s) => `"${s.name}": ${s.description || '(无描述)'}`
  );

  return [
    '<available_skills>',
    ...items,
    '</available_skills>',
    '当用户请求与某个 skill 的描述匹配时，调用 load_skill 工具并传入 skill_name 来加载完整指令。',
  ].join('\n');
}

/**
 * 加载并合并全局 + 项目 skills，返回索引格式的上下文字符串。
 * 带 30s 内存缓存，projectPath 变化时自动失效。
 *
 * 返回值仅包含 skill 的 name + description，不再包含完整内容。
 */
export async function loadSkillsContext(projectPath: string): Promise<string> {
  const now = Date.now();

  if (
    _cache &&
    _lastProjectPath === projectPath &&
    now - _cache.timestamp < CACHE_TTL_MS
  ) {
    return formatSkillsIndex(_cache.skills);
  }

  try {
    const appDataPath = await getAppDataPath();
    const globalDir = joinPath(appDataPath, SKILLS_DIR_NAME);
    const projectDir = projectPath ? joinPath(projectPath, PROJECT_SKILLS_DIR_NAME) : '';

    const [globalSkills, projectSkills] = await Promise.all([
      loadSkillsFromDir(globalDir, 'global'),
      projectDir ? loadSkillsFromDir(projectDir, 'project') : Promise.resolve([]),
    ]);

    const merged = mergeSkills(globalSkills, projectSkills);

    _cache = { skills: merged, timestamp: now };
    _lastProjectPath = projectPath;

    return formatSkillsIndex(merged);
  } catch (e) {
    console.warn('[Skills] 加载失败:', e);
    return '';
  }
}

/** 手动清除缓存 */
export function clearSkillsCache(): void {
  _cache = null;
  _lastProjectPath = '';
}

/**
 * 按 skill 名称加载完整内容。
 *
 * 用于 `load_skill` AI 工具的处理器：LLM 判断需要某个 skill 时，
 * 调用此函数获取该 skill 的完整 SKILL.md 正文。
 *
 * 优先查找项目级 skill，其次全局级（项目级覆盖全局级）。
 * 如果缓存中有该 skill，直接返回；否则从磁盘读取。
 *
 * @param skillName - skill 目录名称
 * @param projectPath - 当前项目路径
 * @returns skill 的完整正文内容，未找到返回 null
 */
export async function loadSkillContent(
  skillName: string,
  projectPath: string
): Promise<{
  content: string;
  scope: 'global' | 'project';
  userInvocable: boolean;
  argumentHint: string;
  description: string;
} | null> {
  // 优先从缓存查找
  const now = Date.now();
  if (_cache && _lastProjectPath === projectPath && now - _cache.timestamp < CACHE_TTL_MS) {
    const cached = _cache.skills.find((s) => s.name === skillName);
    if (cached) {
      return {
        content: cached.content,
        scope: cached.scope,
        userInvocable: cached.userInvocable,
        argumentHint: cached.argumentHint,
        description: cached.description,
      };
    }
    // 缓存中没有，说明该 skill 不存在
    return null;
  }

  // 缓存过期或不存在，尝试从磁盘直接读取
  try {
    const appDataPath = await getAppDataPath();

    // 项目级优先
    if (projectPath) {
      const projectSkillFile = joinPath(projectPath, PROJECT_SKILLS_DIR_NAME, skillName, SKILL_FILE_NAME);
      const raw = await readFileContent(projectSkillFile);
      if (raw && raw.trim()) {
        const parsed = parseFrontmatter(raw);
        return {
          content: parsed.body,
          scope: 'project',
          userInvocable: parsed.userInvocable,
          argumentHint: parsed.argumentHint,
          description: parsed.description,
        };
      }
    }

    // 全局级
    const globalSkillFile = joinPath(appDataPath, SKILLS_DIR_NAME, skillName, SKILL_FILE_NAME);
    const raw = await readFileContent(globalSkillFile);
    if (raw && raw.trim()) {
      const parsed = parseFrontmatter(raw);
      return {
        content: parsed.body,
        scope: 'global',
        userInvocable: parsed.userInvocable,
        argumentHint: parsed.argumentHint,
        description: parsed.description,
      };
    }
  } catch {
    // 读取失败
  }

  return null;
}

/** 合并全局 + 项目 skills（项目覆盖全局），用于 / 补全等 UI */
export async function listMergedSkills(projectPath: string): Promise<SkillEntry[]> {
  const { global, project } = await getSkillsList(projectPath);
  return mergeSkills(global, project).sort((a, b) => a.name.localeCompare(b.name));
}

/** 仅返回可通过 /name 调用的 skills */
export async function listUserInvocableSkills(projectPath: string): Promise<SkillEntry[]> {
  const merged = await listMergedSkills(projectPath);
  return merged.filter((s) => s.userInvocable !== false);
}

// ── CRUD 操作 ──────────────────────────────────────────────────

/** 获取全局 skills 目录路径 */
export async function getGlobalSkillsDir(): Promise<string> {
  const appDataPath = await getAppDataPath();
  return joinPath(appDataPath, SKILLS_DIR_NAME);
}

/** 启动时调用：确保全局 skills 目录存在 */
export async function ensureGlobalSkillsDir(): Promise<void> {
  try {
    const dir = await getGlobalSkillsDir();
    await invoke('create_folder', { folderPath: dir });
  } catch {
    // 目录已存在或无权限，忽略
  }
}

/** 获取项目 skills 目录路径 */
function getProjectSkillsDir(projectPath: string): string {
  return projectPath ? joinPath(projectPath, PROJECT_SKILLS_DIR_NAME) : '';
}

/** 分别加载全局和项目 skills（不合并，UI 需要分开展示） */
export async function getSkillsList(projectPath: string): Promise<{
  global: SkillEntry[];
  project: SkillEntry[];
}> {
  const appDataPath = await getAppDataPath();
  const globalDir = joinPath(appDataPath, SKILLS_DIR_NAME);
  const projectDir = projectPath ? joinPath(projectPath, PROJECT_SKILLS_DIR_NAME) : '';

  const [globalSkills, projectSkills] = await Promise.all([
    loadSkillsFromDir(globalDir, 'global'),
    projectDir ? loadSkillsFromDir(projectDir, 'project') : Promise.resolve([]),
  ]);

  return { global: globalSkills, project: projectSkills };
}

/** 保存（创建或更新）一个 skill：创建子目录 + 写入 SKILL.md */
export async function saveSkill(
  name: string,
  content: string,
  scope: 'global' | 'project',
  projectPath: string
): Promise<void> {
  // skill 名称即目录名，去掉 .md 后缀（如果用户带了的话）
  const skillName = name.endsWith('.md') ? name.slice(0, -3) : name;
  const baseDir = scope === 'global'
    ? await getGlobalSkillsDir()
    : getProjectSkillsDir(projectPath);

  if (!baseDir) throw new Error('无法确定 skills 目录');

  const skillDir = joinPath(baseDir, skillName);
  // 确保 skill 子目录存在
  await invoke('create_folder', { folderPath: skillDir });
  // 写入 SKILL.md
  await invoke('write_file_content', { filePath: joinPath(skillDir, SKILL_FILE_NAME), content });
  clearSkillsCache();
}

/** 删除一个 skill（删除整个子目录） */
export async function deleteSkill(
  name: string,
  scope: 'global' | 'project',
  projectPath: string
): Promise<void> {
  const baseDir = scope === 'global'
    ? await getGlobalSkillsDir()
    : getProjectSkillsDir(projectPath);

  if (!baseDir) throw new Error('无法确定 skills 目录');

  await invoke('delete_file_or_folder', {
    path: joinPath(baseDir, name),
    permanent: true,
    rootPath: null,
  });
  clearSkillsCache();
}
