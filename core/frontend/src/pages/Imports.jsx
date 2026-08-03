import React, { useState, useEffect } from 'react';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';

const API = "/api";

export default function Imports() {
  const { styles, theme } = useTheme();
  const { colors } = theme;
  const { isViewer } = useAuth();

  const [commandsFiles, setCommandsFiles] = useState([]);
  const [devicesFiles, setDevicesFiles] = useState([]);
  const [eoleosFiles, setEoleosFiles] = useState([]);
  
  // Loading states
  const [commandsLoading, setCommandsLoading] = useState(false);
  const [devicesLoading, setDevicesLoading] = useState(false);
  const [eoleosLoading, setEoleosLoading] = useState(false);
  const [commandsUploading, setCommandsUploading] = useState(false);
  const [devicesUploading, setDevicesUploading] = useState(false);
  const [eoleosUploading, setEoleosUploading] = useState(false);

  // Selected file states for uploads
  const [selectedCommandsFile, setSelectedCommandsFile] = useState(null);
  const [selectedDevicesFile, setSelectedDevicesFile] = useState(null);
  const [selectedEoleosFile, setSelectedEoleosFile] = useState(null);

  // Status message states for uploads
  const [commandsStatus, setCommandsStatus] = useState(null); 
  const [devicesStatus, setDevicesStatus] = useState(null);
  const [eoleosStatus, setEoleosStatus] = useState(null);

  // Drag and drop highlights
  const [commandsDragActive, setCommandsDragActive] = useState(false);
  const [devicesDragActive, setDevicesDragActive] = useState(false);
  const [eoleosDragActive, setEoleosDragActive] = useState(false);

  // Clipboard copy state
  const [copiedPath, setCopiedPath] = useState("");

  // ==========================================
  // New States for View, Edit, and Delete
  // ==========================================
  const [activeEditorFile, setActiveEditorFile] = useState(null); // { name, type: 'commands'|'devices'|'eoleos' }
  const [editorContent, setEditorContent] = useState("");
  const [editorLoading, setEditorLoading] = useState(false);
  const [editorSaving, setEditorSaving] = useState(false);
  const [editorError, setEditorError] = useState(null);

  const [activeDeleteFile, setActiveDeleteFile] = useState(null); // { name, type: 'commands'|'devices'|'eoleos' }
  const [deleteConfirming, setDeleteConfirming] = useState(false);

  useEffect(() => {
    fetchCommands();
    fetchDevicesFiles();
    fetchEoleosFiles();
  }, []);

  async function fetchCommands() {
    setCommandsLoading(true);
    try {
      const res = await fetch(`${API}/commands`, { 
        headers: { 'x-api-key': sessionStorage.getItem('app_password') || '' } 
      });
      if (res.ok) {
        setCommandsFiles(await res.json());
      }
    } catch (e) {
      console.error("Error fetching commands files:", e);
    } finally {
      setCommandsLoading(false);
    }
  }

  async function fetchDevicesFiles() {
    setDevicesLoading(true);
    try {
      const res = await fetch(`${API}/devices-files`, { 
        headers: { 'x-api-key': sessionStorage.getItem('app_password') || '' } 
      });
      if (res.ok) {
        setDevicesFiles(await res.json());
      }
    } catch (e) {
      console.error("Error fetching devices files:", e);
    } finally {
      setDevicesLoading(false);
    }
  }

  async function fetchEoleosFiles() {
    setEoleosLoading(true);
    try {
      const res = await fetch(`${API}/eoleos-files`, { 
        headers: { 'x-api-key': sessionStorage.getItem('app_password') || '' } 
      });
      if (res.ok) {
        setEoleosFiles(await res.json());
      }
    } catch (e) {
      console.error("Error fetching EOL/EOS files:", e);
    } finally {
      setEoleosLoading(false);
    }
  }

  const handleCommandsDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setCommandsDragActive(true);
    } else if (e.type === "dragleave") {
      setCommandsDragActive(false);
    }
  };

  const handleCommandsDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setCommandsDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      if (file.name.endsWith('.txt')) {
        setSelectedCommandsFile(file);
        setCommandsStatus(null);
      } else {
        setCommandsStatus({ type: 'error', text: 'Only .txt command files are allowed!' });
      }
    }
  };

  const handleDevicesDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDevicesDragActive(true);
    } else if (e.type === "dragleave") {
      setDevicesDragActive(false);
    }
  };

  const handleDevicesDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDevicesDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      if (file.name.endsWith('.yaml') || file.name.endsWith('.yml')) {
        setSelectedDevicesFile(file);
        setDevicesStatus(null);
      } else {
        setDevicesStatus({ type: 'error', text: 'Only .yaml or .yml device configurations are allowed!' });
      }
    }
  };

  const handleCommandsUpload = async () => {
    if (!selectedCommandsFile) return;
    setCommandsUploading(true);
    setCommandsStatus(null);

    const formData = new FormData();
    formData.append("file", selectedCommandsFile);

    try {
      const res = await fetch(`${API}/commands/upload`, {
        method: "POST",
        headers: { 'x-api-key': sessionStorage.getItem('app_password') || '' },
        body: formData
      });
      const data = await res.json();
      if (res.ok) {
        setCommandsStatus({ type: 'success', text: `Successfully uploaded ${data.name}!` });
        setSelectedCommandsFile(null);
        fetchCommands();
      } else {
        setCommandsStatus({ type: 'error', text: data.detail || 'Upload failed!' });
      }
    } catch (e) {
      setCommandsStatus({ type: 'error', text: 'Network error. Upload failed!' });
    } finally {
      setCommandsUploading(false);
    }
  };

  const handleDevicesUpload = async () => {
    if (!selectedDevicesFile) return;
    setDevicesUploading(true);
    setDevicesStatus(null);

    const formData = new FormData();
    formData.append("file", selectedDevicesFile);

    try {
      const res = await fetch(`${API}/devices/upload`, {
        method: "POST",
        headers: { 'x-api-key': sessionStorage.getItem('app_password') || '' },
        body: formData
      });
      const data = await res.json();
      if (res.ok) {
        setDevicesStatus({ 
          type: 'success', 
          text: `Successfully uploaded ${data.name}! Registered ${data.devices_found} devices under ${data.groups_found.length} groups.` 
        });
        setSelectedDevicesFile(null);
        fetchDevicesFiles();
      } else {
        setDevicesStatus({ type: 'error', text: data.detail || 'Upload failed!' });
      }
    } catch (e) {
      setDevicesStatus({ type: 'error', text: 'Network error. Upload failed!' });
    } finally {
      setDevicesUploading(false);
    }
  };

  const handleEoleosDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setEoleosDragActive(true);
    } else if (e.type === "dragleave") {
      setEoleosDragActive(false);
    }
  };

  const handleEoleosDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setEoleosDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      if (file.name.endsWith('.yaml') || file.name.endsWith('.yml')) {
        setSelectedEoleosFile(file);
        setEoleosStatus(null);
      } else {
        setEoleosStatus({ type: 'error', text: 'Only .yaml or .yml files are allowed!' });
      }
    }
  };

  const handleEoleosUpload = async () => {
    if (!selectedEoleosFile) return;
    setEoleosUploading(true);
    setEoleosStatus(null);

    const formData = new FormData();
    formData.append("file", selectedEoleosFile);

    try {
      const res = await fetch(`${API}/eoleos/upload`, {
        method: "POST",
        headers: { 'x-api-key': sessionStorage.getItem('app_password') || '' },
        body: formData
      });
      const data = await res.json();
      if (res.ok) {
        setEoleosStatus({ type: 'success', text: `Successfully uploaded ${data.name}!` });
        setSelectedEoleosFile(null);
        fetchEoleosFiles();
      } else {
        setEoleosStatus({ type: 'error', text: data.detail || 'Upload failed!' });
      }
    } catch (e) {
      setEoleosStatus({ type: 'error', text: 'Network error. Upload failed!' });
    } finally {
      setEoleosUploading(false);
    }
  };

  const copyToClipboard = (path) => {
    navigator.clipboard.writeText(path);
    setCopiedPath(path);
    setTimeout(() => setCopiedPath(""), 2000);
  };

  const formatSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = 2;
    const sizes = ['Bytes', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  };

  // ==========================================
  // File CRUD Operations
  // ==========================================
  
  // Open editor and load file content
  const openEditor = async (filename, type) => {
    setActiveEditorFile({ name: filename, type });
    setEditorContent("");
    setEditorLoading(true);
    setEditorError(null);
    setEditorSaving(false);

    const endpoint = type === 'commands' 
      ? `${API}/commands/${filename}/content`
      : type === 'devices'
      ? `${API}/devices-files/${filename}/content`
      : `${API}/eoleos-files/${filename}/content`;

    try {
      const res = await fetch(endpoint, {
        headers: { 'x-api-key': sessionStorage.getItem('app_password') || '' }
      });
      const data = await res.json();
      if (res.ok) {
        setEditorContent(data.content);
      } else {
        setEditorError(data.detail || "Failed to load file contents.");
      }
    } catch (e) {
      setEditorError("Network error. Failed to load file contents.");
    } finally {
      setEditorLoading(false);
    }
  };

  // Save changes from editor
  const saveEditorContent = async () => {
    if (!activeEditorFile) return;
    setEditorSaving(true);
    setEditorError(null);

    const endpoint = activeEditorFile.type === 'commands' 
      ? `${API}/commands/${activeEditorFile.name}/content`
      : activeEditorFile.type === 'devices'
      ? `${API}/devices-files/${activeEditorFile.name}/content`
      : `${API}/eoleos-files/${activeEditorFile.name}/content`;

    try {
      const res = await fetch(endpoint, {
        method: "PUT",
        headers: { 
          'Content-Type': 'application/json',
          'x-api-key': sessionStorage.getItem('app_password') || '' 
        },
        body: JSON.stringify({ content: editorContent })
      });
      const data = await res.json();
      if (res.ok) {
        // Success
        setActiveEditorFile(null);
        if (activeEditorFile.type === 'commands') {
          fetchCommands();
        } else if (activeEditorFile.type === 'devices') {
          fetchDevicesFiles();
        } else {
          fetchEoleosFiles();
        }
      } else {
        setEditorError(data.detail || "Failed to save file.");
      }
    } catch (e) {
      setEditorError("Network error. Failed to save file.");
    } finally {
      setEditorSaving(false);
    }
  };

  // Prompt delete
  const promptDelete = (filename, type) => {
    setActiveDeleteFile({ name: filename, type });
  };

  // Confirm delete
  const confirmDelete = async () => {
    if (!activeDeleteFile) return;
    setDeleteConfirming(true);

    const endpoint = activeDeleteFile.type === 'commands'
      ? `${API}/commands/${activeDeleteFile.name}`
      : activeDeleteFile.type === 'devices'
      ? `${API}/devices-files/${activeDeleteFile.name}`
      : `${API}/eoleos-files/${activeDeleteFile.name}`;

    try {
      const res = await fetch(endpoint, {
        method: "DELETE",
        headers: { 'x-api-key': sessionStorage.getItem('app_password') || '' }
      });
      if (res.ok) {
        setActiveDeleteFile(null);
        if (activeDeleteFile.type === 'commands') {
          fetchCommands();
        } else if (activeDeleteFile.type === 'devices') {
          fetchDevicesFiles();
        } else {
          fetchEoleosFiles();
        }
      } else {
        const data = await res.json();
        alert(data.detail || "Failed to delete file.");
      }
    } catch (e) {
      alert("Network error. Failed to delete file.");
    } finally {
      setDeleteConfirming(false);
    }
  };

  if (isViewer) {
    return <div style={styles.errorState}>Access Denied. Admins and Operators only.</div>;
  }

  // Common premium drop zone style
  const getDropZoneStyle = (isActive, selectedFile) => ({
    border: `2px dashed ${isActive ? colors.primary : "var(--border-whisper)"}`,
    borderRadius: '16px',
    padding: '24px 32px',
    textAlign: 'center',
    background: isActive ? `${colors.primary}10` : "var(--surface-solid)",
    cursor: 'pointer',
    transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '12px',
    minHeight: '160px',
    boxShadow: isActive ? `0 0 16px ${colors.primary}30` : 'none',
  });

  return (
    <div style={styles.container}>
      <div style={{ marginBottom: 32 }}>
        <h1 style={styles.title}>📤 Import Configuration Center</h1>
        <p style={styles.subtitle}>Upload, view, edit, or delete command scripts (.txt) and device profiles (.yaml) directly in the system directory.</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(480px, 1fr))', gap: 32 }}>
        
        {/* Commands Card */}
        <div style={styles.panel}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
            <span style={{ fontSize: 28 }}>🩺</span>
            <h3 style={styles.sectionTitle}>Healthcheck Command Scripts</h3>
          </div>
          
          {/* Dropzone */}
          <div 
            style={getDropZoneStyle(commandsDragActive, selectedCommandsFile)}
            onDragEnter={handleCommandsDrag}
            onDragOver={handleCommandsDrag}
            onDragLeave={handleCommandsDrag}
            onDrop={handleCommandsDrop}
            onClick={() => document.getElementById('commands-input').click()}
          >
            <input 
              id="commands-input" 
              type="file" 
              accept=".txt" 
              onChange={(e) => {
                if (e.target.files && e.target.files[0]) {
                  setSelectedCommandsFile(e.target.files[0]);
                  setCommandsStatus(null);
                }
              }} 
              style={{ display: 'none' }} 
            />
            <span style={{ fontSize: 36 }}>📁</span>
            {selectedCommandsFile ? (
              <div>
                <div style={{ fontWeight: 700, color: colors.primary }}>{selectedCommandsFile.name}</div>
                <div style={{ fontSize: 12, color: colors.gray, marginTop: 4 }}>{formatSize(selectedCommandsFile.size)}</div>
              </div>
            ) : (
              <div>
                <div style={{ fontWeight: 600, color: colors.light }}>Drag & drop commands file here</div>
                <div style={{ fontSize: 12, color: colors.gray, marginTop: 4 }}>or click to browse from computer (.txt)</div>
              </div>
            )}
          </div>

          {/* Action Row */}
          {selectedCommandsFile && (
            <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
              <button 
                onClick={handleCommandsUpload} 
                disabled={commandsUploading}
                style={{ ...styles.buttonPrimary, flex: 1, padding: '12px' }}
              >
                {commandsUploading ? 'Uploading...' : 'Save Command Script'}
              </button>
              <button 
                onClick={() => setSelectedCommandsFile(null)} 
                disabled={commandsUploading}
                style={styles.buttonSecondary}
              >
                Cancel
              </button>
            </div>
          )}

          {/* Alert statuses */}
          {commandsStatus && (
            <div style={{ 
              marginTop: 16, 
              padding: '12px 16px', 
              borderRadius: '12px', 
              fontSize: 13,
              fontWeight: 500,
              background: commandsStatus.type === 'success' ? `${colors.success}15` : `${colors.danger}15`,
              color: commandsStatus.type === 'success' ? colors.success : colors.danger,
              border: `1px solid ${commandsStatus.type === 'success' ? colors.success : colors.danger}`
            }}>
              {commandsStatus.text}
            </div>
          )}

          {/* Listing */}
          <div style={{ marginTop: 32 }}>
            <h4 style={{ ...styles.label, marginBottom: 12, fontSize: 14 }}>Active Command Scripts in Directory</h4>
            {commandsLoading ? (
              <div style={{ color: colors.gray, fontSize: 13 }}>Loading command files...</div>
            ) : commandsFiles.length === 0 ? (
              <div style={{ color: colors.gray, fontSize: 13, fontStyle: 'italic' }}>No command scripts uploaded yet.</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${styles.border}`, textAlign: 'left' }}>
                      <th style={{ padding: '8px 4px', color: colors.gray }}>Filename</th>
                      <th style={{ padding: '8px 4px', color: colors.gray }}>Size</th>
                      <th style={{ padding: '8px 4px', color: colors.gray, textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {commandsFiles.map(file => (
                      <tr key={file.name} style={{ borderBottom: `1px solid ${styles.border}30` }}>
                        <td style={{ padding: '12px 4px', fontWeight: 600, color: colors.light }}>
                          {file.name}
                        </td>
                        <td style={{ padding: '12px 4px', color: colors.gray }}>
                          {formatSize(file.size)}
                        </td>
                        <td style={{ padding: '12px 4px', textAlign: 'right', display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                          <button 
                            onClick={() => copyToClipboard(file.path)} 
                            style={{ 
                              ...styles.buttonSecondary, 
                              padding: '6px 10px', 
                              fontSize: 11,
                              borderColor: copiedPath === file.path ? colors.success : styles.border,
                              color: copiedPath === file.path ? colors.success : colors.light
                            }}
                          >
                            {copiedPath === file.path ? '✓ Copied' : '📋 Path'}
                          </button>
                          <button 
                            onClick={() => openEditor(file.name, 'commands')}
                            style={{ ...styles.buttonSecondary, padding: '6px 10px', fontSize: 11, color: colors.primary, borderColor: `${colors.primary}40` }}
                          >
                            📝 Edit
                          </button>
                          <button 
                            onClick={() => promptDelete(file.name, 'commands')}
                            style={{ ...styles.buttonDanger, padding: '6px 10px', fontSize: 11 }}
                          >
                            🗑️
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Devices YAML Card */}
        <div style={styles.panel}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
            <span style={{ fontSize: 28 }}>📋</span>
            <h3 style={styles.sectionTitle}>Device Profiles (YAML Configs)</h3>
          </div>

          {/* Dropzone */}
          <div 
            style={getDropZoneStyle(devicesDragActive, selectedDevicesFile)}
            onDragEnter={handleDevicesDrag}
            onDragOver={handleDevicesDrag}
            onDragLeave={handleDevicesDrag}
            onDrop={handleDevicesDrop}
            onClick={() => document.getElementById('devices-input').click()}
          >
            <input 
              id="devices-input" 
              type="file" 
              accept=".yaml,.yml" 
              onChange={(e) => {
                if (e.target.files && e.target.files[0]) {
                  setSelectedDevicesFile(e.target.files[0]);
                  setDevicesStatus(null);
                }
              }} 
              style={{ display: 'none' }} 
            />
            <span style={{ fontSize: 36 }}>📝</span>
            {selectedDevicesFile ? (
              <div>
                <div style={{ fontWeight: 700, color: colors.primary }}>{selectedDevicesFile.name}</div>
                <div style={{ fontSize: 12, color: colors.gray, marginTop: 4 }}>{formatSize(selectedDevicesFile.size)}</div>
              </div>
            ) : (
              <div>
                <div style={{ fontWeight: 600, color: colors.light }}>Drag & drop YAML file here</div>
                <div style={{ fontSize: 12, color: colors.gray, marginTop: 4 }}>or click to browse from computer (.yaml, .yml)</div>
              </div>
            )}
          </div>

          {/* Action Row */}
          {selectedDevicesFile && (
            <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
              <button 
                onClick={handleDevicesUpload} 
                disabled={devicesUploading}
                style={{ ...styles.buttonPrimary, flex: 1, padding: '12px' }}
              >
                {devicesUploading ? 'Importing & Parsing...' : 'Import Device YAML'}
              </button>
              <button 
                onClick={() => setSelectedDevicesFile(null)} 
                disabled={devicesUploading}
                style={styles.buttonSecondary}
              >
                Cancel
              </button>
            </div>
          )}

          {/* Alert statuses */}
          {devicesStatus && (
            <div style={{ 
              marginTop: 16, 
              padding: '12px 16px', 
              borderRadius: '12px', 
              fontSize: 13,
              fontWeight: 500,
              background: devicesStatus.type === 'success' ? `${colors.success}15` : `${colors.danger}15`,
              color: devicesStatus.type === 'success' ? colors.success : colors.danger,
              border: `1px solid ${devicesStatus.type === 'success' ? colors.success : colors.danger}`
            }}>
              {devicesStatus.text}
            </div>
          )}

          {/* Listing */}
          <div style={{ marginTop: 32 }}>
            <h4 style={{ ...styles.label, marginBottom: 12, fontSize: 14 }}>Active Configuration Files in Directory</h4>
            {devicesLoading ? (
              <div style={{ color: colors.gray, fontSize: 13 }}>Loading device configurations...</div>
            ) : devicesFiles.length === 0 ? (
              <div style={{ color: colors.gray, fontSize: 13, fontStyle: 'italic' }}>No configuration files uploaded yet.</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${styles.border}`, textAlign: 'left' }}>
                      <th style={{ padding: '8px 4px', color: colors.gray }}>Filename</th>
                      <th style={{ padding: '8px 4px', color: colors.gray }}>Size</th>
                      <th style={{ padding: '8px 4px', color: colors.gray, textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {devicesFiles.map(file => (
                      <tr key={file.name} style={{ borderBottom: `1px solid ${styles.border}30` }}>
                        <td style={{ padding: '12px 4px', fontWeight: 600, color: colors.light }}>
                          {file.name}
                        </td>
                        <td style={{ padding: '12px 4px', color: colors.gray }}>
                          {formatSize(file.size)}
                        </td>
                        <td style={{ padding: '12px 4px', textAlign: 'right', display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                          <button 
                            onClick={() => openEditor(file.name, 'devices')}
                            style={{ ...styles.buttonSecondary, padding: '6px 10px', fontSize: 11, color: colors.primary, borderColor: `${colors.primary}40` }}
                          >
                            📝 Edit
                          </button>
                          <button 
                            onClick={() => promptDelete(file.name, 'devices')}
                            style={{ ...styles.buttonDanger, padding: '6px 10px', fontSize: 11 }}
                          >
                            🗑️ Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* EOL & EOS Card */}
        <div style={styles.panel}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
            <span style={{ fontSize: 28 }}>📅</span>
            <h3 style={styles.sectionTitle}>EOL & EOS Definitions (YAML)</h3>
          </div>

          {/* Dropzone */}
          <div 
            style={getDropZoneStyle(eoleosDragActive, selectedEoleosFile)}
            onDragEnter={handleEoleosDrag}
            onDragOver={handleEoleosDrag}
            onDragLeave={handleEoleosDrag}
            onDrop={handleEoleosDrop}
            onClick={() => document.getElementById('eoleos-input').click()}
          >
            <input 
              id="eoleos-input" 
              type="file" 
              accept=".yaml,.yml" 
              onChange={(e) => {
                if (e.target.files && e.target.files[0]) {
                  setSelectedEoleosFile(e.target.files[0]);
                  setEoleosStatus(null);
                }
              }} 
              style={{ display: 'none' }} 
            />
            <span style={{ fontSize: 36 }}>📋</span>
            {selectedEoleosFile ? (
              <div>
                <div style={{ fontWeight: 700, color: colors.primary }}>{selectedEoleosFile.name}</div>
                <div style={{ fontSize: 12, color: colors.gray, marginTop: 4 }}>{formatSize(selectedEoleosFile.size)}</div>
              </div>
            ) : (
              <div>
                <div style={{ fontWeight: 600, color: colors.light }}>Drag & drop EOL/EOS YAML here</div>
                <div style={{ fontSize: 12, color: colors.gray, marginTop: 4 }}>or click to browse from computer (.yaml, .yml)</div>
              </div>
            )}
          </div>

          {/* Action Row */}
          {selectedEoleosFile && (
            <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
              <button 
                onClick={handleEoleosUpload} 
                disabled={eoleosUploading}
                style={{ ...styles.buttonPrimary, flex: 1, padding: '12px' }}
              >
                {eoleosUploading ? 'Importing & Parsing...' : 'Import EOL/EOS YAML'}
              </button>
              <button 
                onClick={() => setSelectedEoleosFile(null)} 
                disabled={eoleosUploading}
                style={styles.buttonSecondary}
              >
                Cancel
              </button>
            </div>
          )}

          {/* Alert statuses */}
          {eoleosStatus && (
            <div style={{ 
              marginTop: 16, 
              padding: '12px 16px', 
              borderRadius: '12px', 
              fontSize: 13,
              fontWeight: 500,
              background: eoleosStatus.type === 'success' ? `${colors.success}15` : `${colors.danger}15`,
              color: eoleosStatus.type === 'success' ? colors.success : colors.danger,
              border: `1px solid ${eoleosStatus.type === 'success' ? colors.success : colors.danger}`
            }}>
              {eoleosStatus.text}
            </div>
          )}

          {/* Listing */}
          <div style={{ marginTop: 32 }}>
            <h4 style={{ ...styles.label, marginBottom: 12, fontSize: 14 }}>Active EOL/EOS Definition Files in Directory</h4>
            {eoleosLoading ? (
              <div style={{ color: colors.gray, fontSize: 13 }}>Loading EOL/EOS configurations...</div>
            ) : eoleosFiles.length === 0 ? (
              <div style={{ color: colors.gray, fontSize: 13, fontStyle: 'italic' }}>No configuration files uploaded yet.</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${styles.border}`, textAlign: 'left' }}>
                      <th style={{ padding: '8px 4px', color: colors.gray }}>Filename</th>
                      <th style={{ padding: '8px 4px', color: colors.gray }}>Size</th>
                      <th style={{ padding: '8px 4px', color: colors.gray, textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {eoleosFiles.map(file => (
                      <tr key={file.name} style={{ borderBottom: `1px solid ${styles.border}30` }}>
                        <td style={{ padding: '12px 4px', fontWeight: 600, color: colors.light }}>
                          {file.name}
                        </td>
                        <td style={{ padding: '12px 4px', color: colors.gray }}>
                          {formatSize(file.size)}
                        </td>
                        <td style={{ padding: '12px 4px', textAlign: 'right', display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                          <button 
                            onClick={() => copyToClipboard(file.path)} 
                            style={{ 
                              ...styles.buttonSecondary, 
                              padding: '6px 10px', 
                              fontSize: 11,
                              borderColor: copiedPath === file.path ? colors.success : styles.border,
                              color: copiedPath === file.path ? colors.success : colors.light
                            }}
                          >
                            {copiedPath === file.path ? '✓ Copied' : '📋 Path'}
                          </button>
                          <button 
                            onClick={() => openEditor(file.name, 'eoleos')}
                            style={{ ...styles.buttonSecondary, padding: '6px 10px', fontSize: 11, color: colors.primary, borderColor: `${colors.primary}40` }}
                          >
                            📝 Edit
                          </button>
                          <button 
                            onClick={() => promptDelete(file.name, 'eoleos')}
                            style={{ ...styles.buttonDanger, padding: '6px 10px', fontSize: 11 }}
                          >
                            🗑️ Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

      </div>

      {/* ===================================================================== */}
      {/* 📝 FILE EDIT MODAL */}
      {/* ===================================================================== */}
      {activeEditorFile && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.7)',
          backdropFilter: 'blur(8px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          padding: '24px'
        }}>
          <div style={{
            ...styles.panel,
            width: '100%',
            maxWidth: '900px',
            maxHeight: '90vh',
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
            boxShadow: '0 24px 48px rgba(0,0,0,0.5)',
            border: `1px solid ${styles.border}`
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: `1px solid ${styles.border}40`, paddingBottom: 12 }}>
              <div>
                <h3 style={{ ...styles.sectionTitle, margin: 0 }}>
                  📝 Editing {activeEditorFile.name}
                </h3>
                <span style={{ fontSize: 11, color: colors.primary, textTransform: 'uppercase', fontWeight: 700 }}>
                  {activeEditorFile.type === 'commands' ? 'Command Check Script (.txt)' : 'Device Inventory Configurations (.yaml)'}
                </span>
              </div>
              <button 
                onClick={() => setActiveEditorFile(null)} 
                style={{ ...styles.buttonSecondary, padding: '6px 12px', border: 'none', background: 'transparent', fontSize: 18, color: colors.gray }}
              >
                ✕
              </button>
            </div>

            {editorLoading ? (
              <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '300px', color: colors.gray }}>
                Loading file content...
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, flex: 1 }}>
                
                {editorError && (
                  <div style={{ 
                    padding: '12px 16px', 
                    borderRadius: '12px', 
                    fontSize: 13,
                    fontWeight: 500,
                    background: `${colors.danger}15`,
                    color: colors.danger,
                    border: `1px solid ${colors.danger}`
                  }}>
                    <strong>Save Error:</strong> {editorError}
                  </div>
                )}

                <textarea
                  value={editorContent}
                  onChange={(e) => setEditorContent(e.target.value)}
                  style={{
                    width: '100%',
                    height: '450px',
                    fontFamily: '"Fira Code", Monaco, Consolas, "Courier New", monospace',
                    fontSize: '13px',
                    lineHeight: '1.6',
                    padding: '16px',
                    background: 'var(--surface-solid)',
                    color: colors.light,
                    border: "1px solid var(--border-whisper)",
                    borderRadius: '12px',
                    outline: 'none',
                    resize: 'vertical',
                    whiteSpace: 'pre',
                    tabSize: 4
                  }}
                  placeholder={activeEditorFile.type === 'commands' 
                    ? "# Enter commands (one per line)\nshow version\nshow ip interface brief" 
                    : "# Enter device inventory configuration\njump_server:\n  ip: 10.0.0.1\n\ngroups:\n..."}
                />

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, borderTop: "1px solid var(--border-whisper)", paddingTop: 16 }}>
                  <button 
                    onClick={() => setActiveEditorFile(null)} 
                    disabled={editorSaving}
                    style={styles.buttonSecondary}
                  >
                    Cancel
                  </button>
                  <button 
                    onClick={saveEditorContent} 
                    disabled={editorSaving}
                    style={{ ...styles.buttonPrimary, padding: '10px 24px' }}
                  >
                    {editorSaving ? 'Saving Changes...' : 'Save File'}
                  </button>
                </div>

              </div>
            )}
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* 🗑️ FILE DELETE CONFIRMATION OVERLAY */}
      {/* ===================================================================== */}
      {activeDeleteFile && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.8)',
          backdropFilter: 'blur(6px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000
        }}>
          <div style={{
            ...styles.panel,
            width: '100%',
            maxWidth: '500px',
            textAlign: 'center',
            padding: '32px',
            boxShadow: '0 24px 48px rgba(0,0,0,0.6)',
            border: `1px solid ${colors.danger}40`
          }}>
            <span style={{ fontSize: 50, marginBottom: 16, display: 'block' }}>⚠️</span>
            <h3 style={{ ...styles.sectionTitle, color: colors.danger, marginBottom: 12 }}>
              Are you sure?
            </h3>
            <p style={{ color: colors.light, fontSize: 14, marginBottom: 8, lineHeight: 1.5 }}>
              You are about to delete <strong style={{ color: colors.primary }}>{activeDeleteFile.name}</strong> permanently.
            </p>
            
            {activeDeleteFile.type === 'devices' && (
              <p style={{ color: colors.danger, fontSize: 12, background: `${colors.danger}15`, padding: 12, borderRadius: 8, margin: '16px 0', border: `1px solid ${colors.danger}30` }}>
                <strong>Important:</strong> Deleting this file will automatically reload the devices registry. All groups and devices associated with it will disappear from your inventory immediately.
              </p>
            )}

            <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 24 }}>
              <button 
                onClick={() => setActiveDeleteFile(null)} 
                disabled={deleteConfirming}
                style={styles.buttonSecondary}
              >
                Cancel
              </button>
              <button 
                onClick={confirmDelete}
                disabled={deleteConfirming}
                style={{ ...styles.buttonDanger, padding: '10px 24px' }}
              >
                {deleteConfirming ? 'Deleting...' : 'Yes, Delete File'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
