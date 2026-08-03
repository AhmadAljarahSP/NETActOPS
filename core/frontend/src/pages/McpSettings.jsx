import React, { useState, useEffect } from 'react';
import { useTheme } from '../context/ThemeContext';

export default function McpSettings() {
  const { styles } = useTheme();
  const [servers, setServers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expandedServer, setExpandedServer] = useState(null);
  const [toast, setToast] = useState(null);

  const fetchServers = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/mcp/servers', {
        headers: {
          'x-api-key': sessionStorage.getItem('app_password') || ''
        }
      });
      if (!res.ok) {
        throw new Error(`Error: ${res.statusText}`);
      }
      const data = await res.json();
      setServers(data.servers || []);
      setError(null);
    } catch (err) {
      console.error("Failed to fetch MCP servers:", err);
      setError("Failed to load MCP servers from backend. Ensure the backend API is online.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchServers();
  }, []);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const handleToggleServer = async (serverId, currentVal) => {
    const newVal = !currentVal;
    try {
      // Optimistic update
      setServers(prev => prev.map(s => s.id === serverId ? { ...s, is_enabled: newVal } : s));

      const res = await fetch(`/api/mcp/servers/${serverId}/toggle`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': sessionStorage.getItem('app_password') || ''
        },
        body: JSON.stringify({ enabled: newVal })
      });
      if (!res.ok) throw new Error("Toggle server request failed");
      showToast(`Server '${serverId}' has been ${newVal ? 'enabled' : 'disabled'}.`);
    } catch (err) {
      console.error(err);
      showToast(`Failed to update server state.`, 'error');
      // Rollback optimistic update
      setServers(prev => prev.map(s => s.id === serverId ? { ...s, is_enabled: currentVal } : s));
    }
  };

  const handleToggleTool = async (serverId, toolName, field, currentVal) => {
    const newVal = !currentVal;
    try {
      // Optimistic update
      setServers(prev => prev.map(s => {
        if (s.id === serverId) {
          const updatedTools = s.tools.map(t => 
            t.name === toolName ? { ...t, [field]: newVal } : t
          );
          return { ...s, tools: updatedTools };
        }
        return s;
      }));

      const res = await fetch(`/api/mcp/servers/${serverId}/tools/${toolName}/toggle`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': sessionStorage.getItem('app_password') || ''
        },
        body: JSON.stringify({ [field]: newVal })
      });
      if (!res.ok) throw new Error("Toggle tool request failed");
      showToast(`Tool '${toolName}' configuration updated.`);
    } catch (err) {
      console.error(err);
      showToast(`Failed to update tool configuration.`, 'error');
      // Rollback optimistic update
      setServers(prev => prev.map(s => {
        if (s.id === serverId) {
          const updatedTools = s.tools.map(t => 
            t.name === toolName ? { ...t, [field]: currentVal } : t
          );
          return { ...s, tools: updatedTools };
        }
        return s;
      }));
    }
  };

  const toggleExpandServer = (serverId) => {
    setExpandedServer(prev => prev === serverId ? null : serverId);
  };

  if (loading) {
    return (
      <div style={{ ...styles.loadingState, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
        <div style={{ fontSize: 28, animation: 'spin 2s linear infinite' }}>⟳</div>
        <div>Loading MCP Governance Panel...</div>
        <style>{`@keyframes spin { 0%{transform:rotate(0deg)} 100%{transform:rotate(360deg)} }`}</style>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      {/* Toast Notification */}
      {toast && (
        <div style={{
          position: 'fixed',
          bottom: 24,
          right: 24,
          background: toast.type === 'error' ? 'var(--status-danger)' : 'var(--primary)',
          color: '#ffffff',
          padding: '12px 24px',
          borderRadius: 'var(--border-radius-md)',
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
          zIndex: 9999,
          fontSize: 14,
          fontWeight: 600,
          animation: 'slideUp 0.3s ease'
        }}>
          {toast.message}
          <style>{`@keyframes slideUp { from{transform:translateY(20px);opacity:0} to{transform:translateY(0);opacity:1} }`}</style>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={styles.title}>Model Context Protocol (MCP) Governance</h1>
          <p style={styles.subtitle}>Manage companion services, audit schemas, and toggle tool execution safety-gates</p>
        </div>
        <button 
          onClick={fetchServers}
          style={{
            ...styles.buttonSecondary,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '8px 16px'
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>refresh</span>
          Refresh
        </button>
      </div>

      {/* Safety Info Banner */}
      <div style={{
        background: 'rgba(59,130,246,0.06)',
        border: '1px solid rgba(59,130,246,0.18)',
        borderRadius: 'var(--border-radius-lg)',
        padding: '16px 20px',
        marginBottom: 28,
        display: 'flex',
        gap: 16,
        alignItems: 'flex-start'
      }}>
        <span className="material-symbols-outlined" style={{ color: 'var(--primary)', fontSize: 24, marginTop: 2 }}>
          shield
        </span>
        <div style={{ fontSize: 13, lineHeight: '1.6', color: 'var(--text-high-contrast)' }}>
          <strong style={{ display: 'block', fontSize: 14, marginBottom: 4, color: 'var(--primary)' }}>
            CLI-Only Provisioning Governance
          </strong>
          To maintain zero-trust security controls, adding or installing new MCP servers is restricted to direct CLI access on the server (editing <code>mcp_config.json</code>). Use this panel to monitor connection states, toggle services, and enforce Human-in-the-loop approvals.
        </div>
      </div>

      {error && (
        <div style={{
          background: 'rgba(239,68,68,0.08)',
          border: '1px solid rgba(239,68,68,0.25)',
          borderRadius: 'var(--border-radius-md)',
          padding: 16,
          color: 'var(--status-danger)',
          fontSize: 14,
          marginBottom: 24
        }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {servers.length === 0 ? (
          <div style={{ ...styles.panel, textAlign: 'center', padding: '48px 24px', color: 'var(--text-muted)' }}>
            No MCP servers are configured in the static registry file.
          </div>
        ) : (
          servers.map(srv => {
            const isExpanded = expandedServer === srv.id;
            const isConnected = srv.status === 'connected';

            return (
              <div key={srv.id} style={{
                ...styles.panel,
                padding: 0,
                overflow: 'hidden',
                border: '1px solid var(--border-whisper)',
                transition: 'all 0.2s ease',
                opacity: srv.is_enabled ? 1 : 0.65
              }}>
                {/* Server Header Block */}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '20px 24px',
                  background: 'rgba(255,255,255,0.01)',
                  cursor: 'pointer'
                }} onClick={() => toggleExpandServer(srv.id)}>
                  
                  <div style={{ display: 'flex', alignItems: 'center', gap: 16, flex: 1 }}>
                    <span 
                      className="material-symbols-outlined" 
                      style={{ 
                        fontSize: 20, 
                        transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                        transition: 'transform 0.2s ease',
                        color: 'var(--text-muted)'
                      }}
                    >
                      chevron_right
                    </span>

                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--text-high-contrast)' }}>
                          {srv.name}
                        </h3>
                        {/* Status Badge */}
                        <div style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          fontSize: 11,
                          fontWeight: 600,
                          padding: '2px 8px',
                          borderRadius: 20,
                          background: isConnected ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.08)',
                          color: isConnected ? 'var(--status-success)' : 'var(--status-danger)',
                          border: `1px solid ${isConnected ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)'}`
                        }}>
                          <span style={{
                            width: 6,
                            height: 6,
                            borderRadius: '50%',
                            background: isConnected ? 'var(--status-success)' : 'var(--status-danger)',
                            boxShadow: isConnected ? '0 0 6px var(--status-success)' : 'none'
                          }} />
                          {isConnected ? 'Connected' : 'Offline'}
                        </div>
                      </div>
                      <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>
                        {srv.description}
                      </p>
                    </div>
                  </div>

                  {/* Server controls */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 20 }} onClick={e => e.stopPropagation()}>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', padding: '4px 8px', background: 'rgba(255,255,255,0.03)', borderRadius: 4 }}>
                      {srv.endpoint}
                    </div>
                    
                    {/* Toggle Switch */}
                    <label style={{
                      position: 'relative',
                      display: 'inline-block',
                      width: 44,
                      height: 24,
                      cursor: 'pointer'
                    }}>
                      <input 
                        type="checkbox"
                        checked={srv.is_enabled}
                        onChange={() => handleToggleServer(srv.id, srv.is_enabled)}
                        style={{ opacity: 0, width: 0, height: 0 }}
                      />
                      <span style={{
                        position: 'absolute',
                        top: 0, left: 0, right: 0, bottom: 0,
                        backgroundColor: srv.is_enabled ? 'var(--primary)' : 'rgba(255,255,255,0.1)',
                        borderRadius: 24,
                        transition: '0.2s',
                      }}>
                        <span style={{
                          position: 'absolute',
                          left: 4, bottom: 4,
                          width: 16, height: 16,
                          backgroundColor: '#ffffff',
                          borderRadius: '50%',
                          transition: '0.2s',
                          transform: srv.is_enabled ? 'translateX(20px)' : 'translateX(0)'
                        }} />
                      </span>
                    </label>
                  </div>
                </div>

                {/* Collapsible Tools List */}
                {isExpanded && (
                  <div style={{
                    padding: '0 24px 24px',
                    borderTop: '1px solid var(--border-whisper)',
                    background: 'rgba(0,0,0,0.02)'
                  }}>
                    <h4 style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-high-contrast)', marginTop: 20, marginBottom: 12 }}>
                      Available Capabilities / Tools ({srv.tools.length})
                    </h4>
                    
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      {srv.tools.map(tool => (
                        <div key={tool.name} style={{
                          background: 'var(--surface-solid)',
                          border: '1px solid var(--border-whisper)',
                          borderRadius: 'var(--border-radius-md)',
                          padding: '16px 20px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 20,
                          opacity: srv.is_enabled && tool.is_enabled ? 1 : 0.5
                        }}>
                          <div style={{ flex: 1 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                              <code style={{ fontSize: 13, fontWeight: 700, color: 'var(--primary)', fontFamily: 'var(--font-mono)' }}>
                                {tool.name}
                              </code>
                            </div>
                            <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-muted)', lineHeight: '1.4' }}>
                              {tool.description}
                            </p>
                          </div>

                          {/* Tool Controls */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
                            {/* Require Operator Approval Gate */}
                            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' }}>
                              <input 
                                type="checkbox"
                                checked={tool.requires_approval}
                                disabled={!srv.is_enabled || !tool.is_enabled}
                                onChange={() => handleToggleTool(srv.id, tool.name, 'requires_approval', tool.requires_approval)}
                                style={{ accentColor: 'var(--primary)' }}
                              />
                              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-high-contrast)' }}>
                                Approval Gate
                              </span>
                            </label>

                            {/* Enable/Disable Tool Switch */}
                            <label style={{
                              position: 'relative',
                              display: 'inline-block',
                              width: 36,
                              height: 20,
                              cursor: srv.is_enabled ? 'pointer' : 'not-allowed'
                            }}>
                              <input 
                                type="checkbox"
                                checked={tool.is_enabled}
                                disabled={!srv.is_enabled}
                                onChange={() => handleToggleTool(srv.id, tool.name, 'is_enabled', tool.is_enabled)}
                                style={{ opacity: 0, width: 0, height: 0 }}
                              />
                              <span style={{
                                position: 'absolute',
                                top: 0, left: 0, right: 0, bottom: 0,
                                backgroundColor: tool.is_enabled && srv.is_enabled ? 'var(--primary)' : 'rgba(255,255,255,0.06)',
                                borderRadius: 20,
                                transition: '0.2s',
                              }}>
                                <span style={{
                                  position: 'absolute',
                                  left: 3, bottom: 3,
                                  width: 14, height: 14,
                                  backgroundColor: '#ffffff',
                                  borderRadius: '50%',
                                  transition: '0.2s',
                                  transform: tool.is_enabled && srv.is_enabled ? 'translateX(16px)' : 'translateX(0)'
                                }} />
                              </span>
                            </label>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
