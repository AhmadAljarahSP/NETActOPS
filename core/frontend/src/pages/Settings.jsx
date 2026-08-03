import React, { useState, useEffect } from 'react';
import { useTheme, getDefaultsForMode, THEME_PRESETS } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import defaultTheme from '../theme.json';

export default function Settings() {
  const { config, updateConfig, styles } = useTheme();
  const { users, addUser, deleteUser, isAdmin } = useAuth();
  
  const colors = {
    primary: 'var(--primary)',
    light: 'var(--text-high-contrast)',
    gray: 'var(--text-muted)',
    danger: 'var(--status-danger)',
  };

  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState('viewer');
  const [error, setError] = useState('');
  const [notificationsEnabled, setNotificationsEnabled] = useState(() => {
    return localStorage.getItem('netact_notifications_enabled') !== 'false';
  });

  /* System Settings State */
  const [sysLoading, setSysLoading] = useState(false);
  const [useJumpServer, setUseJumpServer] = useState(true);
  const [jumpHost, setJumpHost] = useState('');
  const [jumpUser, setJumpUser] = useState('');
  const [jumpPass, setJumpPass] = useState('');
  const [deviceUser, setDeviceUser] = useState('');
  const [devicePass, setDevicePass] = useState('');
  const [geminiApiKey, setGeminiApiKey] = useState('');
  const [encryptionKey, setEncryptionKey] = useState('');
  const [saveStatus, setSaveStatus] = useState('');
  const [showSecrets, setShowSecrets] = useState(false);

  useEffect(() => {
    fetch('/api/settings/system', {
      headers: { 'x-api-key': sessionStorage.getItem('app_password') || '' }
    })
      .then(res => res.json())
      .then(data => {
        if (data) {
          setUseJumpServer(data.use_jump_server !== false);
          setJumpHost(data.jump_host || '');
          setJumpUser(data.jump_user || '');
          setDeviceUser(data.device_user || '');
          setEncryptionKey(data.encryption_key || '');
        }
      })
      .catch(err => console.error('Error loading system settings:', err));
  }, []);

  const handleSaveSystemSettings = async (e) => {
    e.preventDefault();
    setSysLoading(true);
    setSaveStatus('');
    try {
      const payload = {
        use_jump_server: useJumpServer,
        jump_host: jumpHost,
        jump_user: jumpUser,
        device_user: deviceUser,
      };
      if (jumpPass) payload.jump_password = jumpPass;
      if (devicePass) payload.device_pass = devicePass;
      if (geminiApiKey) payload.gemini_api_key = geminiApiKey;
      if (encryptionKey) payload.encryption_key = encryptionKey;

      const res = await fetch('/api/settings/system', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': sessionStorage.getItem('app_password') || ''
        },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        setSaveStatus('✅ System settings saved to .env & reloaded live!');
        setJumpPass('');
        setDevicePass('');
        setGeminiApiKey('');
      } else {
        setSaveStatus('❌ Failed to save settings.');
      }
    } catch (err) {
      setSaveStatus('❌ Error: ' + err.message);
    } finally {
      setSysLoading(false);
    }
  };

  const generateFernetKey = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    let key = '';
    for (let i = 0; i < 43; i++) {
      key += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    key += '=';
    setEncryptionKey(key);
  };

  const handleToggleNotifications = (e) => {
    const val = e.target.checked;
    setNotificationsEnabled(val);
    localStorage.setItem('netact_notifications_enabled', String(val));
  };

  const handleAddUser = (e) => {
    e.preventDefault();
    if (!newUsername || !newPassword) return;
    if (users.find(u => u.username === newUsername)) {
      setError('User already exists');
      return;
    }
    addUser({ username: newUsername, password: newPassword, role: newRole });
    setNewUsername('');
    setNewPassword('');
    setError('');
  };

  const exportTheme = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(config, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", "theme.json");
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  const importTheme = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target.result);
        if (parsed.mode || parsed.primary || parsed.borderRadius !== undefined) {
          updateConfig(parsed);
        } else {
          alert("Invalid theme.json file structure.");
        }
      } catch (err) {
        alert("Failed to parse theme.json. Make sure it is valid JSON.");
      }
    };
    reader.readAsText(file);
  };

  const resetTheme = () => {
    if (window.confirm("Are you sure you want to reset all appearance customizations back to system defaults?")) {
      localStorage.removeItem('netact_theme_config');
      updateConfig(defaultTheme);
    }
  };

  const defaults = getDefaultsForMode(config.mode, config.primary, config.secondary);

  const renderColorPicker = (label, key, defaultVal) => {
    const value = config[key] || defaultVal;
    
    // Validate hex format for HTML color input
    let hexValue = '#000000';
    if (value && value.startsWith('#')) {
      if (value.length === 4) {
        hexValue = '#' + value[1] + value[1] + value[2] + value[2] + value[3] + value[3];
      } else if (value.length === 7) {
        hexValue = value;
      }
    }

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            type="color"
            value={hexValue}
            onChange={(e) => updateConfig({ [key]: e.target.value })}
            style={{ width: 34, height: 32, border: '1px solid var(--border-whisper)', borderRadius: 'var(--border-radius-sm)', cursor: 'pointer', padding: 0, background: 'none' }}
          />
          <input
            type="text"
            value={value}
            onChange={(e) => updateConfig({ [key]: e.target.value })}
            style={{
              width: '100%',
              boxSizing: 'border-box',
              padding: '6px 10px',
              border: '1px solid var(--border-whisper)',
              borderRadius: 'var(--border-radius-sm)',
              fontSize: 12,
              fontFamily: 'var(--font-mono)',
              background: 'var(--surface-solid)',
              color: 'var(--text-high-contrast)',
              outline: 'none'
            }}
          />
        </div>
      </div>
    );
  };

  if (!isAdmin) return <div style={styles.errorState}>Access Denied. Admins only.</div>;

  return (
    <div style={styles.container}>
      <h1 style={{ ...styles.title, marginBottom: 32 }}>System Settings</h1>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        
        {/* Centralized Theme Engine Controls */}
        <div style={styles.panel}>
          <h3 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-high-contrast)', marginBottom: 24, display: 'flex', alignItems: 'center', gap: 8 }}>
            🎨 Centralized Appearance Engine
          </h3>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            {/* Mode & Accents */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 20, borderBottom: '1px solid var(--border-whisper)', paddingBottom: 20 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={styles.label}>Base Theme Mode</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => updateConfig({ mode: 'dark' })}
                    style={{
                      ...styles.buttonSecondary,
                      flex: 1,
                      background: config.mode === 'dark' ? 'var(--primary-glow)' : 'var(--surface-solid)',
                      borderColor: config.mode === 'dark' ? 'var(--primary)' : 'var(--border-whisper)',
                      color: config.mode === 'dark' ? 'var(--text-high-contrast)' : 'var(--text-muted)',
                      fontWeight: config.mode === 'dark' ? 700 : 500
                    }}
                  >
                    🌙 Dark Mode
                  </button>
                  <button
                    type="button"
                    onClick={() => updateConfig({ mode: 'light' })}
                    style={{
                      ...styles.buttonSecondary,
                      flex: 1,
                      background: config.mode === 'light' ? 'var(--primary-glow)' : 'var(--surface-solid)',
                      borderColor: config.mode === 'light' ? 'var(--primary)' : 'var(--border-whisper)',
                      color: config.mode === 'light' ? 'var(--text-high-contrast)' : 'var(--text-muted)',
                      fontWeight: config.mode === 'light' ? 700 : 500
                    }}
                  >
                    ☀️ Light Mode
                  </button>
                </div>
              </div>
              
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                {renderColorPicker('Primary Accent', 'primary', defaults.sidebarActiveIndicator)}
                {renderColorPicker('Secondary Accent', 'secondary', defaults.secondary)}
              </div>
            </div>

            {/* Full Theme Presets */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, borderBottom: '1px solid var(--border-whisper)', paddingBottom: 20 }}>
              <label style={styles.label}>Full Theme Presets</label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8 }}>
                {THEME_PRESETS.map(preset => {
                  const isActive = config.primary === preset.config.primary && config.primaryBg === preset.config.primaryBg;
                  return (
                    <button
                      key={preset.key}
                      type="button"
                      onClick={() => updateConfig(preset.config)}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'flex-start',
                        gap: 6,
                        padding: '10px 12px',
                        borderRadius: 'var(--border-radius-md)',
                        border: `1px solid ${isActive ? preset.config.primary : 'var(--border-whisper)'}`,
                        background: isActive ? `${preset.config.primary}18` : 'var(--surface-solid)',
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                        textAlign: 'left',
                      }}
                    >
                      {/* Color swatch strip */}
                      <div style={{ display: 'flex', gap: 3, width: '100%' }}>
                        {preset.preview.map((c, i) => (
                          <span key={i} style={{
                            flex: 1, height: 6, borderRadius: 3,
                            background: c,
                            boxShadow: i === 0 ? `0 0 6px ${c}80` : 'none',
                          }} />
                        ))}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <span style={{ fontSize: 14 }}>{preset.emoji}</span>
                        <span style={{ fontSize: 11, fontWeight: 700, color: isActive ? preset.config.primary : 'var(--text-high-contrast)' }}>
                          {preset.name}
                        </span>
                      </div>
                      <span style={{ fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.3 }}>{preset.description}</span>
                      {isActive && (
                        <span style={{ fontSize: 9, fontWeight: 700, color: preset.config.primary, letterSpacing: '0.05em' }}>✓ ACTIVE</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Quick Presets */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, borderBottom: '1px solid var(--border-whisper)', paddingBottom: 20 }}>
              <label style={styles.label}>Quick Accent Preset</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {[
                  { name: 'NetVault Blue', primary: '#00B8FF', secondary: '#00D4AA' },
                  { name: 'Cyber Indigo', primary: '#6366f1', secondary: '#3b82f6' },
                  { name: 'NOC Emerald', primary: '#10b981', secondary: '#00C853' },
                  { name: 'Tactical Amber', primary: '#f59e0b', secondary: '#FFB300' },
                  { name: 'High-Contrast White', primary: '#F4F4F4', secondary: '#828282' }
                ].map(preset => (
                  <button
                    key={preset.name}
                    type="button"
                    onClick={() => updateConfig({ primary: preset.primary, secondary: preset.secondary })}
                    style={{
                      ...styles.buttonSecondary,
                      padding: '6px 10px',
                      fontSize: 11,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      background: 'var(--surface-solid)',
                      borderColor: config.primary === preset.primary ? 'var(--primary)' : 'var(--border-whisper)'
                    }}
                  >
                    <span style={{ display: 'inline-flex', gap: 3 }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: preset.primary }} />
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: preset.secondary }} />
                    </span>
                    {preset.name}
                  </button>
                ))}
              </div>
            </div>

            {/* Individual Element Color Customization */}
            <div style={{ borderBottom: '1px solid var(--border-whisper)', paddingBottom: 20 }}>
              <h4 style={{ ...styles.label, marginBottom: 16, fontSize: 12, color: 'var(--primary)', textTransform: 'uppercase' }}>
                🎨 Granular Element Colors (Overrides)
              </h4>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                {/* Backgrounds Section */}
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-high-contrast)', marginBottom: 10, opacity: 0.8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Backgrounds & Layout</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
                    {renderColorPicker('Primary Background', 'primaryBg', defaults.primaryBg)}
                    {renderColorPicker('Secondary Background', 'secondaryBg', defaults.secondaryBg)}
                    {renderColorPicker('Card Background', 'cardBg', defaults.cardBg)}
                    {renderColorPicker('Card Hover Background', 'cardHoverBg', defaults.cardHoverBg)}
                  </div>
                </div>

                {/* Sidebar Section */}
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-high-contrast)', marginBottom: 10, opacity: 0.8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Sidebar Layout</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
                    {renderColorPicker('Sidebar Background', 'sidebarBg', defaults.sidebarBg)}
                    {renderColorPicker('Sidebar Hover Bg', 'sidebarHoverBg', defaults.sidebarHoverBg)}
                    {renderColorPicker('Sidebar Active Bg Start', 'sidebarActiveBgStart', defaults.sidebarActiveBgStart)}
                    {renderColorPicker('Sidebar Active Bg End', 'sidebarActiveBgEnd', defaults.sidebarActiveBgEnd)}
                    {renderColorPicker('Sidebar Active Indicator', 'sidebarActiveIndicator', defaults.sidebarActiveIndicator)}
                  </div>
                </div>

                {/* Text & Icons Section */}
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-high-contrast)', marginBottom: 10, opacity: 0.8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Typography & UI Icons</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
                    {renderColorPicker('Active Text', 'textActive', defaults.textActive)}
                    {renderColorPicker('Muted Text', 'textMuted', defaults.textMuted)}
                    {renderColorPicker('Default Icon Color', 'iconColor', defaults.iconColor)}
                    {renderColorPicker('Active Icon Color', 'iconActiveColor', defaults.iconActiveColor)}
                    {renderColorPicker('Borders Color', 'border', defaults.border)}
                  </div>
                </div>

                {/* Status / Alert Colors Section */}
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-high-contrast)', marginBottom: 10, opacity: 0.8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Status & Alarm States</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
                    {renderColorPicker('Success AlertState', 'success', defaults.success)}
                    {renderColorPicker('Warning AlertState', 'warning', defaults.warning)}
                    {renderColorPicker('Danger AlertState', 'danger', defaults.danger)}
                  </div>
                </div>
              </div>
            </div>

            {/* Layout Options (Sliders and Selectors) */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 20, borderBottom: '1px solid var(--border-whisper)', paddingBottom: 20 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label style={styles.label}>Sidebar Width</label>
                  <span style={{ fontSize: 11, color: 'var(--text-high-contrast)', fontFamily: 'var(--font-mono)' }}>{config.sidebarWidth || 280}px</span>
                </div>
                <input
                  type="range"
                  min="200"
                  max="320"
                  value={config.sidebarWidth || 280}
                  onChange={(e) => updateConfig({ sidebarWidth: parseInt(e.target.value) })}
                  style={{ width: '100%', cursor: 'pointer', accentColor: 'var(--primary)' }}
                />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label style={styles.label}>Border Radius</label>
                  <span style={{ fontSize: 11, color: 'var(--text-high-contrast)', fontFamily: 'var(--font-mono)' }}>{config.borderRadius !== undefined ? config.borderRadius : 12}px</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="20"
                  value={config.borderRadius !== undefined ? config.borderRadius : 12}
                  onChange={(e) => updateConfig({ borderRadius: parseInt(e.target.value) })}
                  style={{ width: '100%', cursor: 'pointer', accentColor: 'var(--primary)' }}
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 20, borderBottom: '1px solid var(--border-whisper)', paddingBottom: 20 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={styles.label}>Font Family</label>
                <select
                  value={config.fontFamily || 'Geist'}
                  onChange={(e) => updateConfig({ fontFamily: e.target.value })}
                  style={styles.input}
                >
                  <option value="Geist">Geist (Track-Tight Sans)</option>
                  <option value="Satoshi">Satoshi (Modern UI)</option>
                  <option value="Inter">Inter (Classic Enterprise)</option>
                  <option value="JetBrains Mono">JetBrains Mono (Console)</option>
                </select>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={styles.label}>Base Font Size</label>
                <select
                  value={config.fontSize || 'normal'}
                  onChange={(e) => updateConfig({ fontSize: e.target.value })}
                  style={styles.input}
                >
                  <option value="small">Small (12px)</option>
                  <option value="normal">Normal (14px)</option>
                  <option value="large">Large (16px)</option>
                </select>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={styles.label}>Animation Speed</label>
                <select
                  value={config.animationSpeed || 'normal'}
                  onChange={(e) => updateConfig({ animationSpeed: e.target.value })}
                  style={styles.input}
                >
                  <option value="fast">Fast (0.1s)</option>
                  <option value="normal">Normal (0.25s)</option>
                  <option value="slow">Slow (0.5s)</option>
                </select>
              </div>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, borderBottom: '1px solid var(--border-whisper)', paddingBottom: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' }} onClick={() => updateConfig({ glassEffect: !config.glassEffect })}>
                <input type="checkbox" checked={!!config.glassEffect} readOnly style={{ accentColor: 'var(--primary)' }} />
                <span style={{ fontSize: 13, color: 'var(--text-high-contrast)', fontWeight: 600 }}>Glassmorphism Card Style</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' }} onClick={() => updateConfig({ compact: !config.compact })}>
                <input type="checkbox" checked={!!config.compact} readOnly style={{ accentColor: 'var(--primary)' }} />
                <span style={{ fontSize: 13, color: 'var(--text-high-contrast)', fontWeight: 600 }}>Compact NOC Grid Layout</span>
              </div>
            </div>

            {/* Export / Import theme.json Actions */}
            <div style={{ display: 'flex', gap: 12, borderTop: '1px dashed var(--border-whisper)', paddingTop: 16 }}>
              <button
                type="button"
                onClick={exportTheme}
                style={{ ...styles.buttonSecondary, flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>download</span>
                Export theme.json
              </button>
              <button
                type="button"
                onClick={() => document.getElementById('theme-import-input').click()}
                style={{ ...styles.buttonSecondary, flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>upload</span>
                Import theme.json
              </button>
              <input
                id="theme-import-input"
                type="file"
                accept=".json"
                onChange={importTheme}
                style={{ display: 'none' }}
              />
            </div>
            
            {/* Reset button */}
            <button
              type="button"
              onClick={resetTheme}
              style={{ ...styles.buttonDanger, width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>restore</span>
              Reset to Enterprise Defaults
            </button>
          </div>
        </div>

        {/* Multi-column Grid for other settings */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: 24 }}>
          {/* User Management */}
          <div style={styles.panel}>
            <h3 style={{ ...styles.sectionTitle, marginBottom: 20 }}>👥 User Management</h3>
            
            <form onSubmit={handleAddUser} style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 24, padding: 16, background: 'var(--background)', borderRadius: 12 }}>
              <div style={styles.label}>Add New User</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input 
                  placeholder="Username" 
                  value={newUsername} 
                  onChange={e => setNewUsername(e.target.value)}
                  style={{ ...styles.input, flex: 1 }}
                />
                <input 
                  type="password" 
                  placeholder="Password" 
                  value={newPassword} 
                  onChange={e => setNewPassword(e.target.value)}
                  style={{ ...styles.input, flex: 1 }}
                />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <select 
                  value={newRole} 
                  onChange={e => setNewRole(e.target.value)}
                  style={{ ...styles.input, flex: 1 }}
                >
                  <option value="viewer">Viewer (Read Only)</option>
                  <option value="operator">Operator (Run Backups)</option>
                  <option value="admin">Administrator (Full Control)</option>
                </select>
                <button type="submit" style={{ ...styles.buttonPrimary, flex: 0.5 }}>Create</button>
              </div>
              {error && <div style={{ color: colors.danger, fontSize: 12 }}>{error}</div>}
            </form>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={styles.label}>Existing Users</div>
              {users.map(u => (
                <div key={u.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', background: 'var(--background)', borderRadius: 12, border: `1px solid var(--border-whisper)` }}>
                  <div>
                    <div style={{ fontWeight: 700 }}>{u.username}</div>
                    <div style={{ fontSize: 11, color: colors.primary, textTransform: 'uppercase', fontWeight: 800 }}>{u.role}</div>
                  </div>
                  {u.username !== 'admin' && (
                    <button onClick={() => deleteUser(u.id)} style={styles.buttonDanger}>Remove</button>
                  )}
                </div>
              ))}
            </div>
          </div>
          
          {/* Notification Settings */}
          <div style={styles.panel}>
            <h3 style={{ ...styles.sectionTitle, marginBottom: 20 }}>🔔 Notification Settings</h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 16, background: 'var(--background)', borderRadius: 12, border: `1px solid var(--border-whisper)` }}>
              <input 
                type="checkbox" 
                id="notificationsEnabledToggle"
                checked={notificationsEnabled} 
                onChange={handleToggleNotifications} 
                style={{ width: 18, height: 18, cursor: 'pointer' }}
              />
              <label htmlFor="notificationsEnabledToggle" style={{ cursor: 'pointer', fontWeight: 600, color: colors.light, userSelect: 'none' }}>
                Enable pop-up notifications
              </label>
            </div>
            <p style={{ fontSize: 11, color: colors.gray, marginTop: 8 }}>
              When checked, real-time pop-up notifications will be shown in the bottom-right corner when Backups, Healthchecks, or Automations complete.
            </p>
          </div>

          {/* Router Access Gateway & System Settings */}
          <div style={{ ...styles.panel, gridColumn: 'span 2' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
              <div>
                <h3 style={{ ...styles.sectionTitle, margin: 0 }}>🔌 Router Access Gateway & System Settings (.env)</h3>
                <p style={{ fontSize: 11, color: colors.gray, margin: '4px 0 0 0' }}>
                  Configure Jump Host tunneling, default device credentials, Gemini API key, and Fernet backup encryption key. Saved directly to <code>.env</code> and reloaded live.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowSecrets(!showSecrets)}
                style={{
                  padding: '6px 12px',
                  fontSize: 11,
                  background: 'rgba(255,255,255,0.06)',
                  border: '1px solid var(--border-whisper)',
                  color: colors.light,
                  borderRadius: 8,
                  cursor: 'pointer'
                }}
              >
                {showSecrets ? '🙈 Mask Passwords' : '👁️ Show Passwords'}
              </button>
            </div>

            <form onSubmit={handleSaveSystemSettings} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              
              {/* Jump Server Access Toggle Card */}
              <div style={{
                padding: 18,
                background: useJumpServer ? 'rgba(56, 189, 248, 0.06)' : 'rgba(245, 158, 11, 0.06)',
                border: `1px solid ${useJumpServer ? 'rgba(56, 189, 248, 0.3)' : 'rgba(245, 158, 11, 0.3)'}`,
                borderRadius: 14,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: 16
              }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: useJumpServer ? '#38bdf8' : '#f59e0b', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className="material-symbols-outlined" style={{ fontSize: 20 }}>
                      {useJumpServer ? 'lan' : 'router'}
                    </span>
                    {useJumpServer ? 'Jump Server Mode Active (SSH Tunneling)' : 'Direct Router Access Mode Active (Bypass Jump Host)'}
                  </div>
                  <div style={{ fontSize: 11, color: colors.gray, marginTop: 4 }}>
                    {useJumpServer
                      ? 'Router SSH/Telnet connections tunnel through the bastion Jump Host.'
                      : 'Router connections connect directly to target router management IPs over SSH (port 22) or Telnet (port 23).'}
                  </div>
                </div>

                <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', userSelect: 'none' }}>
                  <input
                    type="checkbox"
                    checked={useJumpServer}
                    onChange={(e) => setUseJumpServer(e.target.checked)}
                    style={{ width: 20, height: 20, cursor: 'pointer' }}
                  />
                  <span style={{ fontSize: 12, fontWeight: 700, color: colors.light }}>
                    {useJumpServer ? 'Jump Host Enabled' : 'Direct Connection Mode'}
                  </span>
                </label>
              </div>

              {/* Jump Host Configuration Inputs */}
              {useJumpServer && (
                <div style={{ padding: 16, background: 'var(--background)', borderRadius: 12, border: '1px solid var(--border-whisper)', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
                  <div>
                    <div style={styles.label}>JUMP_HOST</div>
                    <input
                      type="text"
                      placeholder="e.g. 203.0.113.10"
                      value={jumpHost}
                      onChange={(e) => setJumpHost(e.target.value)}
                      style={styles.input}
                    />
                  </div>
                  <div>
                    <div style={styles.label}>JUMP_USER</div>
                    <input
                      type="text"
                      placeholder="Jump Username"
                      value={jumpUser}
                      onChange={(e) => setJumpUser(e.target.value)}
                      style={styles.input}
                    />
                  </div>
                  <div>
                    <div style={styles.label}>JUMP_PASSWORD</div>
                    <input
                      type={showSecrets ? 'text' : 'password'}
                      placeholder="Enter new password to change"
                      value={jumpPass}
                      onChange={(e) => setJumpPass(e.target.value)}
                      style={styles.input}
                    />
                  </div>
                </div>
              )}

              {/* Default Device Credentials & API Keys Grid */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 }}>
                
                {/* Default Device Credentials */}
                <div style={{ padding: 16, background: 'var(--background)', borderRadius: 12, border: '1px solid var(--border-whisper)', display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={{ ...styles.label, fontSize: 12, fontWeight: 700, color: colors.light }}>🔐 Default Router Credentials</div>
                  <div>
                    <div style={styles.label}>DEVICE_USER</div>
                    <input
                      type="text"
                      placeholder="Default Username"
                      value={deviceUser}
                      onChange={(e) => setDeviceUser(e.target.value)}
                      style={styles.input}
                    />
                  </div>
                  <div>
                    <div style={styles.label}>DEVICE_PASS</div>
                    <input
                      type={showSecrets ? 'text' : 'password'}
                      placeholder="Enter new password to change"
                      value={devicePass}
                      onChange={(e) => setDevicePass(e.target.value)}
                      style={styles.input}
                    />
                  </div>
                </div>

                {/* Gemini & Encryption Keys */}
                <div style={{ padding: 16, background: 'var(--background)', borderRadius: 12, border: '1px solid var(--border-whisper)', display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={{ ...styles.label, fontSize: 12, fontWeight: 700, color: colors.light }}>☁️ Gemini API & Fernet Key</div>
                  <div>
                    <div style={styles.label}>GEMINI_API_KEY</div>
                    <input
                      type={showSecrets ? 'text' : 'password'}
                      placeholder="AIzaSy..."
                      value={geminiApiKey}
                      onChange={(e) => setGeminiApiKey(e.target.value)}
                      style={styles.input}
                    />
                  </div>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={styles.label}>ENCRYPTION_KEY (Fernet)</div>
                      <button
                        type="button"
                        onClick={generateFernetKey}
                        style={{ fontSize: 10, padding: '2px 6px', background: 'transparent', border: 'none', color: '#38bdf8', cursor: 'pointer' }}
                      >
                        ⚡ Auto-Generate
                      </button>
                    </div>
                    <input
                      type={showSecrets ? 'text' : 'password'}
                      placeholder="Fernet key string"
                      value={encryptionKey}
                      onChange={(e) => setEncryptionKey(e.target.value)}
                      style={styles.input}
                    />
                  </div>
                </div>

              </div>

              {/* Submit & Status Bar */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 8 }}>
                <button
                  type="submit"
                  disabled={sysLoading}
                  style={{ ...styles.buttonPrimary, padding: '10px 24px', fontSize: 13, fontWeight: 700 }}
                >
                  {sysLoading ? 'Saving to .env...' : '💾 Save System Settings to .env'}
                </button>
                {saveStatus && (
                  <div style={{ fontSize: 12, fontWeight: 600, color: saveStatus.includes('✅') ? 'var(--status-success)' : colors.danger }}>
                    {saveStatus}
                  </div>
                )}
              </div>

            </form>
          </div>

      </div>
    </div>
  </div>
  );
}
