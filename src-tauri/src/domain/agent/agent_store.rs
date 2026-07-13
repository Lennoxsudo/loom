use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::ffi::OsStr;
use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{Manager, State};
use uuid::Uuid;

const STORE_VERSION: u32 = 1;
const DEFAULT_BACKUP_KEEP_COUNT: usize = 10;
const AGENT_DATA_DIR: &str = "agent-data";
const AGENT_STATES_DIR: &str = "states";
const AGENTS_FILE_NAME: &str = "agents.json";
const AGENT_FILE_NAME: &str = "agent.json";
const APP_STATE_FILE_NAME: &str = "app-state.json";
const PROJECTS_DIR: &str = "projects";
const PROJECTS_INDEX_FILE: &str = "projects-index.json";
const MIGRATION_MARKER: &str = ".migration-single-agent-v1";
const SESSION_EXTRAS_FILE: &str = "session-extras.json";
const SESSION_EXTRAS_VERSION: u32 = 1;

/// Per-project conversation state (single-agent mode).
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProjectConversationState {
    pub selected_conversation_id: Option<String>,
    #[serde(default)]
    pub conversations: Vec<AgentConversation>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ProjectIndexEntry {
    pub key: String,
    pub path: String,
    pub updated_at: DateTime<Utc>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProjectsIndexFile {
    #[serde(default = "default_store_version")]
    pub version: u32,
    #[serde(default)]
    pub last_active_project_path: Option<String>,
    #[serde(default)]
    pub projects: Vec<ProjectIndexEntry>,
}

fn default_store_version() -> u32 {
    STORE_VERSION
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct AgentFile {
    version: u32,
    updated_at: DateTime<Utc>,
    agent: AgentRecord,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MigrateToSingleAgentResult {
    pub migrated: bool,
    pub migrated_from_agent_count: usize,
    pub project_count: usize,
    pub agent: Option<AgentRecord>,
}

pub fn normalize_project_path(path: &str) -> String {
    path.trim().replace('\\', "/").to_lowercase()
}

pub fn project_storage_key(path: &str) -> String {
    let normalized = normalize_project_path(path);
    let mut hasher = Sha256::new();
    hasher.update(normalized.as_bytes());
    format!("{:x}", hasher.finalize())
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AgentMessage {
    pub id: String,
    pub role: String,
    pub text: String,
    pub thinking: Option<String>,
    pub created_at: i64,
    pub thinking_started_at: Option<i64>,
    pub thinking_ended_at: Option<i64>,
    pub tool_calls: Option<serde_json::Value>,
    pub tool_call_id: Option<String>,
    pub tool_name: Option<String>,
    pub tool_args: Option<serde_json::Value>,
    /// Whether this tool result message represents an error
    #[serde(default)]
    pub is_error: Option<bool>,
    /// Optional visual image attachments
    #[serde(default)]
    pub attachments: Option<serde_json::Value>,
    /// Optional file attachments (content injected into AI request)
    #[serde(default)]
    pub file_attachments: Option<serde_json::Value>,
    /// Source Agent ID (for cross-agent calls)
    #[serde(default)]
    pub from_agent_id: Option<String>,
    /// Source Agent name (for cross-agent calls display)
    #[serde(default)]
    pub from_agent_name: Option<String>,
    /// Tracked tool execution progress from backend orchestration
    #[serde(default)]
    pub executed_tools: Option<serde_json::Value>,
    /// Cryptographic signature for thinking block (Anthropic extended thinking)
    #[serde(default)]
    pub thinking_signature: Option<String>,
    /// Persisted subagent card snapshots on tool result messages
    #[serde(default)]
    pub subagent_runs: Option<serde_json::Value>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AgentConversation {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub project_path: Option<String>,
    #[serde(default)]
    pub thread_settings: Option<serde_json::Value>,
    #[serde(default)]
    pub branch_name: Option<String>,
    pub messages: Vec<AgentMessage>,
    #[serde(default)]
    pub preview_history: Vec<PreviewFile>,
    #[serde(default)]
    pub current_preview_index: usize,
    pub created_at: i64,
    pub updated_at: i64,
    pub title_generated: Option<bool>,
    /// Tracks what context has been injected into this conversation
    #[serde(default)]
    pub context_injected: Option<serde_json::Value>,
    /// Change review comments for this thread
    #[serde(default)]
    pub review_comments: Option<Vec<ChangeReviewComment>>,
    /// Plan panel document — follows this thread on save/load/delete.
    /// Must be a known field so serde does not drop it when saving project state.
    #[serde(default)]
    pub plan_document: Option<serde_json::Value>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ChangeReviewComment {
    pub id: String,
    pub file_path: String,
    pub side: String,
    #[serde(default)]
    pub line_number: Option<u32>,
    pub body: String,
    pub created_at: i64,
    #[serde(default)]
    pub updated_at: Option<i64>,
    #[serde(default)]
    pub submitted_at: Option<i64>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PreviewFile {
    pub file_path: String,
    pub content: String,
    pub original_content: Option<String>,
    pub modified_content: Option<String>,
    pub language: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AgentFullState {
    pub selected_conversation_id: Option<String>,
    #[serde(default)]
    pub selected_conversation_id_by_project: Option<serde_json::Value>,
    pub conversations: Vec<AgentConversation>,
    #[serde(default)]
    pub preview_history: Vec<PreviewFile>,
    #[serde(default)]
    pub current_preview_index: usize,
}

impl AgentFullState {
    fn normalize(mut self) -> Self {
        for conversation in &mut self.conversations {
            let max_idx = conversation.preview_history.len().saturating_sub(1);
            if conversation.current_preview_index > max_idx {
                conversation.current_preview_index = max_idx;
            }
        }

        if !self.preview_history.is_empty() && !self.conversations.is_empty() {
            let target_index = self
                .selected_conversation_id
                .as_ref()
                .and_then(|selected| {
                    self.conversations
                        .iter()
                        .position(|conversation| &conversation.id == selected)
                })
                .unwrap_or(0);

            if let Some(target) = self.conversations.get_mut(target_index) {
                if target.preview_history.is_empty() {
                    target.preview_history = self.preview_history.clone();
                    let max_idx = target.preview_history.len().saturating_sub(1);
                    target.current_preview_index = self.current_preview_index.min(max_idx);
                }
            }

            self.preview_history.clear();
            self.current_preview_index = 0;
        }

        self
    }
}

#[derive(Default)]
pub struct AgentStoreState {
    lock: Mutex<()>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct AgentCapabilities {
    #[serde(default)]
    pub can_execute_commands: bool,
    #[serde(default)]
    pub can_access_browser: bool,
    #[serde(default)]
    pub can_use_git: bool,
    #[serde(default)]
    pub can_use_mcp: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AgentRecord {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub agent_type: String,
    pub icon: String,
    pub status: String,
    pub description: Option<String>,
    pub model: String,
    pub provider: Option<String>,
    #[serde(default)]
    pub profile_id: Option<String>,
    pub temperature: f32,
    pub capabilities: AgentCapabilities,
    #[serde(default)]
    pub callable: Option<bool>,
    #[serde(default)]
    pub callable_description: Option<String>,
    #[serde(default)]
    pub rules: Option<String>,
    #[serde(default)]
    pub max_context_tokens: Option<u32>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateAgentPayload {
    pub name: String,
    #[serde(rename = "type")]
    pub agent_type: String,
    pub icon: Option<String>,
    pub status: Option<String>,
    pub description: Option<String>,
    pub model: String,
    pub provider: Option<String>,
    #[serde(default)]
    pub profile_id: Option<String>,
    pub temperature: f32,
    pub capabilities: AgentCapabilities,
    #[serde(default)]
    pub callable: Option<bool>,
    #[serde(default)]
    pub callable_description: Option<String>,
    #[serde(default)]
    pub rules: Option<String>,
    #[serde(default)]
    pub max_context_tokens: Option<u32>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateAgentPatch {
    pub name: Option<String>,
    #[serde(rename = "type")]
    pub agent_type: Option<String>,
    pub icon: Option<String>,
    pub status: Option<String>,
    pub description: Option<String>,
    pub model: Option<String>,
    pub provider: Option<String>,
    pub profile_id: Option<String>,
    pub temperature: Option<f32>,
    pub capabilities: Option<AgentCapabilities>,
    pub callable: Option<bool>,
    pub callable_description: Option<String>,
    pub rules: Option<String>,
    pub max_context_tokens: Option<u32>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct AgentsFile {
    version: u32,
    updated_at: DateTime<Utc>,
    agents: Vec<AgentRecord>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
struct AppStateFile {
    version: u32,
    #[serde(rename = "last_selected_agent_id")]
    last_selected_agent_id: Option<String>,
    #[serde(rename = "updatedAt")]
    updated_at: DateTime<Utc>,
}

struct AgentStore {
    root_dir: PathBuf,
    backup_keep_count: usize,
}

impl AgentStore {
    fn from_app(app: &tauri::AppHandle) -> Result<Self, String> {
        let app_data_dir = app
            .path()
            .app_data_dir()
            .map_err(|e| format!("获取应用数据目录失败: {e}"))?;
        Ok(Self::new(
            app_data_dir.join(AGENT_DATA_DIR),
            DEFAULT_BACKUP_KEEP_COUNT,
        ))
    }

    fn new(root_dir: PathBuf, backup_keep_count: usize) -> Self {
        Self {
            root_dir,
            backup_keep_count,
        }
    }

    fn backups_dir(&self) -> PathBuf {
        self.root_dir.join("backups")
    }

    fn agents_path(&self) -> PathBuf {
        self.root_dir.join(AGENTS_FILE_NAME)
    }

    fn app_state_path(&self) -> PathBuf {
        self.root_dir.join(APP_STATE_FILE_NAME)
    }

    fn session_extras_path(&self) -> PathBuf {
        self.root_dir.join(SESSION_EXTRAS_FILE)
    }

    fn states_dir(&self) -> PathBuf {
        self.root_dir.join(AGENT_STATES_DIR)
    }

    fn agent_path(&self) -> PathBuf {
        self.root_dir.join(AGENT_FILE_NAME)
    }

    fn projects_dir(&self) -> PathBuf {
        self.root_dir.join(PROJECTS_DIR)
    }

    fn projects_index_path(&self) -> PathBuf {
        self.root_dir.join(PROJECTS_INDEX_FILE)
    }

    fn migration_marker_path(&self) -> PathBuf {
        self.root_dir.join(MIGRATION_MARKER)
    }

    fn project_state_path(&self, project_key: &str) -> PathBuf {
        self.projects_dir().join(format!("{project_key}.json"))
    }

    fn ensure_layout(&self) -> Result<(), String> {
        fs::create_dir_all(&self.root_dir).map_err(|e| format!("创建 agent-data 目录失败: {e}"))?;
        fs::create_dir_all(self.backups_dir()).map_err(|e| format!("创建 backup 目录失败: {e}"))?;
        fs::create_dir_all(self.projects_dir()).map_err(|e| format!("创建 projects 目录失败: {e}"))?;
        Ok(())
    }

    fn load_agent(&self) -> Result<Option<AgentRecord>, String> {
        self.ensure_layout()?;
        let path = self.agent_path();
        if !path.exists() {
            return Ok(None);
        }
        let raw = fs::read_to_string(&path).map_err(|e| format!("读取 agent.json 失败: {e}"))?;
        let parsed = serde_json::from_str::<AgentFile>(&raw)
            .map_err(|e| format!("解析 agent.json 失败: {e}"))?;
        Ok(Some(parsed.agent))
    }

    fn save_agent(&self, agent: &AgentRecord) -> Result<(), String> {
        self.ensure_layout()?;
        let path = self.agent_path();
        self.backup_agent_file_if_exists(&path)?;
        let payload = AgentFile {
            version: STORE_VERSION,
            updated_at: Utc::now(),
            agent: agent.clone(),
        };
        self.atomic_write_json(&path, &payload)
    }

    fn backup_agent_file_if_exists(&self, source: &Path) -> Result<(), String> {
        if !source.exists() {
            return Ok(());
        }
        let timestamp = Utc::now().format("%Y%m%d_%H%M%S_%3f");
        let backup_path = self.backups_dir().join(format!("agent-{timestamp}.json"));
        fs::copy(source, &backup_path).map_err(|e| format!("创建 agent 备份失败: {e}"))?;
        self.prune_agent_backups()?;
        Ok(())
    }

    fn prune_agent_backups(&self) -> Result<(), String> {
        let backups = self.list_agent_file_backups_desc()?;
        if backups.len() <= self.backup_keep_count {
            return Ok(());
        }
        for stale in backups.into_iter().skip(self.backup_keep_count) {
            let _ = fs::remove_file(stale);
        }
        Ok(())
    }

    fn list_agent_file_backups_desc(&self) -> Result<Vec<PathBuf>, String> {
        let mut files = Vec::new();
        if !self.backups_dir().exists() {
            return Ok(files);
        }
        for entry in
            fs::read_dir(self.backups_dir()).map_err(|e| format!("读取备份目录失败: {e}"))?
        {
            let entry = entry.map_err(|e| format!("读取备份文件项失败: {e}"))?;
            let path = entry.path();
            let file_name = path
                .file_name()
                .and_then(OsStr::to_str)
                .unwrap_or_default()
                .to_string();
            if file_name.starts_with("agent-")
                && path.extension().and_then(OsStr::to_str) == Some("json")
            {
                files.push(path);
            }
        }
        files.sort_by(|a, b| b.file_name().cmp(&a.file_name()));
        Ok(files)
    }

    fn load_project_state(&self, project_key: &str) -> Result<Option<ProjectConversationState>, String> {
        self.ensure_layout()?;
        let path = self.project_state_path(project_key);
        if !path.exists() {
            return Ok(None);
        }
        let raw = fs::read_to_string(&path).map_err(|e| format!("读取项目会话失败: {e}"))?;
        let mut parsed = serde_json::from_str::<ProjectConversationState>(&raw)
            .map_err(|e| format!("解析项目会话失败: {e}"))?;
        for conversation in &mut parsed.conversations {
            let max_idx = conversation.preview_history.len().saturating_sub(1);
            if conversation.current_preview_index > max_idx {
                conversation.current_preview_index = max_idx;
            }
        }
        Ok(Some(parsed))
    }

    fn save_project_state(
        &self,
        project_key: &str,
        state: &ProjectConversationState,
    ) -> Result<(), String> {
        self.ensure_layout()?;
        let path = self.project_state_path(project_key);
        self.atomic_write_json(&path, state)
    }

    fn load_projects_index(&self) -> Result<ProjectsIndexFile, String> {
        self.ensure_layout()?;
        let path = self.projects_index_path();
        if !path.exists() {
            return Ok(ProjectsIndexFile::default());
        }
        let raw = fs::read_to_string(&path).map_err(|e| format!("读取 projects-index 失败: {e}"))?;
        serde_json::from_str::<ProjectsIndexFile>(&raw)
            .map_err(|e| format!("解析 projects-index 失败: {e}"))
    }

    fn save_projects_index(&self, index: &ProjectsIndexFile) -> Result<(), String> {
        self.ensure_layout()?;
        self.atomic_write_json(&self.projects_index_path(), index)
    }

    fn touch_project_index(&self, project_path: &str) -> Result<ProjectsIndexFile, String> {
        let trimmed = project_path.trim();
        if trimmed.is_empty() {
            return self.load_projects_index();
        }
        let key = project_storage_key(trimmed);
        let mut index = self.load_projects_index()?;
        index.last_active_project_path = Some(trimmed.to_string());
        if let Some(entry) = index.projects.iter_mut().find(|e| e.key == key) {
            entry.path = trimmed.to_string();
            entry.updated_at = Utc::now();
        } else {
            index.projects.push(ProjectIndexEntry {
                key: key.clone(),
                path: trimmed.to_string(),
                updated_at: Utc::now(),
            });
        }
        self.save_projects_index(&index)?;
        Ok(index)
    }

    fn prune_session_extras_for_project(&self, project_key: &str) -> Result<(), String> {
        let prefix = format!("{project_key}::");
        let mut extras = self.load_session_extras()?;
        extras
            .drafts
            .retain(|key, _| !key.starts_with(&prefix));
        extras
            .pending_changes
            .retain(|key, _| !key.starts_with(&prefix));
        self.save_session_extras(&extras)
    }

    fn delete_project_state(&self, project_key: &str) -> Result<(), String> {
        self.ensure_layout()?;

        let index = self.load_projects_index()?;
        let deleted_path = index
            .projects
            .iter()
            .find(|entry| entry.key == project_key)
            .map(|entry| entry.path.clone());

        let conversation_ids: Vec<String> = match self.load_project_state(project_key) {
            Ok(Some(state)) => state
                .conversations
                .iter()
                .map(|conversation| conversation.id.clone())
                .collect(),
            Ok(None) => Vec::new(),
            Err(error) => return Err(error),
        };

        let todos_path = self.root_dir.join(TODOS_DIR);
        if todos_path.exists() {
            for conversation_id in &conversation_ids {
                let todo_path = todos_path.join(todo_file_name(conversation_id));
                if todo_path.exists() {
                    fs::remove_file(&todo_path)
                        .map_err(|e| format!("删除项目 Todo 失败: {e}"))?;
                }
            }
        }

        self.prune_session_extras_for_project(project_key)?;

        let path = self.project_state_path(project_key);
        if path.exists() {
            fs::remove_file(&path).map_err(|e| format!("删除项目会话失败: {e}"))?;
        }

        let mut index = self.load_projects_index()?;
        index.projects.retain(|entry| entry.key != project_key);
        if let Some(deleted_path) = deleted_path {
            let should_clear = index
                .last_active_project_path
                .as_deref()
                .map(|active| normalize_project_path(active) == normalize_project_path(&deleted_path))
                .unwrap_or(false);
            if should_clear {
                index.last_active_project_path = None;
            }
        }
        self.save_projects_index(&index)?;
        Ok(())
    }

    fn migrate_to_single_agent(&self) -> Result<MigrateToSingleAgentResult, String> {
        self.ensure_layout()?;
        if self.agent_path().exists() {
            let agent = self.load_agent()?;
            let index = self.load_projects_index()?;
            return Ok(MigrateToSingleAgentResult {
                migrated: false,
                migrated_from_agent_count: 0,
                project_count: index.projects.len(),
                agent,
            });
        }

        let legacy_agents = self.load_agents().unwrap_or_default();
        if legacy_agents.is_empty() && !self.agents_path().exists() {
            return Ok(MigrateToSingleAgentResult {
                migrated: false,
                migrated_from_agent_count: 0,
                project_count: 0,
                agent: None,
            });
        }

        let app_state = self.load_app_state().unwrap_or_else(|_| Self::default_app_state(None));
        let selected_id = app_state
            .last_selected_agent_id
            .or_else(|| legacy_agents.first().map(|a| a.id.clone()));

        let selected_agent = selected_id
            .as_ref()
            .and_then(|id| legacy_agents.iter().find(|a| &a.id == id).cloned())
            .or_else(|| legacy_agents.first().cloned());

        let Some(agent) = selected_agent else {
            return Ok(MigrateToSingleAgentResult {
                migrated: false,
                migrated_from_agent_count: legacy_agents.len(),
                project_count: 0,
                agent: None,
            });
        };

        let legacy_state = selected_id
            .as_ref()
            .and_then(|id| self.load_agent_full_state(id).ok().flatten())
            .unwrap_or(AgentFullState {
                selected_conversation_id: None,
                selected_conversation_id_by_project: None,
                conversations: Vec::new(),
                preview_history: Vec::new(),
                current_preview_index: 0,
            });

        let conversations = legacy_state.conversations;
        let mut by_project: HashMap<String, ProjectConversationState> = HashMap::new();
        let selection_by_project = legacy_state
            .selected_conversation_id_by_project
            .as_ref()
            .and_then(|v| v.as_object().cloned());

        for conversation in conversations {
            let path = conversation
                .project_path
                .as_deref()
                .filter(|p| !p.trim().is_empty())
                .map(|p| p.to_string())
                .unwrap_or_default();
            let key = project_storage_key(&path);
            let entry = by_project.entry(key.clone()).or_insert_with(|| {
                let selected = selection_by_project
                    .as_ref()
                    .and_then(|map| {
                        map.get(&normalize_project_path(&path))
                            .and_then(|v| v.as_str().map(|s| s.to_string()))
                    })
                    .or_else(|| {
                        if legacy_state.selected_conversation_id.as_deref() == Some(conversation.id.as_str()) {
                            Some(conversation.id.clone())
                        } else {
                            None
                        }
                    });
                ProjectConversationState {
                    selected_conversation_id: selected,
                    conversations: Vec::new(),
                }
            });
            entry.conversations.push(conversation);
        }

        if by_project.is_empty() {
            let key = project_storage_key("");
            by_project.insert(
                key,
                ProjectConversationState {
                    selected_conversation_id: legacy_state.selected_conversation_id,
                    conversations: Vec::new(),
                },
            );
        }

        let mut index = ProjectsIndexFile {
            version: STORE_VERSION,
            last_active_project_path: None,
            projects: Vec::new(),
        };

        for (key, project_state) in &by_project {
            self.save_project_state(key, project_state)?;
            let display_path = project_state
                .conversations
                .iter()
                .find_map(|c| c.project_path.as_ref().filter(|p| !p.trim().is_empty()).cloned())
                .unwrap_or_default();
            index.projects.push(ProjectIndexEntry {
                key: key.clone(),
                path: display_path,
                updated_at: Utc::now(),
            });
        }

        self.save_agent(&agent)?;
        self.save_projects_index(&index)?;
        self.rewrite_session_extras_for_single_agent(&agent.id)?;

        if self.agents_path().exists() {
            let _ = fs::remove_file(self.agents_path());
        }
        if self.app_state_path().exists() {
            let _ = fs::remove_file(self.app_state_path());
        }
        if self.states_dir().exists() {
            if let Ok(entries) = fs::read_dir(self.states_dir()) {
                for entry in entries.flatten() {
                    let _ = fs::remove_file(entry.path());
                }
            }
            let _ = fs::remove_dir(self.states_dir());
        }

        let _ = fs::write(self.migration_marker_path(), Utc::now().to_rfc3339());

        Ok(MigrateToSingleAgentResult {
            migrated: true,
            migrated_from_agent_count: legacy_agents.len(),
            project_count: by_project.len(),
            agent: Some(agent),
        })
    }

    fn rewrite_session_extras_for_single_agent(&self, old_agent_id: &str) -> Result<(), String> {
        let mut extras = self.load_session_extras()?;
        let prefix = format!("{old_agent_id}::");
        let compose_prefix = format!("{old_agent_id}::__compose__::");

        let mut new_drafts = HashMap::new();
        for (key, value) in extras.drafts.drain() {
            if let Some(rest) = key.strip_prefix(&compose_prefix) {
                let pk = project_storage_key(rest);
                new_drafts.insert(format!("{pk}::__compose__"), value);
            } else if let Some(rest) = key.strip_prefix(&prefix) {
                new_drafts.insert(rest.to_string(), value);
            } else {
                new_drafts.insert(key, value);
            }
        }
        extras.drafts = new_drafts;

        let mut new_pending = HashMap::new();
        for (key, value) in extras.pending_changes.drain() {
            if let Some(rest) = key.strip_prefix(&prefix) {
                new_pending.insert(rest.to_string(), value);
            } else {
                new_pending.insert(key, value);
            }
        }
        extras.pending_changes = new_pending;

        self.save_session_extras(&extras)
    }

    fn ensure_layout_legacy(&self) -> Result<(), String> {
        fs::create_dir_all(&self.root_dir).map_err(|e| format!("创建 agent-data 目录失败: {e}"))?;
        fs::create_dir_all(self.backups_dir()).map_err(|e| format!("创建 backup 目录失败: {e}"))?;
        fs::create_dir_all(self.states_dir()).map_err(|e| format!("创建 states 目录失败: {e}"))?;
        Ok(())
    }

    fn agent_state_path(&self, agent_id: &str) -> PathBuf {
        self.states_dir().join(format!("{}.json", agent_id))
    }

    fn load_agent_full_state(&self, agent_id: &str) -> Result<Option<AgentFullState>, String> {
        self.ensure_layout_legacy()?;
        let path = self.agent_state_path(agent_id);
        if !path.exists() {
            return Ok(None);
        }
        let raw = fs::read_to_string(&path).map_err(|e| format!("读取 Agent 状态失败: {e}"))?;
        let parsed = serde_json::from_str::<AgentFullState>(&raw)
            .map_err(|e| format!("解析 Agent 状态失败: {e}"))?;
        Ok(Some(parsed.normalize()))
    }

    fn save_agent_full_state(&self, agent_id: &str, state: &AgentFullState) -> Result<(), String> {
        self.ensure_layout_legacy()?;
        let path = self.agent_state_path(agent_id);
        let normalized = state.clone().normalize();
        self.atomic_write_json(&path, &normalized)
    }

    fn load_session_extras(&self) -> Result<AgentSessionExtrasFile, String> {
        self.ensure_layout()?;
        let path = self.session_extras_path();
        if !path.exists() {
            return Ok(AgentSessionExtrasFile::default());
        }
        let raw = fs::read_to_string(&path).map_err(|e| format!("读取 session extras 失败: {e}"))?;
        serde_json::from_str::<AgentSessionExtrasFile>(&raw)
            .map_err(|e| format!("解析 session extras 失败: {e}"))
    }

    fn save_session_extras(&self, extras: &AgentSessionExtrasFile) -> Result<(), String> {
        self.ensure_layout()?;
        let path = self.session_extras_path();
        self.atomic_write_json(&path, extras)
    }

    fn load_agents(&self) -> Result<Vec<AgentRecord>, String> {
        self.ensure_layout_legacy()?;
        let path = self.agents_path();
        if !path.exists() {
            return Ok(Vec::new());
        }

        let raw = fs::read_to_string(&path).map_err(|e| format!("读取 agents.json 失败: {e}"))?;
        match serde_json::from_str::<AgentsFile>(&raw) {
            Ok(file) => Ok(file.agents),
            Err(parse_err) => self.restore_latest_agents_backup(parse_err.to_string()),
        }
    }

    fn save_agents(&self, agents: Vec<AgentRecord>) -> Result<(), String> {
        self.ensure_layout()?;
        let path = self.agents_path();
        self.backup_agents_file_if_exists(&path)?;
        let payload = AgentsFile {
            version: STORE_VERSION,
            updated_at: Utc::now(),
            agents,
        };
        self.atomic_write_json(&path, &payload)
    }

    fn load_app_state(&self) -> Result<AppStateFile, String> {
        self.ensure_layout_legacy()?;
        let path = self.app_state_path();
        if !path.exists() {
            return Ok(Self::default_app_state(None));
        }

        let raw =
            fs::read_to_string(&path).map_err(|e| format!("读取 app-state.json 失败: {e}"))?;
        serde_json::from_str::<AppStateFile>(&raw)
            .map_err(|e| format!("解析 app-state.json 失败: {e}"))
    }

    fn save_app_state(&self, last_selected_agent_id: Option<String>) -> Result<(), String> {
        self.ensure_layout()?;
        let path = self.app_state_path();
        self.atomic_write_json(&path, &Self::default_app_state(last_selected_agent_id))
    }

    fn default_app_state(last_selected_agent_id: Option<String>) -> AppStateFile {
        AppStateFile {
            version: STORE_VERSION,
            last_selected_agent_id,
            updated_at: Utc::now(),
        }
    }

    fn restore_latest_agents_backup(
        &self,
        parse_error: String,
    ) -> Result<Vec<AgentRecord>, String> {
        let backups = self.list_agent_backups_desc()?;
        for backup_file in backups {
            let raw = match fs::read_to_string(&backup_file) {
                Ok(text) => text,
                Err(_) => continue,
            };

            let parsed = match serde_json::from_str::<AgentsFile>(&raw) {
                Ok(file) => file,
                Err(_) => continue,
            };

            self.atomic_write_string(&self.agents_path(), &raw)?;
            return Ok(parsed.agents);
        }

        Err(format!(
            "agents.json 已损坏且无可用备份，解析错误: {parse_error}"
        ))
    }

    fn backup_agents_file_if_exists(&self, source: &Path) -> Result<(), String> {
        if !source.exists() {
            return Ok(());
        }

        let timestamp = Utc::now().format("%Y%m%d_%H%M%S_%3f");
        let backup_path = self.backups_dir().join(format!("agents-{timestamp}.json"));
        fs::copy(source, &backup_path).map_err(|e| format!("创建备份失败: {e}"))?;
        self.prune_backups()?;
        Ok(())
    }

    fn prune_backups(&self) -> Result<(), String> {
        let backups = self.list_agent_backups_desc()?;
        if backups.len() <= self.backup_keep_count {
            return Ok(());
        }

        for stale in backups.into_iter().skip(self.backup_keep_count) {
            let _ = fs::remove_file(stale);
        }
        Ok(())
    }

    fn list_agent_backups_desc(&self) -> Result<Vec<PathBuf>, String> {
        let mut files = Vec::new();
        for entry in
            fs::read_dir(self.backups_dir()).map_err(|e| format!("读取备份目录失败: {e}"))?
        {
            let entry = entry.map_err(|e| format!("读取备份文件项失败: {e}"))?;
            let path = entry.path();
            let file_name = path
                .file_name()
                .and_then(OsStr::to_str)
                .unwrap_or_default()
                .to_string();
            if file_name.starts_with("agents-")
                && path.extension().and_then(OsStr::to_str) == Some("json")
            {
                files.push(path);
            }
        }

        files.sort_by(|a, b| b.file_name().cmp(&a.file_name()));
        Ok(files)
    }

    fn atomic_write_json<T: Serialize>(&self, target: &Path, value: &T) -> Result<(), String> {
        let raw = serde_json::to_string_pretty(value).map_err(|e| format!("序列化失败: {e}"))?;
        self.atomic_write_string(target, &raw)
    }

    fn atomic_write_string(&self, target: &Path, content: &str) -> Result<(), String> {
        let tmp_path = target.with_extension("tmp");
        {
            let mut file = File::create(&tmp_path).map_err(|e| format!("创建临时文件失败: {e}"))?;
            file.write_all(content.as_bytes())
                .map_err(|e| format!("写入临时文件失败: {e}"))?;
            file.flush().map_err(|e| format!("刷新临时文件失败: {e}"))?;
            file.sync_all()
                .map_err(|e| format!("同步临时文件失败: {e}"))?;
        }

        match fs::rename(&tmp_path, target) {
            Ok(_) => Ok(()),
            Err(rename_err) => {
                if target.exists() {
                    fs::remove_file(target).map_err(|e| format!("覆盖旧文件失败: {e}"))?;
                    fs::rename(&tmp_path, target)
                        .map_err(|e| format!("重命名临时文件失败: {e}"))?;
                    Ok(())
                } else {
                    Err(format!("原子写入失败: {rename_err}"))
                }
            }
        }
    }
}

fn default_icon_for_type(agent_type: &str) -> String {
    match agent_type {
        "refactor" => "RF",
        "bugfix" => "BG",
        "review" => "RV",
        "docs" => "DC",
        "test" => "TS",
        _ => "AI",
    }
    .to_string()
}

fn trim_to_option(value: Option<String>) -> Option<String> {
    value.and_then(|v| {
        let trimmed = v.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

#[tauri::command]
pub fn get_agents(
    app: tauri::AppHandle,
    state: State<'_, AgentStoreState>,
) -> Result<Vec<AgentRecord>, String> {
    let _guard = state
        .lock
        .lock()
        .map_err(|_| "agent store lock 获取失败".to_string())?;
    let store = AgentStore::from_app(&app)?;
    store.load_agents()
}

#[tauri::command]
pub fn create_agent(
    app: tauri::AppHandle,
    state: State<'_, AgentStoreState>,
    payload: CreateAgentPayload,
) -> Result<AgentRecord, String> {
    let _guard = state
        .lock
        .lock()
        .map_err(|_| "agent store lock 获取失败".to_string())?;

    let name = payload.name.trim();
    if name.is_empty() {
        return Err("Agent 名称不能为空".to_string());
    }
    let model = payload.model.trim();
    if model.is_empty() {
        return Err("模型不能为空".to_string());
    }
    let agent_type = payload.agent_type.trim().to_string();

    let store = AgentStore::from_app(&app)?;
    let mut agents = store.load_agents()?;
    let now = Utc::now();
    let agent = AgentRecord {
        id: Uuid::new_v4().to_string(),
        name: name.to_string(),
        agent_type: agent_type.clone(),
        icon: payload
            .icon
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty())
            .unwrap_or_else(|| default_icon_for_type(&agent_type)),
        status: payload
            .status
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty())
            .unwrap_or_else(|| "online".to_string()),
        description: trim_to_option(payload.description),
        model: model.to_string(),
        provider: trim_to_option(payload.provider),
        profile_id: trim_to_option(payload.profile_id),
        temperature: payload.temperature,
        capabilities: payload.capabilities,
        callable: payload.callable,
        callable_description: trim_to_option(payload.callable_description),
        rules: trim_to_option(payload.rules),
        max_context_tokens: payload.max_context_tokens,
        created_at: now,
        updated_at: now,
    };

    agents.insert(0, agent.clone());
    store.save_agents(agents)?;
    Ok(agent)
}

#[tauri::command]
pub fn update_agent(
    app: tauri::AppHandle,
    state: State<'_, AgentStoreState>,
    agent_id: String,
    patch: UpdateAgentPatch,
) -> Result<AgentRecord, String> {
    let _guard = state
        .lock
        .lock()
        .map_err(|_| "agent store lock 获取失败".to_string())?;
    let store = AgentStore::from_app(&app)?;
    let mut agents = store.load_agents()?;

    let target = agents
        .iter_mut()
        .find(|agent| agent.id == agent_id)
        .ok_or_else(|| "Agent 不存在".to_string())?;

    if let Some(name) = patch.name {
        let trimmed = name.trim();
        if trimmed.is_empty() {
            return Err("Agent 名称不能为空".to_string());
        }
        target.name = trimmed.to_string();
    }

    if let Some(agent_type) = patch.agent_type {
        let trimmed = agent_type.trim();
        if !trimmed.is_empty() {
            target.agent_type = trimmed.to_string();
        }
    }

    if let Some(icon) = patch.icon {
        let trimmed = icon.trim();
        if !trimmed.is_empty() {
            target.icon = trimmed.to_string();
        }
    }

    if let Some(status) = patch.status {
        let trimmed = status.trim();
        if !trimmed.is_empty() {
            target.status = trimmed.to_string();
        }
    }

    if patch.description.is_some() {
        target.description = trim_to_option(patch.description);
    }

    if let Some(model) = patch.model {
        let trimmed = model.trim();
        if trimmed.is_empty() {
            return Err("模型不能为空".to_string());
        }
        target.model = trimmed.to_string();
    }

    if patch.provider.is_some() {
        target.provider = trim_to_option(patch.provider);
    }

    if patch.profile_id.is_some() {
        target.profile_id = trim_to_option(patch.profile_id);
    }

    if let Some(temperature) = patch.temperature {
        target.temperature = temperature;
    }

    if let Some(capabilities) = patch.capabilities {
        target.capabilities = capabilities;
    }

    if let Some(callable) = patch.callable {
        target.callable = Some(callable);
    }

    if patch.callable_description.is_some() {
        target.callable_description = trim_to_option(patch.callable_description);
    }

    if patch.rules.is_some() {
        target.rules = trim_to_option(patch.rules);
    }

    if patch.max_context_tokens.is_some() {
        target.max_context_tokens = patch.max_context_tokens;
    }

    target.updated_at = Utc::now();
    let updated = target.clone();

    store.save_agents(agents)?;
    Ok(updated)
}

#[tauri::command]
pub fn delete_agent(
    app: tauri::AppHandle,
    state: State<'_, AgentStoreState>,
    agent_id: String,
) -> Result<(), String> {
    let _guard = state
        .lock
        .lock()
        .map_err(|_| "agent store lock 获取失败".to_string())?;
    let store = AgentStore::from_app(&app)?;
    let mut agents = store.load_agents()?;
    let before = agents.len();
    agents.retain(|agent| agent.id != agent_id);

    if agents.len() == before {
        return Err("Agent 不存在".to_string());
    }

    store.save_agents(agents)?;
    let state_file = store.load_app_state()?;
    if state_file.last_selected_agent_id.as_deref() == Some(agent_id.as_str()) {
        store.save_app_state(None)?;
    }

    let agent_state_path = store.agent_state_path(&agent_id);
    if agent_state_path.exists() {
        let _ = fs::remove_file(agent_state_path);
    }
    Ok(())
}

#[tauri::command]
pub fn get_last_selected_agent_id(
    app: tauri::AppHandle,
    state: State<'_, AgentStoreState>,
) -> Result<Option<String>, String> {
    let _guard = state
        .lock
        .lock()
        .map_err(|_| "agent store lock 获取失败".to_string())?;
    let store = AgentStore::from_app(&app)?;
    let app_state = store.load_app_state()?;
    let selected = app_state.last_selected_agent_id;

    if let Some(ref selected_id) = selected {
        let agents = store.load_agents()?;
        if !agents.iter().any(|agent| &agent.id == selected_id) {
            store.save_app_state(None)?;
            return Ok(None);
        }
    }

    Ok(selected)
}

#[tauri::command]
pub fn set_last_selected_agent_id(
    app: tauri::AppHandle,
    state: State<'_, AgentStoreState>,
    id: Option<String>,
) -> Result<(), String> {
    let _guard = state
        .lock
        .lock()
        .map_err(|_| "agent store lock 获取失败".to_string())?;
    let store = AgentStore::from_app(&app)?;

    if let Some(ref selected_id) = id {
        let agents = store.load_agents()?;
        if !agents.iter().any(|agent| &agent.id == selected_id) {
            return Err("选中的 Agent 不存在".to_string());
        }
    }

    store.save_app_state(id)?;
    Ok(())
}

#[tauri::command]
pub fn get_agent_storage_path(app: tauri::AppHandle) -> Result<String, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("获取应用数据目录失败: {e}"))?;
    let agent_data_path = app_data_dir.join(AGENT_DATA_DIR);
    Ok(agent_data_path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn get_project_storage_key(project_path: String) -> Result<String, String> {
    Ok(project_storage_key(&project_path))
}

#[tauri::command]
pub fn get_agent(
    app: tauri::AppHandle,
    state: State<'_, AgentStoreState>,
) -> Result<Option<AgentRecord>, String> {
    let _guard = state
        .lock
        .lock()
        .map_err(|_| "agent store lock 获取失败".to_string())?;
    let store = AgentStore::from_app(&app)?;
    store.load_agent()
}

#[tauri::command]
pub fn save_agent(
    app: tauri::AppHandle,
    state: State<'_, AgentStoreState>,
    agent: AgentRecord,
) -> Result<AgentRecord, String> {
    let _guard = state
        .lock
        .lock()
        .map_err(|_| "agent store lock 获取失败".to_string())?;
    let store = AgentStore::from_app(&app)?;
    let mut next = agent;
    next.updated_at = Utc::now();
    store.save_agent(&next)?;
    Ok(next)
}

#[tauri::command]
pub fn get_project_state(
    app: tauri::AppHandle,
    state: State<'_, AgentStoreState>,
    project_key: String,
) -> Result<Option<ProjectConversationState>, String> {
    let _guard = state
        .lock
        .lock()
        .map_err(|_| "agent store lock 获取失败".to_string())?;
    let store = AgentStore::from_app(&app)?;
    store.load_project_state(&project_key)
}

#[tauri::command]
pub fn save_project_state(
    app: tauri::AppHandle,
    state: State<'_, AgentStoreState>,
    project_key: String,
    project_state: ProjectConversationState,
) -> Result<(), String> {
    let _guard = state
        .lock
        .lock()
        .map_err(|_| "agent store lock 获取失败".to_string())?;
    let store = AgentStore::from_app(&app)?;
    store.save_project_state(&project_key, &project_state)
}

#[tauri::command]
pub fn get_projects_index(
    app: tauri::AppHandle,
    state: State<'_, AgentStoreState>,
) -> Result<ProjectsIndexFile, String> {
    let _guard = state
        .lock
        .lock()
        .map_err(|_| "agent store lock 获取失败".to_string())?;
    let store = AgentStore::from_app(&app)?;
    store.load_projects_index()
}

#[tauri::command]
pub fn touch_project_index(
    app: tauri::AppHandle,
    state: State<'_, AgentStoreState>,
    project_path: String,
) -> Result<ProjectsIndexFile, String> {
    let _guard = state
        .lock
        .lock()
        .map_err(|_| "agent store lock 获取失败".to_string())?;
    let store = AgentStore::from_app(&app)?;
    store.touch_project_index(&project_path)
}

#[tauri::command]
pub fn delete_project_state(
    app: tauri::AppHandle,
    state: State<'_, AgentStoreState>,
    project_key: String,
) -> Result<(), String> {
    let _guard = state
        .lock
        .lock()
        .map_err(|_| "agent store lock 获取失败".to_string())?;
    let store = AgentStore::from_app(&app)?;
    store.delete_project_state(&project_key)
}

#[tauri::command]
pub fn migrate_to_single_agent(
    app: tauri::AppHandle,
    state: State<'_, AgentStoreState>,
) -> Result<MigrateToSingleAgentResult, String> {
    let _guard = state
        .lock
        .lock()
        .map_err(|_| "agent store lock 获取失败".to_string())?;
    let store = AgentStore::from_app(&app)?;
    store.migrate_to_single_agent()
}

#[tauri::command]
pub fn get_agent_full_state(
    app: tauri::AppHandle,
    state: State<'_, AgentStoreState>,
    agent_id: String,
) -> Result<Option<AgentFullState>, String> {
    let _guard = state
        .lock
        .lock()
        .map_err(|_| "agent store lock 获取失败".to_string())?;
    let store = AgentStore::from_app(&app)?;
    store.load_agent_full_state(&agent_id)
}

#[tauri::command]
pub fn save_agent_full_state(
    app: tauri::AppHandle,
    state: State<'_, AgentStoreState>,
    agent_id: String,
    agent_state: AgentFullState,
) -> Result<(), String> {
    let _guard = state
        .lock
        .lock()
        .map_err(|_| "agent store lock 获取失败".to_string())?;
    let store = AgentStore::from_app(&app)?;
    store.save_agent_full_state(&agent_id, &agent_state)
}

// ── Session extras（草稿 + 待接受变更）────────────────────────────────────

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionExtrasFile {
    #[serde(default = "default_session_extras_version")]
    pub version: u32,
    #[serde(default)]
    pub drafts: HashMap<String, String>,
    #[serde(default)]
    pub pending_changes: HashMap<String, serde_json::Value>,
}

fn default_session_extras_version() -> u32 {
    SESSION_EXTRAS_VERSION
}

#[tauri::command]
pub fn load_agent_session_extras(
    app: tauri::AppHandle,
    state: State<'_, AgentStoreState>,
) -> Result<AgentSessionExtrasFile, String> {
    let _guard = state
        .lock
        .lock()
        .map_err(|_| "agent store lock 获取失败".to_string())?;
    let store = AgentStore::from_app(&app)?;
    store.load_session_extras()
}

#[tauri::command]
pub fn save_agent_session_extras(
    app: tauri::AppHandle,
    state: State<'_, AgentStoreState>,
    extras: AgentSessionExtrasFile,
) -> Result<(), String> {
    let _guard = state
        .lock
        .lock()
        .map_err(|_| "agent store lock 获取失败".to_string())?;
    let store = AgentStore::from_app(&app)?;
    store.save_session_extras(&extras)
}

// ── Todo 持久化 ──────────────────────────────────────────────────────────

const TODOS_DIR: &str = "todos";

/// 单条 Todo 项
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TodoItem {
    pub id: String,
    pub content: String,
    pub status: String,
}

/// 获取 todos 目录路径
fn todos_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("获取应用数据目录失败: {e}"))?;
    let dir = app_data_dir.join(AGENT_DATA_DIR).join(TODOS_DIR);
    if !dir.exists() {
        fs::create_dir_all(&dir).map_err(|e| format!("创建 todos 目录失败: {e}"))?;
    }
    Ok(dir)
}

/// 将 conversationId 转换为安全的文件名（替换路径分隔符等不安全字符）
fn todo_file_name(conversation_id: &str) -> String {
    let safe = conversation_id
        .replace('/', "_")
        .replace('\\', "_")
        .replace(':', "_")
        .replace('?', "_")
        .replace('*', "_")
        .replace('<', "_")
        .replace('>', "_")
        .replace('|', "_")
        .replace('"', "_");
    format!("{}.json", safe)
}

#[tauri::command]
pub fn save_todos(
    app: tauri::AppHandle,
    conversation_id: String,
    todos: Vec<TodoItem>,
) -> Result<(), String> {
    if conversation_id.is_empty() {
        return Ok(());
    }
    let dir = todos_dir(&app)?;
    let path = dir.join(todo_file_name(&conversation_id));
    let json = serde_json::to_string(&todos).map_err(|e| format!("序列化 todos 失败: {e}"))?;
    fs::write(&path, json).map_err(|e| format!("写入 todos 失败: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn load_todos(
    app: tauri::AppHandle,
    conversation_id: String,
) -> Result<Vec<TodoItem>, String> {
    if conversation_id.is_empty() {
        return Ok(Vec::new());
    }
    let dir = todos_dir(&app)?;
    let path = dir.join(todo_file_name(&conversation_id));
    if !path.exists() {
        return Ok(Vec::new());
    }
    let raw = fs::read_to_string(&path).map_err(|e| format!("读取 todos 失败: {e}"))?;
    let todos = serde_json::from_str::<Vec<TodoItem>>(&raw)
        .map_err(|e| format!("解析 todos 失败: {e}"))?;
    Ok(todos)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn unique_temp_dir(prefix: &str) -> PathBuf {
        let mut path = std::env::temp_dir();
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time went backwards")
            .as_nanos();
        path.push(format!("{prefix}_{nanos}"));
        path
    }

    fn sample_agent(id: &str, name: &str) -> AgentRecord {
        let now = Utc::now();
        AgentRecord {
            id: id.to_string(),
            name: name.to_string(),
            agent_type: "custom".to_string(),
            icon: "AI".to_string(),
            status: "online".to_string(),
            description: Some("desc".to_string()),
            model: "claude-sonnet-4-20250514".to_string(),
            provider: Some("anthropic".to_string()),
            profile_id: None,
            temperature: 0.3,
            capabilities: AgentCapabilities {
                can_execute_commands: false,
                can_access_browser: false,
                can_use_git: false,
                can_use_mcp: false,
            },
            callable: None,
            callable_description: None,
            rules: None,
            max_context_tokens: None,
            created_at: now,
            updated_at: now,
        }
    }

    #[test]
    fn save_and_load_agents_roundtrip() {
        let root = unique_temp_dir("agent_store_roundtrip");
        let store = AgentStore::new(root.clone(), 5);

        let first = sample_agent("agent_1", "A1");
        store
            .save_agents(vec![first.clone()])
            .expect("save agents should succeed");
        let loaded = store.load_agents().expect("load agents should succeed");

        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].id, first.id);
        assert_eq!(loaded[0].name, first.name);

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn restores_from_backup_when_agents_file_is_corrupted() {
        let root = unique_temp_dir("agent_store_restore");
        let store = AgentStore::new(root.clone(), 5);

        let backup_source = sample_agent("agent_old", "Old");
        store
            .save_agents(vec![backup_source.clone()])
            .expect("initial save should succeed");
        store
            .save_agents(vec![sample_agent("agent_new", "New")])
            .expect("second save should succeed");

        fs::write(store.agents_path(), "{bad json").expect("corrupt agents.json");
        let loaded = store
            .load_agents()
            .expect("load should recover from backup");

        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].id, backup_source.id);

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn saves_and_loads_last_selected_agent_id() {
        let root = unique_temp_dir("agent_store_app_state");
        let store = AgentStore::new(root.clone(), 5);

        store
            .save_app_state(Some("agent_x".to_string()))
            .expect("save app state should succeed");
        let loaded = store
            .load_app_state()
            .expect("load app state should succeed");
        assert_eq!(loaded.last_selected_agent_id.as_deref(), Some("agent_x"));

        store
            .save_app_state(None)
            .expect("clear app state should succeed");
        let loaded2 = store
            .load_app_state()
            .expect("load app state should succeed");
        assert!(loaded2.last_selected_agent_id.is_none());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn saves_and_loads_agent_full_state_with_conversation_preview() {
        let root = unique_temp_dir("agent_store_full_state");
        let store = AgentStore::new(root.clone(), 5);

        let state = AgentFullState {
            selected_conversation_id: Some("conv-1".to_string()),
            selected_conversation_id_by_project: None,
            conversations: vec![AgentConversation {
                id: "conv-1".to_string(),
                title: "会话 1".to_string(),
                project_path: None,
                thread_settings: None,
                branch_name: None,
                messages: vec![AgentMessage {
                    id: "m1".to_string(),
                    role: "user".to_string(),
                    text: "hello".to_string(),
                    thinking: None,
                    created_at: 1,
                    thinking_started_at: None,
                    thinking_ended_at: None,
                    tool_calls: None,
                    tool_call_id: None,
                    tool_name: None,
                    tool_args: None,
                    is_error: None,
                    attachments: None,
                    file_attachments: None,
                    from_agent_id: None,
                    from_agent_name: None,
                    executed_tools: None,
                    thinking_signature: None,
                    subagent_runs: None,
                }],
                created_at: 1,
                updated_at: 2,
                title_generated: Some(true),
                preview_history: vec![PreviewFile {
                    file_path: "src/main.ts".to_string(),
                    content: "const a = 1;".to_string(),
                    original_content: Some("const a = 0;".to_string()),
                    modified_content: Some("const a = 1;".to_string()),
                    language: Some("typescript".to_string()),
                }],
                current_preview_index: 0,
                context_injected: None,
                review_comments: None,
                plan_document: None,
            }],
            preview_history: vec![],
            current_preview_index: 0,
        };

        store
            .save_agent_full_state("agent-1", &state)
            .expect("save full state should succeed");

        let loaded = store
            .load_agent_full_state("agent-1")
            .expect("load full state should succeed")
            .expect("state should exist");

        assert_eq!(loaded.conversations.len(), 1);
        assert_eq!(loaded.conversations[0].preview_history.len(), 1);
        assert_eq!(
            loaded.conversations[0].preview_history[0].file_path,
            "src/main.ts"
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn loads_legacy_top_level_preview_into_selected_conversation() {
        let root = unique_temp_dir("agent_store_legacy_preview");
        let store = AgentStore::new(root.clone(), 5);

        store.ensure_layout_legacy().expect("layout should be created");
        let legacy_json = serde_json::json!({
            "selectedConversationId": "conv-legacy",
            "conversations": [
                {
                    "id": "conv-legacy",
                    "title": "会话",
                    "messages": [],
                    "createdAt": 1,
                    "updatedAt": 1,
                    "titleGenerated": false
                }
            ],
            "previewHistory": [
                {
                    "filePath": "src/legacy.ts",
                    "content": "legacy",
                    "originalContent": null,
                    "modifiedContent": null,
                    "language": "typescript"
                }
            ],
            "currentPreviewIndex": 0
        });

        fs::write(
            store.agent_state_path("agent-legacy"),
            serde_json::to_string_pretty(&legacy_json).expect("serialize legacy json"),
        )
        .expect("write legacy state");

        let loaded = store
            .load_agent_full_state("agent-legacy")
            .expect("load full state should succeed")
            .expect("state should exist");

        assert_eq!(loaded.conversations.len(), 1);
        assert_eq!(loaded.conversations[0].preview_history.len(), 1);
        assert_eq!(
            loaded.conversations[0].preview_history[0].file_path,
            "src/legacy.ts"
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn migrate_to_single_agent_splits_projects_and_keeps_selected_agent() {
        let root = unique_temp_dir("agent_store_single_migration");
        let store = AgentStore::new(root.clone(), 5);

        let agent_a = sample_agent("agent-a", "A");
        let agent_b = sample_agent("agent-b", "B");
        store
            .save_agents(vec![agent_a.clone(), agent_b.clone()])
            .expect("save legacy agents");

        store
            .save_app_state(Some("agent-a".to_string()))
            .expect("save app state");

        let legacy_state = AgentFullState {
            selected_conversation_id: Some("conv-a".to_string()),
            selected_conversation_id_by_project: Some(serde_json::json!({
                normalize_project_path("D:/proj-a"): "conv-a",
                normalize_project_path("D:/proj-b"): null
            })),
            conversations: vec![
                AgentConversation {
                    id: "conv-a".to_string(),
                    title: "A thread".to_string(),
                    project_path: Some("D:/proj-a".to_string()),
                    thread_settings: None,
                    branch_name: None,
                    messages: Vec::new(),
                    preview_history: Vec::new(),
                    current_preview_index: 0,
                    created_at: 1,
                    updated_at: 2,
                    title_generated: None,
                    context_injected: None,
                    review_comments: None,
                    plan_document: None,
                },
                AgentConversation {
                    id: "conv-b".to_string(),
                    title: "B thread".to_string(),
                    project_path: Some("D:/proj-b".to_string()),
                    thread_settings: None,
                    branch_name: None,
                    messages: Vec::new(),
                    preview_history: Vec::new(),
                    current_preview_index: 0,
                    created_at: 3,
                    updated_at: 4,
                    title_generated: None,
                    context_injected: None,
                    review_comments: None,
                    plan_document: None,
                },
            ],
            preview_history: Vec::new(),
            current_preview_index: 0,
        };
        store
            .save_agent_full_state("agent-a", &legacy_state)
            .expect("save legacy state");

        let result = store
            .migrate_to_single_agent()
            .expect("migration should succeed");
        assert!(result.migrated);
        assert_eq!(result.migrated_from_agent_count, 2);
        assert_eq!(result.project_count, 2);
        assert_eq!(result.agent.as_ref().map(|a| a.id.as_str()), Some("agent-a"));

        let loaded_agent = store.load_agent().expect("load agent").expect("agent exists");
        assert_eq!(loaded_agent.id, "agent-a");

        let key_a = project_storage_key("D:/proj-a");
        let key_b = project_storage_key("D:/proj-b");
        let state_a = store
            .load_project_state(&key_a)
            .expect("load proj a")
            .expect("proj a exists");
        assert_eq!(state_a.conversations.len(), 1);
        assert_eq!(state_a.selected_conversation_id.as_deref(), Some("conv-a"));

        let state_b = store
            .load_project_state(&key_b)
            .expect("load proj b")
            .expect("proj b exists");
        assert_eq!(state_b.conversations.len(), 1);

        assert!(!store.agents_path().exists());
        assert!(!store.states_dir().exists());
        assert!(store.agent_path().exists());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn project_storage_key_is_stable() {
        assert_eq!(
            project_storage_key("D:/Project/Foo"),
            project_storage_key("d:\\project\\foo")
        );
    }

    #[test]
    fn delete_project_state_removes_project_todos_index_and_session_extras() {
        let root = unique_temp_dir("agent_store_delete_project");
        let store = AgentStore::new(root.clone(), 5);
        let project_path = "D:/Project/DeleteMe";
        let project_key = project_storage_key(project_path);

        let project_state = ProjectConversationState {
            selected_conversation_id: Some("conv-1".to_string()),
            conversations: vec![AgentConversation {
                id: "conv-1".to_string(),
                title: "Thread".to_string(),
                project_path: Some(project_path.to_string()),
                thread_settings: None,
                branch_name: None,
                messages: Vec::new(),
                preview_history: Vec::new(),
                current_preview_index: 0,
                created_at: 1,
                updated_at: 2,
                title_generated: None,
                context_injected: None,
                review_comments: None,
                plan_document: None,
            }],
        };
        store
            .save_project_state(&project_key, &project_state)
            .expect("save project state");
        store
            .touch_project_index(project_path)
            .expect("touch project index");

        let todos_path = root.join(TODOS_DIR).join(todo_file_name("conv-1"));
        fs::create_dir_all(todos_path.parent().unwrap()).expect("create todos dir");
        fs::write(&todos_path, "[]").expect("write todo file");

        let mut extras = AgentSessionExtrasFile::default();
        extras
            .drafts
            .insert(format!("{project_key}::__compose__"), "draft".to_string());
        extras.pending_changes.insert(
            format!("{project_key}::conv-1"),
            serde_json::json!([]),
        );
        store
            .save_session_extras(&extras)
            .expect("save session extras");

        store
            .delete_project_state(&project_key)
            .expect("delete project state");

        assert!(!store.project_state_path(&project_key).exists());
        assert!(!todos_path.exists());
        let index = store.load_projects_index().expect("load index");
        assert!(index.projects.iter().all(|entry| entry.key != project_key));
        assert!(index.last_active_project_path.is_none());
        let loaded_extras = store.load_session_extras().expect("load extras");
        assert!(loaded_extras.drafts.is_empty());
        assert!(loaded_extras.pending_changes.is_empty());

        let _ = fs::remove_dir_all(root);
    }
}
