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
/** Dispatched from clearSkillsCache so Chat/Agent panels can refresh / menus. */
export const SKILLS_CHANGED_EVENT = 'loom:skills-changed';

let _cache: CacheEntry | null = null;
let _lastProjectPath = '';
let _appDataPath: string | null = null;

/** Normalize a model/user skill query before lookup. */
export function normalizeSkillQuery(name: string): string {
  let q = name.trim();
  if (q.startsWith('/')) q = q.slice(1).trim();
  if (q.toLowerCase().endsWith('.md')) q = q.slice(0, -3).trim();
  return q;
}

function normalizeSkillKey(name: string): string {
  return name.toLowerCase().replace(/[-_]+/g, '-');
}

/**
 * Resolve a query to a unique skill directory name.
 * Order: exact → case-insensitive unique → -/_ normalized unique → unique prefix.
 * Ambiguous matches return null (caller should list candidates).
 */
export function resolveSkillName(
  query: string,
  skills: ReadonlyArray<Pick<SkillEntry, 'name'>>
): string | null {
  const q = normalizeSkillQuery(query);
  if (!q || skills.length === 0) return null;

  const exact = skills.find((s) => s.name === q);
  if (exact) return exact.name;

  const lower = q.toLowerCase();
  const caseHits = skills.filter((s) => s.name.toLowerCase() === lower);
  if (caseHits.length === 1) return caseHits[0].name;
  if (caseHits.length > 1) return null;

  const key = normalizeSkillKey(q);
  const keyHits = skills.filter((s) => normalizeSkillKey(s.name) === key);
  if (keyHits.length === 1) return keyHits[0].name;
  if (keyHits.length > 1) return null;

  const prefixHits = skills.filter((s) => s.name.toLowerCase().startsWith(lower));
  if (prefixHits.length === 1) return prefixHits[0].name;

  return null;
}

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
    const nodes = await invoke<Array<{ name: string; is_dir: boolean }>>('read_folder_children', {
      folderPath: dirPath,
    });
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
  return firstLine
    .replace(/^#+\s*/, '')
    .trim()
    .slice(0, 120);
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

  const items = skills.map((s) => `"${s.name}": ${s.description || '(无描述)'}`);

  return [
    '<available_skills>',
    ...items,
    '</available_skills>',
    '当用户请求与某个 skill 的描述匹配，或用户消息以 /skill-name 技能链接形式出现时，调用 skill（或 load_skill）工具，并将 skill_name 设为 <available_skills> 中的精确 name；不要臆造名称，也不要假设 skill 正文已在用户消息中。',
  ].join('\n');
}

/** Ensure merged skills cache is warm for projectPath; refresh when stale or path changed. */
async function ensureSkillsCache(projectPath: string): Promise<SkillEntry[]> {
  const now = Date.now();
  if (_cache && _lastProjectPath === projectPath && now - _cache.timestamp < CACHE_TTL_MS) {
    return _cache.skills;
  }

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
  return merged;
}

/**
 * 加载并合并全局 + 项目 skills，返回索引格式的上下文字符串。
 * 带 30s 内存缓存，projectPath 变化时自动失效。
 *
 * 返回值仅包含 skill 的 name + description，不再包含完整内容。
 */
export async function loadSkillsContext(projectPath: string): Promise<string> {
  try {
    const skills = await ensureSkillsCache(projectPath);
    return formatSkillsIndex(skills);
  } catch (e) {
    console.warn('[Skills] 加载失败:', e);
    return '';
  }
}

/** 手动清除缓存；通知 Chat/Agent 刷新 / 补全列表 */
export function clearSkillsCache(): void {
  _cache = null;
  _lastProjectPath = '';
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new Event(SKILLS_CHANGED_EVENT));
  }
}

export type LoadSkillContentResult = {
  content: string;
  scope: 'global' | 'project';
  userInvocable: boolean;
  argumentHint: string;
  description: string;
  /** Actual directory name after fuzzy resolve */
  resolvedName: string;
};

/**
 * 按 skill 名称加载完整内容（支持大小写 / -_ / 唯一前缀解析）。
 *
 * 用于 `skill` / `load_skill` 工具与 /skill 链接解析。
 */
export async function loadSkillContent(
  skillName: string,
  projectPath: string
): Promise<LoadSkillContentResult | null> {
  try {
    const skills = await ensureSkillsCache(projectPath);
    const resolved = resolveSkillName(skillName, skills);
    if (!resolved) return null;

    const cached = skills.find((s) => s.name === resolved);
    if (!cached) return null;

    return {
      content: cached.content,
      scope: cached.scope,
      userInvocable: cached.userInvocable,
      argumentHint: cached.argumentHint,
      description: cached.description,
      resolvedName: cached.name,
    };
  } catch {
    return null;
  }
}

/** Names currently known for the project (for tool error hints). */
export async function listSkillNames(projectPath: string): Promise<string[]> {
  try {
    const skills = await ensureSkillsCache(projectPath);
    return skills.map((s) => s.name);
  } catch {
    return [];
  }
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
  const baseDir =
    scope === 'global' ? await getGlobalSkillsDir() : getProjectSkillsDir(projectPath);

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
  const baseDir =
    scope === 'global' ? await getGlobalSkillsDir() : getProjectSkillsDir(projectPath);

  if (!baseDir) throw new Error('无法确定 skills 目录');

  await invoke('delete_file_or_folder', {
    path: joinPath(baseDir, name),
    permanent: true,
    rootPath: null,
  });
  clearSkillsCache();
}
