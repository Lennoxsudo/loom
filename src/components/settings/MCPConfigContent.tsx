import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from '../../i18n';
import { useNotification } from '../../contexts/NotificationContext';
import { mcpClient, type McpToolInfo, type McpServerStatusEntry } from '../../utils/mcpClient';
import { useToolStore } from '../../stores/useToolStore';
import pageStyles from './SettingsPage.module.css';
import styles from './MCPConfigContent.module.css';
import { SettingsDeleteModal } from './SettingsDeleteModal';

interface McpServerConfig {
  id: string;
  name: string;
  command: string;
  args: string;
  enabled: boolean;
}

export function MCPConfigContent() {
  const t = useTranslation();

  const [servers, setServers] = useState<McpServerConfig[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newCommand, setNewCommand] = useState('');
  const [newArgs, setNewArgs] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [configPath, setConfigPath] = useState<string>('');
  const [expandedServerId, setExpandedServerId] = useState<string | null>(null);
  const [toolsByServer, setToolsByServer] = useState<Record<string, McpToolInfo[]>>({});
  const [loadingTools, setLoadingTools] = useState<string | null>(null);
  const [runtimeStatus, setRuntimeStatus] = useState<Record<string, McpServerStatusEntry>>({});
  const [togglingServer, setTogglingServer] = useState<string | null>(null);
  const { showError } = useNotification();

  useEffect(() => {
    let mounted = true;
    const poll = async () => {
      try {
        const statuses = await mcpClient.getStatus();
        if (mounted) {
          const map: Record<string, McpServerStatusEntry> = {};
          for (const s of statuses) map[s.server_id] = s;
          setRuntimeStatus(map);
        }
      } catch { /* ignore */ }
    };
    poll();
    const timer = setInterval(poll, 3000);
    return () => { mounted = false; clearInterval(timer); };
  }, []);

  const handleToggleTools = async (serverId: string) => {
    if (expandedServerId === serverId) {
      setExpandedServerId(null);
      return;
    }
    setExpandedServerId(serverId);
    if (toolsByServer[serverId]) return;
    setLoadingTools(serverId);
    try {
      const allTools = await mcpClient.listTools();
      const filtered = allTools.filter((t) => t.server_id === serverId);
      setToolsByServer((prev) => ({ ...prev, [serverId]: filtered }));
    } catch (e) {
      console.error('Failed to load MCP tools:', e);
      setToolsByServer((prev) => ({ ...prev, [serverId]: [] }));
    } finally {
      setLoadingTools(null);
    }
  };

  useEffect(() => {
    const loadConfig = async () => {
      try {
        const configStr = await invoke<string>('load_mcp_config');
        if (configStr) {
          const config = JSON.parse(configStr);
          if (config.mcpServers && typeof config.mcpServers === 'object' && !Array.isArray(config.mcpServers)) {
            const list: McpServerConfig[] = Object.entries(config.mcpServers).map(([key, val]: [string, any]) => ({
              id: key,
              name: key,
              command: val.command || '',
              args: Array.isArray(val.args) ? val.args.join(' ') : (val.args || ''),
              enabled: val.disabled === true ? false : true,
            }));
            setServers(list);
          } else if (Array.isArray(config.servers)) {
            setServers(config.servers);
          } else {
            setServers([]);
          }
        }
      } catch (error) {
        console.error(t.settingsMcp.errors.loadFailed, error);
      } finally {
        setIsLoading(false);
      }
      try {
        const path = await invoke<string>('get_mcp_config_path');
        setConfigPath(path);
      } catch { /* ignore */ }
    };
    loadConfig();
  }, []);

  const saveConfig = async (updatedServers: McpServerConfig[]) => {
    try {
      const mcpServers: Record<string, any> = {};
      for (const s of updatedServers) {
        mcpServers[s.id] = {
          command: s.command,
          args: s.args ? s.args.split(/\s+/).filter(Boolean) : [],
          disabled: !s.enabled,
        };
      }
      const config = JSON.stringify({ mcpServers }, null, 2);
      await invoke<string>('save_mcp_config', { config });
    } catch (error) {
      showError(`${t.settingsMcp.errors.saveFailed} ${error}`);
    }
  };

  const handleAddServer = async () => {
    if (!newName.trim() || !newCommand.trim()) return;
    const serverId = newName.trim().toLowerCase().replace(/\s+/g, '-');
    const newServer: McpServerConfig = {
      id: serverId,
      name: newName.trim(),
      command: newCommand.trim(),
      args: newArgs.trim(),
      enabled: false,
    };
    const updated = [...servers, newServer];
    setServers(updated);
    setShowAddForm(false);
    setNewName('');
    setNewCommand('');
    setNewArgs('');
    await saveConfig(updated);
  };

  const handleDeleteServer = async (id: string) => {
    const updated = servers.filter((s) => s.id !== id);
    setServers(updated);
    setDeleteId(null);
    await saveConfig(updated);
  };

  const handleToggleEnabled = async (id: string) => {
    if (togglingServer === id) return;
    const server = servers.find((s) => s.id === id);
    if (!server) return;
    
    const rs = runtimeStatus[id];
    const isRunning = !!(rs?.is_running && rs?.is_initialized);
    const newEnabled = !isRunning;
    
    const updated = servers.map((s) =>
      s.id === id ? { ...s, enabled: newEnabled } : s
    );
    setServers(updated);
    await saveConfig(updated);

    setTogglingServer(id);
    try {
      if (newEnabled) {
        await mcpClient.startServer(id);
      } else {
        const rs = runtimeStatus[id];
        if (rs?.is_running) {
          await mcpClient.stopServer(id);
        }
      }
      setToolsByServer((prev) => {
        const copy = { ...prev };
        delete copy[id];
        return copy;
      });
      mcpClient.clearToolsCache();
      await useToolStore.getState().fetchMcpTools();
    } catch (e) {
      console.error(`Failed to ${newEnabled ? 'start' : 'stop'} server ${id}:`, e);
      const reverted = servers.map((s) =>
        s.id === id ? { ...s, enabled: !newEnabled } : s
      );
      setServers(reverted);
      await saveConfig(reverted);
      showError(`MCP 服务器 "${server.name}" ${newEnabled ? '启动' : '停止'}失败: ${e}`);
    } finally {
      setTogglingServer(null);
    }
  };

  const handleOpenConfig = async () => {
    try {
      await invoke('open_mcp_config_file');
      const path = await invoke<string>('get_mcp_config_path');
      window.dispatchEvent(
        new CustomEvent('open-file-in-editor', { detail: { filePath: path } })
      );
    } catch (e) {
      showError(`无法打开配置文件: ${e}`);
    }
  };

  if (isLoading) {
    return <div className={pageStyles.loading}>{t.settingsMcp.loading}</div>;
  }

  const serverToDelete = deleteId ? servers.find((s) => s.id === deleteId) : null;

  return (
    <div className={styles.root}>
      <header className={styles.pageHeader}>
        <div className={styles.pageTitleRow}>
          <h2 className={styles.pageTitle}>{t.settingsMcp.title}</h2>
          {configPath ? <span className={styles.configPath}>{configPath}</span> : null}
        </div>
        <button type="button" onClick={handleOpenConfig} className={pageStyles.secondaryButton}>
          {t.settingsMcp.servers.openConfig}
        </button>
      </header>

      <h3 className={styles.sectionHeading}>{t.settingsMcp.servers.title}</h3>

      <div className={styles.serverList}>
      {servers.map((server) => {
        const isExpanded = expandedServerId === server.id;
        const tools = toolsByServer[server.id];
        const isLoadingThis = loadingTools === server.id;

        return (
          <div
            key={server.id}
            className={`${styles.serverCard} ${server.enabled ? '' : styles.serverCardDisabled}`}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                padding: '14px 16px',
                gap: '12px',
              }}
            >
              {(() => {
                const rs = runtimeStatus[server.id];
                const isRunning = rs?.is_running && rs?.is_initialized;
                const isStarting = togglingServer === server.id;
                const dotColor = isStarting ? '#ff9800' : isRunning ? '#4caf50' : '#555';
                const dotShadow = isStarting ? '0 0 6px rgba(255, 152, 0, 0.5)' : isRunning ? '0 0 6px rgba(76, 175, 80, 0.5)' : 'none';
                const statusText = isStarting ? t.status.starting : isRunning ? t.settingsMcp.servers.running : t.settingsMcp.servers.stopped;
                return (
                  <span
                    style={{
                      width: '10px',
                      height: '10px',
                      borderRadius: '50%',
                      flexShrink: 0,
                      backgroundColor: dotColor,
                      boxShadow: dotShadow,
                      transition: 'all 0.2s',
                      animation: isStarting ? 'pulse 1.2s infinite' : 'none',
                    }}
                    title={statusText}
                  />
                );
              })()}

              <div
                style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}
                onClick={() => handleToggleTools(server.id)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-primary)', fontSize: '14px', fontWeight: '500', marginBottom: '3px' }}>
                  <span
                    style={{
                      display: 'inline-block',
                      fontSize: '10px',
                      transition: 'transform 0.2s',
                      transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                      color: 'var(--text-secondary)',
                    }}
                  >
                    ▶
                  </span>
                  {server.name}
                </div>
                <div style={{ color: 'var(--text-secondary)', fontSize: '12px', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingLeft: '16px' }}>
                  {server.command} {server.args}
                </div>
              </div>

              {(() => {
                const rs = runtimeStatus[server.id];
                const isRunning = rs?.is_running && rs?.is_initialized;
                const isStarting = togglingServer === server.id;
                let label: string;
                let bgColor: string;
                let fgColor: string;
                let bdColor: string;
                if (isStarting) {
                  label = t.status.starting;
                  bgColor = 'rgba(255, 152, 0, 0.15)';
                  fgColor = '#ff9800';
                  bdColor = 'rgba(255, 152, 0, 0.3)';
                } else if (isRunning) {
                  label = t.settingsMcp.servers.running;
                  bgColor = 'rgba(76, 175, 80, 0.15)';
                  fgColor = '#4caf50';
                  bdColor = 'rgba(76, 175, 80, 0.3)';
                } else if (server.enabled) {
                      label = t.status.notRunning;                  bgColor = 'rgba(244, 67, 54, 0.15)';
                  fgColor = '#f44336';
                  bdColor = 'rgba(244, 67, 54, 0.3)';
                } else {
                  label = t.settingsMcp.servers.disabled;
                  bgColor = 'rgba(150, 150, 150, 0.15)';
                  fgColor = '#888';
                  bdColor = 'rgba(150, 150, 150, 0.3)';
                }
                return (
                  <span
                    style={{
                      fontSize: '11px',
                      padding: '2px 8px',
                      borderRadius: '10px',
                      fontWeight: '500',
                      backgroundColor: bgColor,
                      color: fgColor,
                      border: `1px solid ${bdColor}`,
                    }}
                  >
                    {label}
                  </span>
                );
              })()}

              <button
                onClick={() => handleToggleEnabled(server.id)}
                style={{
                  all: 'unset',
                  cursor: togglingServer === server.id ? 'not-allowed' : 'pointer',
                  width: '36px',
                  height: '20px',
                  borderRadius: '10px',
                  backgroundColor: (runtimeStatus[server.id]?.is_running && runtimeStatus[server.id]?.is_initialized) ? 'var(--bg-button)' : 'var(--border-strong)',
                  position: 'relative',
                  transition: 'background-color 0.2s',
                  flexShrink: 0,
                }}
              >
                <span
                  style={{
                    position: 'absolute',
                    top: '2px',
                    left: (runtimeStatus[server.id]?.is_running && runtimeStatus[server.id]?.is_initialized) ? '18px' : '2px',
                    width: '16px',
                    height: '16px',
                    borderRadius: '50%',
                    backgroundColor: 'var(--text-inverse)',
                    transition: 'left 0.2s',
                  }}
                />
              </button>

              <button
                onClick={() => setDeleteId(server.id)}
                style={{
                  all: 'unset',
                  cursor: 'pointer',
                  color: 'var(--text-secondary)',
                  fontSize: '16px',
                  padding: '2px 4px',
                  borderRadius: '4px',
                  transition: 'color 0.15s',
                  flexShrink: 0,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.color = '#f48771'; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; }}
                title={t.settingsMcp.servers.delete}
              >
                ×
              </button>
            </div>

            {isExpanded && (
              <div
                style={{
                  borderTop: '1px solid var(--border-primary)',
                  padding: '8px 0',
                  maxHeight: '300px',
                  overflowY: 'auto',
                }}
              >
                {isLoadingThis && (
                  <div style={{ padding: '12px 20px', color: 'var(--text-secondary)', fontSize: '12px' }}>
                    加载工具列表中...
                  </div>
                )}
                {!isLoadingThis && tools && tools.length === 0 && (
                  <div style={{ padding: '12px 20px', color: 'var(--text-secondary)', fontSize: '12px' }}>
                    暂无可用工具（请确保 MCP 服务器已启动）
                  </div>
                )}
                {!isLoadingThis && tools && tools.length > 0 && tools.map((tool) => (
                  <div
                    key={tool.name}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      padding: '6px 20px',
                      gap: '8px',
                      fontSize: '12px',
                    }}
                  >
                    <span style={{ color: '#4caf50', fontSize: '11px', marginTop: '2px', flexShrink: 0 }}>✓</span>
                    <span style={{ color: '#c792ea', fontFamily: 'monospace', fontWeight: 500, flexShrink: 0, minWidth: '140px' }}>
                      {tool.name}
                    </span>
                    <span style={{ color: 'var(--text-secondary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {tool.description || ''}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
      </div>

      {!showAddForm ? (
        <button type="button" onClick={() => setShowAddForm(true)} className={pageStyles.ghostAddButton}>
          {t.settingsMcp.servers.add}
        </button>
      ) : (
        <div className={styles.addForm}>
          <div className={styles.formField}>
            <label className={styles.formLabel}>{t.settingsMcp.servers.name}</label>
            <input
              className={pageStyles.input}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t.settingsMcp.servers.namePlaceholder}
            />
          </div>
          <div className={styles.formField}>
            <label className={styles.formLabel}>{t.settingsMcp.servers.command}</label>
            <input
              className={pageStyles.input}
              value={newCommand}
              onChange={(e) => setNewCommand(e.target.value)}
              placeholder={t.settingsMcp.servers.commandPlaceholder}
            />
          </div>
          <div className={styles.formField}>
            <label className={styles.formLabel}>{t.settingsMcp.servers.args}</label>
            <input
              className={pageStyles.input}
              value={newArgs}
              onChange={(e) => setNewArgs(e.target.value)}
              placeholder={t.settingsMcp.servers.argsPlaceholder}
            />
          </div>
          <div className={styles.formFooter}>
            <button
              type="button"
              onClick={() => {
                setShowAddForm(false);
                setNewName('');
                setNewCommand('');
                setNewArgs('');
              }}
              className={pageStyles.cancelButton}
            >
              {t.settingsMcp.servers.cancel}
            </button>
            <button
              type="button"
              onClick={handleAddServer}
              disabled={!newName.trim() || !newCommand.trim()}
              className={pageStyles.primaryButton}
            >
              {t.settingsMcp.servers.save}
            </button>
          </div>
        </div>
      )}

      {deleteId && serverToDelete && (
        <SettingsDeleteModal
          title={t.settingsMcp.servers.delete}
          onCancel={() => setDeleteId(null)}
          onConfirm={() => handleDeleteServer(deleteId)}
          confirmLabel={t.settingsMcp.servers.delete}
        >
          {t.settingsMcp.servers.confirmDelete.replace('{name}', serverToDelete.name)}
        </SettingsDeleteModal>
      )}
    </div>
  );
}
