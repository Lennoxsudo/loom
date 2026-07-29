import { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from '../../i18n';
import { useNotification } from '../../contexts/NotificationContext';
import {
  mcpClient,
  resolveMcpServerDisplayState,
  type McpServerDisplayState,
  type McpToolInfo,
  type McpServerStatusEntry,
} from '../../utils/mcpClient';
import { useToolStore } from '../../stores/useToolStore';
import pageStyles from './SettingsPage.module.css';
import styles from './MCPConfigContent.module.css';
import { SettingsDeleteModal } from './SettingsDeleteModal';

const STATUS_POLL_MS = 3000;
const AUTO_RECONNECT_COOLDOWN_MS = 10_000;

interface McpServerConfig {
  id: string;
  name: string;
  command: string;
  args: string;
  enabled: boolean;
}

function statusLabel(
  state: McpServerDisplayState,
  t: ReturnType<typeof useTranslation>
): string {
  switch (state) {
    case 'running':
      return t.settingsMcp.servers.running;
    case 'starting':
      return t.status.starting;
    case 'disconnected':
      return t.settingsMcp.servers.disconnected;
    case 'disabled':
      return t.settingsMcp.servers.disabled;
    default:
      return t.settingsMcp.servers.stopped;
  }
}

function statusDotClass(state: McpServerDisplayState): string {
  switch (state) {
    case 'running':
      return styles.statusDotRunning;
    case 'starting':
      return styles.statusDotStarting;
    case 'disconnected':
      return styles.statusDotDisconnected;
    case 'disabled':
      return styles.statusDotDisabled;
    default:
      return styles.statusDotStopped;
  }
}

function statusBadgeClass(state: McpServerDisplayState): string {
  switch (state) {
    case 'running':
      return styles.statusBadgeRunning;
    case 'starting':
      return styles.statusBadgeStarting;
    case 'disconnected':
      return styles.statusBadgeDisconnected;
    case 'disabled':
      return styles.statusBadgeDisabled;
    default:
      return styles.statusBadgeStopped;
  }
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
  const [busyServerId, setBusyServerId] = useState<string | null>(null);
  const lastReconnectAttemptRef = useRef<Record<string, number>>({});
  const autoReconnectInFlightRef = useRef(false);
  const { showError } = useNotification();

  const refreshStatus = useCallback(async () => {
    try {
      const statuses = await mcpClient.getStatus();
      const map: Record<string, McpServerStatusEntry> = {};
      for (const s of statuses) map[s.server_id] = s;
      setRuntimeStatus(map);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
    const timer = setInterval(() => {
      void refreshStatus();
    }, STATUS_POLL_MS);
    const unsubscribe = mcpClient.onStatusChanged(() => {
      void refreshStatus();
    });
    return () => {
      clearInterval(timer);
      unsubscribe();
    };
  }, [refreshStatus]);

  useEffect(() => {
    if (autoReconnectInFlightRef.current || busyServerId) return;

    const disconnected = servers.filter((server) => {
      if (!server.enabled) return false;
      const state = resolveMcpServerDisplayState(
        server.enabled,
        runtimeStatus[server.id],
        busyServerId,
        server.id
      );
      if (state !== 'disconnected') return false;
      const lastAttempt = lastReconnectAttemptRef.current[server.id] ?? 0;
      return Date.now() - lastAttempt >= AUTO_RECONNECT_COOLDOWN_MS;
    });

    if (disconnected.length === 0) return;

    const target = disconnected[0];
    autoReconnectInFlightRef.current = true;
    lastReconnectAttemptRef.current[target.id] = Date.now();
    setBusyServerId(target.id);

    void (async () => {
      try {
        await mcpClient.restartServer(target.id);
        mcpClient.clearToolsCache();
        await useToolStore.getState().fetchMcpTools();
        setToolsByServer((prev) => {
          const copy = { ...prev };
          delete copy[target.id];
          return copy;
        });
      } catch (error) {
        console.warn(`[MCP] Auto-reconnect failed for ${target.id}:`, error);
      } finally {
        autoReconnectInFlightRef.current = false;
        setBusyServerId(null);
        await refreshStatus();
      }
    })();
  }, [servers, runtimeStatus, busyServerId, refreshStatus]);

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
      const filtered = allTools.filter((tool) => tool.server_id === serverId);
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
          if (
            config.mcpServers &&
            typeof config.mcpServers === 'object' &&
            !Array.isArray(config.mcpServers)
          ) {
            const list: McpServerConfig[] = Object.entries(config.mcpServers).map(
              ([key, val]: [string, any]) => ({
                id: key,
                name: key,
                command: val.command || '',
                args: Array.isArray(val.args) ? val.args.join(' ') : val.args || '',
                enabled: val.disabled === true ? false : true,
              })
            );
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
      } catch {
        /* ignore */
      }
    };
    loadConfig();
  }, [t.settingsMcp.errors.loadFailed]);

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

  const invalidateServerTools = async (serverId: string) => {
    setToolsByServer((prev) => {
      const copy = { ...prev };
      delete copy[serverId];
      return copy;
    });
    mcpClient.clearToolsCache();
    await useToolStore.getState().fetchMcpTools();
    await refreshStatus();
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
    if (busyServerId === id) return;
    const server = servers.find((s) => s.id === id);
    if (!server) return;

    const rs = runtimeStatus[id];
    const isRunning = !!(rs?.is_running && rs?.is_initialized);
    const newEnabled = !isRunning;

    const updated = servers.map((s) => (s.id === id ? { ...s, enabled: newEnabled } : s));
    setServers(updated);
    await saveConfig(updated);

    setBusyServerId(id);
    try {
      if (newEnabled) {
        await mcpClient.startServer(id);
      } else if (rs?.is_running) {
        await mcpClient.stopServer(id);
      }
      await invalidateServerTools(id);
    } catch (e) {
      console.error(`Failed to ${newEnabled ? 'start' : 'stop'} server ${id}:`, e);
      const reverted = servers.map((s) => (s.id === id ? { ...s, enabled: !newEnabled } : s));
      setServers(reverted);
      await saveConfig(reverted);
      showError(`MCP 服务器 "${server.name}" ${newEnabled ? '启动' : '停止'}失败: ${e}`);
    } finally {
      setBusyServerId(null);
    }
  };

  const handleRestartServer = async (id: string) => {
    if (busyServerId === id) return;
    const server = servers.find((s) => s.id === id);
    if (!server) return;

    setBusyServerId(id);
    try {
      await mcpClient.restartServer(id);
      await invalidateServerTools(id);
    } catch (error) {
      showError(
        t.settingsMcp.servers.restartFailed
          .replace('{name}', server.name)
          .replace('{error}', String(error))
      );
    } finally {
      setBusyServerId(null);
    }
  };

  const handleOpenConfig = async () => {
    try {
      await invoke('open_mcp_config_file');
      const path = await invoke<string>('get_mcp_config_path');
      window.dispatchEvent(new CustomEvent('open-file-in-editor', { detail: { filePath: path } }));
    } catch (e) {
      showError(`无法打开配置文件: ${e}`);
    }
  };

  if (isLoading) {
    return <div className={pageStyles.loading}>{t.settingsMcp.loading}</div>;
  }

  const serverToDelete = deleteId ? servers.find((s) => s.id === deleteId) : null;
  const enabledServers = servers.filter((server) => server.enabled);
  const runningCount = enabledServers.filter((server) => {
    const state = resolveMcpServerDisplayState(
      server.enabled,
      runtimeStatus[server.id],
      busyServerId,
      server.id
    );
    return state === 'running';
  }).length;

  const healthDotClass =
    enabledServers.length === 0
      ? styles.healthDotWarn
      : runningCount === enabledServers.length
        ? styles.healthDotOk
        : runningCount > 0
          ? styles.healthDotWarn
          : styles.healthDotError;

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

      {enabledServers.length > 0 ? (
        <div className={styles.healthBanner}>
          <span className={`${styles.healthDot} ${healthDotClass}`} />
          <span>
            {t.settingsMcp.servers.healthSummary
              .replace('{running}', String(runningCount))
              .replace('{total}', String(enabledServers.length))}
          </span>
        </div>
      ) : null}

      <div className={styles.serverList}>
        {servers.map((server) => {
          const isExpanded = expandedServerId === server.id;
          const tools = toolsByServer[server.id];
          const isLoadingThis = loadingTools === server.id;
          const displayState = resolveMcpServerDisplayState(
            server.enabled,
            runtimeStatus[server.id],
            busyServerId,
            server.id
          );
          const label = statusLabel(displayState, t);
          const canRestart = server.enabled && displayState !== 'starting';

          return (
            <div
              key={server.id}
              className={`${styles.serverCard} ${server.enabled ? '' : styles.serverCardDisabled}`}
            >
              <div className={styles.serverHeader}>
                <span
                  className={`${styles.statusDot} ${statusDotClass(displayState)}`}
                  title={label}
                />

                <div className={styles.serverInfo} onClick={() => handleToggleTools(server.id)}>
                  <div className={styles.serverName}>
                    <span
                      style={{
                        display: 'inline-block',
                        fontSize: '10px',
                        transition: 'transform 0.2s',
                        transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                        color: 'var(--text-secondary)',
                        marginRight: '6px',
                      }}
                    >
                      ▶
                    </span>
                    {server.name}
                  </div>
                  <div className={styles.serverMeta}>
                    {server.command} {server.args}
                  </div>
                </div>

                <span className={`${styles.statusBadge} ${statusBadgeClass(displayState)}`}>
                  {label}
                </span>

                {canRestart ? (
                  <button
                    type="button"
                    className={styles.actionBtn}
                    disabled={busyServerId === server.id}
                    onClick={() => void handleRestartServer(server.id)}
                    title={t.settingsMcp.servers.restart}
                  >
                    {busyServerId === server.id
                      ? t.settingsMcp.servers.reconnecting
                      : t.settingsMcp.servers.restart}
                  </button>
                ) : null}

                <button
                  type="button"
                  onClick={() => void handleToggleEnabled(server.id)}
                  disabled={busyServerId === server.id}
                  style={{
                    all: 'unset',
                    cursor: busyServerId === server.id ? 'not-allowed' : 'pointer',
                    width: '36px',
                    height: '20px',
                    borderRadius: '10px',
                    backgroundColor:
                      displayState === 'running' ? 'var(--bg-button)' : 'var(--border-strong)',
                    position: 'relative',
                    transition: 'background-color 0.2s',
                    flexShrink: 0,
                  }}
                >
                  <span
                    style={{
                      position: 'absolute',
                      top: '2px',
                      left: displayState === 'running' ? '18px' : '2px',
                      width: '16px',
                      height: '16px',
                      borderRadius: '50%',
                      backgroundColor: 'var(--text-inverse)',
                      transition: 'left 0.2s',
                    }}
                  />
                </button>

                <button
                  type="button"
                  onClick={() => setDeleteId(server.id)}
                  className={`${styles.actionBtn} ${styles.actionBtnDanger}`}
                  title={t.settingsMcp.servers.delete}
                >
                  ×
                </button>
              </div>

              {isExpanded && (
                <div className={styles.serverBody}>
                  <div className={styles.toolsList}>
                    {isLoadingThis && (
                      <div className={styles.toolItem}>{t.status.loading}</div>
                    )}
                    {!isLoadingThis && tools && tools.length === 0 && (
                      <div className={styles.toolItem}>{t.settingsMcp.servers.noTools}</div>
                    )}
                    {!isLoadingThis &&
                      tools &&
                      tools.length > 0 &&
                      tools.map((tool) => (
                        <div key={tool.name} className={styles.toolItem}>
                          <strong>{tool.name}</strong>
                          {tool.description ? ` — ${tool.description}` : ''}
                        </div>
                      ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {!showAddForm ? (
        <button
          type="button"
          onClick={() => setShowAddForm(true)}
          className={pageStyles.ghostAddButton}
        >
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
              onClick={() => void handleAddServer()}
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
          onConfirm={() => void handleDeleteServer(deleteId)}
          confirmLabel={t.settingsMcp.servers.delete}
        >
          {t.settingsMcp.servers.confirmDelete.replace('{name}', serverToDelete.name)}
        </SettingsDeleteModal>
      )}
    </div>
  );
}
