import React, { useState, useEffect } from 'react';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';

export default function Notifications() {
  const { styles } = useTheme();
  const { isAdmin } = useAuth();

  const [loading, setLoading] = useState(false);
  const [saveStatus, setSaveStatus] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [matterbridgeUrl, setMatterbridgeUrl] = useState('http://netact_matterbridge:4242/api/message');
  const [rules, setRules] = useState([]);

  // Available event types for user routing configuration
  const eventTypes = [
    { value: 'backup_run', label: 'Backup Succeeded' },
    { value: 'backup_failed', label: 'Backup Failed' },
    { value: 'healthcheck_run', label: 'Healthcheck Succeeded' },
    { value: 'healthcheck_failed', label: 'Healthcheck Failed' },
    { value: 'config_drift', label: 'Configuration Drift Detected' },
    { value: 'automation_flow_run', label: 'Automation Workflow Completed' }
  ];

  // Available chat output channels supported by our Matterbridge setup
  const channelOptions = [
    { value: 'slack', label: 'Slack Workspace' },
    { value: 'telegram', label: 'Telegram Bot/Group' },
    { value: 'discord', label: 'Discord Server Channel' },
    { value: 'teams', label: 'Microsoft Teams Webhook' }
  ];

  useEffect(() => {
    fetchSettings();
  }, []);

  async function fetchSettings() {
    setLoading(true);
    try {
      const res = await fetch('/api/notification/settings', {
        headers: { 'x-api-key': sessionStorage.getItem('app_password') || '' }
      });
      if (res.ok) {
        const data = await res.json();
        setEnabled(data.enabled !== false);
        setMatterbridgeUrl(data.matterbridge_url || 'http://netact_matterbridge:4242/api/message');
        setRules(data.rules || []);
      }
    } catch (err) {
      console.error('Error fetching notification routing settings:', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveSettings(e) {
    if (e) e.preventDefault();
    setSaveStatus('');
    setLoading(true);

    try {
      const payload = {
        enabled,
        matterbridge_url: matterbridgeUrl,
        rules
      };

      const res = await fetch('/api/notification/settings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': sessionStorage.getItem('app_password') || ''
        },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        setSaveStatus('✅ Notification routing preferences saved successfully!');
      } else {
        setSaveStatus('❌ Failed to save routing configuration.');
      }
    } catch (err) {
      setSaveStatus('❌ Error: ' + err.message);
    } finally {
      setLoading(false);
    }
  }

  function handleAddRule() {
    const newRule = {
      event_type: 'backup_failed',
      channels: ['slack'],
      enabled: true
    };
    setRules([...rules, newRule]);
  }

  function handleRemoveRule(index) {
    setRules(rules.filter((_, idx) => idx !== index));
  }

  function handleRuleChange(index, field, value) {
    const updated = [...rules];
    updated[index][field] = value;
    setRules(updated);
  }

  function handleChannelToggle(ruleIndex, channelValue) {
    const rule = rules[ruleIndex];
    let newChannels = [...rule.channels];
    if (newChannels.includes(channelValue)) {
      newChannels = newChannels.filter(c => c !== channelValue);
    } else {
      newChannels.push(channelValue);
    }
    handleRuleChange(ruleIndex, 'channels', newChannels);
  }

  if (!isAdmin) {
    return (
      <div style={styles.page}>
        <div style={{ ...styles.panel, padding: 32, textAlign: 'center' }}>
          <h2 style={{ color: 'var(--status-danger)' }}>Access Denied</h2>
          <p style={{ color: 'var(--text-muted)' }}>You must be an administrator to manage system notification routing rules.</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24, maxWidth: 1000, margin: "0 auto" }}>
      <div>
        <h1 style={{ ...styles.title, margin: 0, display: "flex", alignItems: "center", gap: 12 }}>
          <span>🔔</span> Notification Routing & Gateways
        </h1>
        <p style={{ ...styles.subtitle, marginTop: 6, marginBottom: 0 }}>
          Centrally configure which system events are routed to which messaging platforms via the Matterbridge gateway.
        </p>
      </div>

      <form onSubmit={handleSaveSettings} style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        
        {/* Global Settings Card */}
        <div style={{ ...styles.panel, padding: 28, display: "flex", flexDirection: "column", gap: 20 }}>
          <h3 style={{ margin: 0, fontSize: 16, color: "var(--text-high-contrast)", borderBottom: "1px solid var(--border-whisper)", paddingBottom: 12 }}>
            ⚙️ Global Settings
          </h3>
          
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <input 
              type="checkbox"
              id="global-enable"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              style={{ width: 18, height: 18, cursor: "pointer" }}
            />
            <label htmlFor="global-enable" style={{ fontSize: 14, fontWeight: 700, cursor: "pointer", color: "var(--text-high-contrast)" }}>
              Enable System Notifications
            </label>
          </div>

          <div style={styles.fieldWrap}>
            <label style={styles.label}>Matterbridge API URL</label>
            <input 
              type="text"
              value={matterbridgeUrl}
              onChange={(e) => setMatterbridgeUrl(e.target.value)}
              placeholder="http://netact_matterbridge:4242/api/message"
              style={styles.input}
              disabled={!enabled}
            />
            <small style={{ color: "var(--text-muted)", fontSize: 11, marginTop: 4, display: "block" }}>
              The HTTP endpoint exposed by the Matterbridge service inside the docker container network.
            </small>
          </div>
        </div>

        {/* Routing Rules Card */}
        <div style={{ ...styles.panel, padding: 28, display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid var(--border-whisper)", paddingBottom: 12 }}>
            <h3 style={{ margin: 0, fontSize: 16, color: "var(--text-high-contrast)" }}>
              🔀 Event-to-Channel Routing Rules
            </h3>
            <button
              type="button"
              onClick={handleAddRule}
              disabled={!enabled}
              style={{
                ...styles.buttonSecondary,
                padding: "6px 14px",
                fontSize: 12,
                borderRadius: 6,
                background: "rgba(0,173,181,0.1)",
                border: "1px solid var(--primary)",
                color: "var(--primary)",
                cursor: "pointer"
              }}
            >
              + Add New Rule
            </button>
          </div>

          {rules.length === 0 ? (
            <div style={{ border: "1px dashed var(--border-whisper)", borderRadius: 10, padding: "40px 20px", textAlign: "center", color: "var(--text-muted)" }}>
              No notification rules defined. System alerts won't be relayed. Click <b>+ Add New Rule</b> above to start.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {rules.map((rule, index) => (
                <div 
                  key={index}
                  style={{
                    padding: 20,
                    background: "rgba(255,255,255,0.02)",
                    borderRadius: 10,
                    border: "1px solid var(--border-whisper)",
                    display: "flex",
                    flexDirection: "column",
                    gap: 16,
                    position: "relative"
                  }}
                >
                  <button
                    type="button"
                    onClick={() => handleRemoveRule(index)}
                    style={{
                      position: "absolute",
                      top: 12,
                      right: 12,
                      background: "transparent",
                      border: "none",
                      color: "var(--status-danger)",
                      cursor: "pointer",
                      fontSize: 16
                    }}
                    title="Remove Rule"
                  >
                    🗑️
                  </button>

                  <div style={{ display: "flex", flexWrap: "wrap", gap: 20, alignItems: "center" }}>
                    <div style={{ flex: "1 1 250px", display: "flex", flexDirection: "column", gap: 6 }}>
                      <label style={{ fontSize: 12, fontWeight: 700, color: "var(--text-inactive)" }}>When event happens:</label>
                      <select
                        value={rule.event_type}
                        onChange={(e) => handleRuleChange(index, 'event_type', e.target.value)}
                        style={{
                          ...styles.input,
                          background: "var(--surface-solid)",
                          border: "1px solid var(--border-whisper)",
                          color: "var(--text-high-contrast)",
                          padding: "8px 12px",
                          borderRadius: 6,
                          outline: "none"
                        }}
                      >
                        {eventTypes.map(ev => (
                          <option key={ev.value} value={ev.value}>{ev.label}</option>
                        ))}
                      </select>
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-inactive)" }}>Relay to channels:</span>
                      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                        {channelOptions.map(ch => {
                          const active = rule.channels.includes(ch.value);
                          return (
                            <button
                              type="button"
                              key={ch.value}
                              onClick={() => handleChannelToggle(index, ch.value)}
                              style={{
                                padding: "6px 12px",
                                borderRadius: 6,
                                border: `1px solid ${active ? "var(--primary)" : "var(--border-whisper)"}`,
                                background: active ? "rgba(0,173,181,0.15)" : "transparent",
                                color: active ? "var(--primary)" : "var(--text-muted)",
                                fontSize: 11,
                                fontWeight: 600,
                                cursor: "pointer",
                                transition: "all 0.15s ease"
                              }}
                            >
                              {active ? '✓ ' : ''}{ch.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: "auto", paddingRight: 32 }}>
                      <input 
                        type="checkbox"
                        id={`rule-enable-${index}`}
                        checked={rule.enabled !== false}
                        onChange={(e) => handleRuleChange(index, 'enabled', e.target.checked)}
                        style={{ width: 16, height: 16, cursor: "pointer" }}
                      />
                      <label htmlFor={`rule-enable-${index}`} style={{ fontSize: 12, fontWeight: 600, cursor: "pointer", color: "var(--text-high-contrast)" }}>
                        Enabled
                      </label>
                    </div>

                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Controls */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          {saveStatus && (
            <div style={{ fontSize: 13, fontWeight: 600 }}>
              {saveStatus}
            </div>
          )}
          <button
            type="submit"
            disabled={loading}
            style={{
              ...styles.buttonPrimary,
              padding: "10px 24px",
              fontSize: 14,
              borderRadius: 6,
              marginLeft: "auto",
              cursor: "pointer"
            }}
          >
            {loading ? 'Saving...' : 'Save Settings'}
          </button>
        </div>

      </form>
    </div>
  );
}
