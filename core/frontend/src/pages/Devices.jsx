import React, { useEffect, useState, useRef, useMemo, useCallback } from "react";
import { Link } from "react-router-dom";
import { useTheme } from "../context/ThemeContext";
import { getBadgeStyle } from "../styles";
import { useAuth } from "../context/AuthContext";
import CompareModal from "../components/CompareModal";
import RollbackModal from "../components/RollbackModal";
import RatioCircle from "../components/RatioCircle";

const API = "/api";

export default function Devices() {
  const { styles, theme } = useTheme();
  const { isViewer } = useAuth();
  const { colors } = theme;

  const [devices, setDevices] = useState([]);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const fileInputRef = useRef(null);

  const [selectedForBatch, setSelectedForBatch] = useState(new Set());
  const [batchStatuses, setBatchStatuses] = useState({});
  const [searchQuery, setSearchQuery] = useState("");

  const [filterDeviceType, setFilterDeviceType] = useState("");
  const [filterVendor, setFilterVendor] = useState("");
  const [filterProtocol, setFilterProtocol] = useState("");
  const [filterGroup, setFilterGroup] = useState("");

  const [selectedDevice, setSelectedDevice] = useState(null);
  const [backups, setBackups] = useState([]);
  const [backupsLoading, setBackupsLoading] = useState(false);
  const [fullConfig, setFullConfig] = useState(null);
  const [compareData, setCompareData] = useState(null);
  const [rollbackTarget, setRollbackTarget] = useState(null);

  const [form, setForm] = useState({
    hostname: "", ip_address: "", device_type: "MPLS Switch", vendor: "cisco", protocol: "ssh", port: 22,
  });

  useEffect(() => { fetchDevices(); }, []);

  async function fetchDevices() {
    try {
      const res = await fetch(`${API}/devices`, {
        headers: { 'x-api-key': sessionStorage.getItem('app_password') || '' }
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          setDevices(data);
        } else {
          setDevices([]);
        }
      } else {
        setDevices([]);
      }
    } catch (err) {
      console.error("Error fetching devices:", err);
      setDevices([]);
    }
  }

  const groupOptions = useMemo(() => {
    const groups = new Set();
    devices.forEach(d => {
      if (d.group_file) groups.add(d.group_file);
    });
    return Array.from(groups).sort();
  }, [devices]);

  const filteredDevices = useMemo(() => {
    return devices.filter(d => {
      const matchSearch = d.hostname.toLowerCase().includes(searchQuery.toLowerCase()) || d.ip_address.includes(searchQuery);
      const matchType = filterDeviceType === "" || d.device_type === filterDeviceType;
      const matchVendor = filterVendor === "" || d.vendor === filterVendor || d.vendor.toLowerCase().includes(filterVendor.toLowerCase()) || filterVendor.toLowerCase().includes(d.vendor.toLowerCase());
      const matchProtocol = filterProtocol === "" || d.protocol === filterProtocol;
      const matchGroup = filterGroup === "" || d.group_file === filterGroup;
      return matchSearch && matchType && matchVendor && matchProtocol && matchGroup;
    });
  }, [devices, searchQuery, filterDeviceType, filterVendor, filterProtocol, filterGroup]);

  const activeFilters = filterDeviceType || filterVendor || filterProtocol || filterGroup || searchQuery;

  function clearFilters() {
    setFilterDeviceType("");
    setFilterVendor("");
    setFilterProtocol("");
    setFilterGroup("");
    setSearchQuery("");
  }

  async function openBackupPanel(device, e) {
    if (e) e.stopPropagation();
    if (selectedDevice?.id === device.id) {
      setSelectedDevice(null);
      setBackups([]);
      return;
    }
    setSelectedDevice(device);
    setBackups([]);
    setBackupsLoading(true);
    try {
      const res = await fetch(`${API}/backups/${device.id}`, {
        headers: { 'x-api-key': sessionStorage.getItem('app_password') || '' }
      });
      setBackups(await res.json());
    } catch (err) {
      console.error(err);
    } finally {
      setBackupsLoading(false);
    }
  }

  async function addDevice(e) {
    e.preventDefault();
    const res = await fetch(`${API}/devices`, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        'x-api-key': sessionStorage.getItem('app_password') || ''
      },
      body: JSON.stringify(form),
    });
    if (res.ok) {
      setForm({ hostname: "", ip_address: "", device_type: "MPLS Switch", vendor: "cisco", protocol: "ssh", port: 22 });
      fetchDevices();
    }
  }

  async function deleteDevice(id, e) {
    if (e) e.stopPropagation();
    if (!window.confirm("Are you sure you want to delete this device?")) return;
    const res = await fetch(`${API}/devices/${id}`, { 
      method: "DELETE",
      headers: { 'x-api-key': sessionStorage.getItem('app_password') || '' }
    });
    if (res.ok) fetchDevices();
  }

  async function triggerBatchBackup() {
    if (selectedForBatch.size === 0) return;
    const ids = Array.from(selectedForBatch);
    const initialStatuses = {};
    ids.forEach(id => initialStatuses[id] = 'pending');
    setBatchStatuses(prev => ({ ...prev, ...initialStatuses }));
    
    await Promise.allSettled(ids.map(async (id) => {
      try {
        const res = await fetch(`${API}/backup/${id}`, { 
          method: "POST",
          headers: { 'x-api-key': sessionStorage.getItem('app_password') || '' }
        });
        const d = await res.json();
        setBatchStatuses(prev => ({ ...prev, [id]: d.status }));
      } catch (err) {
        setBatchStatuses(prev => ({ ...prev, [id]: 'failed' }));
      }
    }));
    fetchDevices();
  }

  function selectAllForBatch() {
    if (selectedForBatch.size === filteredDevices.length && filteredDevices.length > 0) {
      setSelectedForBatch(new Set());
    } else {
      setSelectedForBatch(new Set(filteredDevices.map(d => d.id)));
    }
  }

  function toggleInBatch(id, e) {
    if (e) e.stopPropagation();
    const next = new Set(selectedForBatch);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedForBatch(next);
  }

  function openImportPicker() { fileInputRef.current.click(); }

  async function importDevicesExcel(e) {
    const file = e.target.files[0];
    if (!file) return;
    setImporting(true);
    const formData = new FormData();
    formData.append("file", file);
    try {
      const res = await fetch(`${API}/devices/import`, {
        method: "POST",
        headers: { 'x-api-key': sessionStorage.getItem('app_password') || '' },
        body: formData,
      });
      if (res.ok) fetchDevices();
      else alert("Import failed");
    } finally {
      setImporting(false);
      e.target.value = null;
    }
  }

  async function exportDevicesExcel() {
    setExporting(true);
    try {
      const res = await fetch(`${API}/devices/export`, {
        headers: { 'x-api-key': sessionStorage.getItem('app_password') || '' }
      });
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "netact_devices.xlsx";
      a.click();
    } finally {
      setExporting(false);
    }
  }

  async function viewFullConfig(backupId) {
    const res = await fetch(`${API}/backups/${backupId}/full?device_id=${selectedDevice?.id}`, {
      headers: { 'x-api-key': sessionStorage.getItem('app_password') || '' }
    });
    setFullConfig(await res.json());
  }

  const deviceTypeOptions = ["MPLS Switch", "MPLS UPE", "MPLS Router", "ISP", "Core Router", "Edge Router"];
  const vendorOptions = ["cisco", "cisco_xr", "nxos", "juniper", "huawei"];
  const protocolOptions = ["ssh", "telnet"];

  return (
    <div className="modern-dashboard">
      {/* ── Add Device / Management ── */}
      {!isViewer && (
        <div className="chart-card">
          <div className="chart-card-header">
            <h2 className="chart-title">Device Management</h2>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={openImportPicker} className="btn-toggle" style={{ border: "1px solid var(--border-whisper)", borderRadius: 6, padding: "6px 14px" }}>
                {importing ? "Importing..." : "Import Excel"}
              </button>
              <button onClick={exportDevicesExcel} className="btn-toggle" style={{ border: "1px solid var(--border-whisper)", borderRadius: 6, padding: "6px 14px" }}>
                {exporting ? "Exporting..." : "Export Excel"}
              </button>
              <input ref={fileInputRef} type="file" accept=".xlsx,.xls" onChange={importDevicesExcel} style={{ display: 'none' }} />
            </div>
          </div>
          
          <form onSubmit={addDevice} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 16, alignItems: "end", marginTop: 10 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)" }}>Hostname</label>
              <input 
                required 
                placeholder="Hostname" 
                value={form.hostname} 
                onChange={(e) => setForm({ ...form, hostname: e.target.value })} 
                style={{ width: "100%", padding: "10px 12px", border: "1px solid var(--border-whisper)", borderRadius: 8, fontSize: 14, background: "var(--surface)", color: "var(--text-high-contrast)", outline: "none" }} 
              />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)" }}>IP Address</label>
              <input 
                required 
                placeholder="10.0.0.1" 
                value={form.ip_address} 
                onChange={(e) => setForm({ ...form, ip_address: e.target.value })} 
                style={{ width: "100%", padding: "10px 12px", border: "1px solid var(--border-whisper)", borderRadius: 8, fontSize: 14, background: "var(--surface)", color: "var(--text-high-contrast)", outline: "none" }} 
              />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)" }}>Vendor</label>
              <select 
                value={form.vendor} 
                onChange={(e) => setForm({ ...form, vendor: e.target.value })} 
                style={{ width: "100%", padding: "10px 12px", border: "1px solid var(--border-whisper)", borderRadius: 8, fontSize: 14, background: "var(--surface)", color: "var(--text-high-contrast)", outline: "none", cursor: "pointer" }}
              >
                {vendorOptions.map(v => <option key={v} value={v}>{v.toUpperCase()}</option>)}
              </select>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)" }}>Protocol</label>
              <select 
                value={form.protocol} 
                onChange={(e) => setForm({ ...form, protocol: e.target.value })} 
                style={{ width: "100%", padding: "10px 12px", border: "1px solid var(--border-whisper)", borderRadius: 8, fontSize: 14, background: "var(--surface)", color: "var(--text-high-contrast)", outline: "none", cursor: "pointer" }}
              >
                {protocolOptions.map(p => <option key={p} value={p}>{p.toUpperCase()}</option>)}
              </select>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)" }}>Device Type</label>
              <select 
                value={form.device_type} 
                onChange={(e) => setForm({ ...form, device_type: e.target.value })} 
                style={{ width: "100%", padding: "10px 12px", border: "1px solid var(--border-whisper)", borderRadius: 8, fontSize: 14, background: "var(--surface)", color: "var(--text-high-contrast)", outline: "none", cursor: "pointer" }}
              >
                {deviceTypeOptions.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, width: 70 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)" }}>Port</label>
                <input 
                  type="number" 
                  value={form.port} 
                  onChange={(e) => setForm({ ...form, port: e.target.value })} 
                  style={{ width: "100%", padding: "10px 12px", border: "1px solid var(--border-whisper)", borderRadius: 8, fontSize: 14, background: "var(--surface)", color: "var(--text-high-contrast)", outline: "none" }} 
                />
              </div>
              <button 
                type="submit" 
                className="btn-toggle active"
                style={{ flex: 1, height: 42, padding: "0 16px", borderRadius: 8, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>add</span> Add
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ── Filter Bar ── */}
      <div style={{
        display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center",
        padding: "10px 16px", background: "var(--surface-container)",
        border: "1px solid var(--border-whisper)", borderRadius: 8, marginTop: 24, marginBottom: 20
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <label style={{ fontSize: 11, color: "var(--text-muted)" }}>Search</label>
          <input 
            placeholder="Search hostname or IP..." 
            value={searchQuery} 
            onChange={e => setSearchQuery(e.target.value)}
            style={{ fontSize: 12, padding: "5px 9px", borderRadius: 6, border: "1px solid var(--border-whisper)", background: "var(--surface)", color: "var(--text-high-contrast)", outline: "none", width: 180 }}
          />
        </div>
        <div style={{ width: 1, height: 20, background: "var(--border-whisper)", flexShrink: 0 }} />

        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <label style={{ fontSize: 11, color: "var(--text-muted)" }}>Type</label>
          <select 
            value={filterDeviceType} 
            onChange={e => setFilterDeviceType(e.target.value)} 
            style={{ fontSize: 12, padding: "5px 9px", borderRadius: 6, border: "1px solid var(--border-whisper)", background: "var(--surface)", color: "var(--text-high-contrast)", cursor: "pointer" }}
          >
            <option value="">All Types</option>
            {deviceTypeOptions.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div style={{ width: 1, height: 20, background: "var(--border-whisper)", flexShrink: 0 }} />

        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <label style={{ fontSize: 11, color: "var(--text-muted)" }}>Group</label>
          <select 
            value={filterGroup} 
            onChange={e => setFilterGroup(e.target.value)} 
            style={{ fontSize: 12, padding: "5px 9px", borderRadius: 6, border: "1px solid var(--border-whisper)", background: "var(--surface)", color: "var(--text-high-contrast)", cursor: "pointer" }}
          >
            <option value="">All Groups</option>
            {groupOptions.map(g => <option key={g} value={g}>{g}</option>)}
          </select>
        </div>
        <div style={{ width: 1, height: 20, background: "var(--border-whisper)", flexShrink: 0 }} />

        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <label style={{ fontSize: 11, color: "var(--text-muted)" }}>Vendor</label>
          <select 
            value={filterVendor} 
            onChange={e => setFilterVendor(e.target.value)} 
            style={{ fontSize: 12, padding: "5px 9px", borderRadius: 6, border: "1px solid var(--border-whisper)", background: "var(--surface)", color: "var(--text-high-contrast)", cursor: "pointer" }}
          >
            <option value="">All Vendors</option>
            {vendorOptions.map(v => <option key={v} value={v}>{v.toUpperCase()}</option>)}
          </select>
        </div>
        <div style={{ width: 1, height: 20, background: "var(--border-whisper)", flexShrink: 0 }} />

        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <label style={{ fontSize: 11, color: "var(--text-muted)" }}>Protocol</label>
          <select 
            value={filterProtocol} 
            onChange={e => setFilterProtocol(e.target.value)} 
            style={{ fontSize: 12, padding: "5px 9px", borderRadius: 6, border: "1px solid var(--border-whisper)", background: "var(--surface)", color: "var(--text-high-contrast)", cursor: "pointer" }}
          >
            <option value="">All Protocols</option>
            {protocolOptions.map(p => <option key={p} value={p}>{p.toUpperCase()}</option>)}
          </select>
        </div>

        {activeFilters && (
          <>
            <div style={{ width: 1, height: 20, background: "var(--border-whisper)", flexShrink: 0 }} />
            <button onClick={clearFilters} className="btn-toggle" style={{ border: "1px solid var(--border-whisper)", borderRadius: 6, padding: "5px 13px" }}>
              ✕ Clear
            </button>
          </>
        )}
      </div>

      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", alignItems: "flex-start" }}>
        <div className="chart-card" style={{ flex: "1 1 600px", minWidth: "300px" }}>
          <div className="chart-card-header">
            <h2 className="chart-title">Inventory ({filteredDevices.length})</h2>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={selectAllForBatch} className="btn-toggle" style={{ border: "1px solid var(--border-whisper)", borderRadius: 6 }}>
                {selectedForBatch.size === filteredDevices.length ? "Deselect All" : "Select All"}
              </button>
              {!isViewer && (
                <button 
                  onClick={triggerBatchBackup} 
                  className="btn-toggle active" 
                  disabled={selectedForBatch.size === 0}
                  style={{ display: "flex", alignItems: "center", gap: 4 }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 13 }}>cloud_upload</span>
                  Batch Backup ({selectedForBatch.size})
                </button>
              )}
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {filteredDevices.map(d => {
              const isSelected = selectedDevice?.id === d.id;
              const batchStatus = batchStatuses[d.id];
              return (
                <div 
                  key={d.id} 
                  onClick={(e) => openBackupPanel(d, e)} 
                  style={{ 
                    padding: 16, 
                    borderRadius: 6, 
                    border: isSelected ? "1px solid var(--primary-accent)" : "1px solid var(--border-whisper)", 
                    background: isSelected ? "rgba(99, 102, 241, 0.08)" : "var(--surface)", 
                    cursor: "pointer", 
                    transition: "all 0.2s ease" 
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: 'center' }}>
                    <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                      {!isViewer && (
                        <input 
                          type="checkbox" 
                          checked={selectedForBatch.has(d.id)} 
                          onChange={(e) => toggleInBatch(d.id, e)} 
                          onClick={e => e.stopPropagation()} 
                          style={{ cursor: "pointer" }}
                        />
                      )}
                      <div>
                        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "var(--text-high-contrast)" }}>{d.hostname}</h3>
                        <div className="text-mono" style={{ marginTop: 2, color: "var(--text-muted)" }}>{d.ip_address}</div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      {batchStatus && (
                        <span 
                          style={{ 
                            fontSize: 10,
                            fontWeight: 700,
                            padding: "3px 8px",
                            borderRadius: 4,
                            backgroundColor: batchStatus === 'pending' ? 'rgba(245, 158, 11, 0.15)' : batchStatus === 'success' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                            color: batchStatus === 'pending' ? 'var(--status-warning)' : batchStatus === 'success' ? 'var(--status-success)' : 'var(--status-danger)'
                          }}
                        >
                          {batchStatus === 'pending' ? 'Running...' : batchStatus.toUpperCase()}
                        </span>
                      )}
                      <span style={{ fontSize: 11, fontWeight: 600, padding: "3px 8px", borderRadius: 4, background: "rgba(16, 185, 129, 0.15)", color: "var(--status-success)" }}>{d.group_file || 'No Group'}</span>
                      <span style={{ fontSize: 11, fontWeight: 600, padding: "3px 8px", borderRadius: 4, background: "rgba(255, 255, 255, 0.05)", border: "1px solid var(--border-whisper)", color: "var(--text-high-contrast)" }}>{d.vendor.toUpperCase()}</span>
                      <span style={{ fontSize: 11, fontWeight: 600, padding: "3px 8px", borderRadius: 4, background: "rgba(255, 255, 255, 0.05)", border: "1px solid var(--border-whisper)", color: "var(--text-high-contrast)" }}>{d.device_type}</span>
                      {!isViewer && (
                        <button 
                          onClick={(e) => deleteDevice(d.id, e)} 
                          className="btn-toggle" 
                          style={{ border: "1px solid rgba(239, 68, 68, 0.25)", background: "rgba(239, 68, 68, 0.05)", color: "var(--status-danger)", padding: "4px 8px", borderRadius: 4 }}
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Slide-out Backup Detail Panel Drawer ── */}
        <div 
          className={`drawer-backdrop ${selectedDevice ? 'open' : ''}`} 
          onClick={() => setSelectedDevice(null)} 
        />
        
        <div className={`slide-drawer ${selectedDevice ? 'open' : ''}`}>
          {selectedDevice && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                <h3 className="chart-title">{selectedDevice.hostname} Backups</h3>
                <button onClick={() => setSelectedDevice(null)} className="btn-toggle" style={{ border: "1px solid var(--border-whisper)", borderRadius: 6, padding: "4px 8px" }}>✕</button>
              </div>

              {backupsLoading ? (
                <div style={{ color: "var(--text-muted)", fontSize: 13, textAlign: "center", padding: 24 }}>Loading backups...</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 12, overflowY: "auto", flex: 1, paddingRight: 4 }} className="scrollbar-thin">
                  {backups.slice(0, 5).map(b => (
                    <div key={b.id} style={{ padding: 14, borderRadius: 6, border: "1px solid var(--border-whisper)", background: "var(--surface)" }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                        <span 
                          style={{
                            fontSize: 10,
                            fontWeight: 700,
                            padding: "3px 8px",
                            borderRadius: 4,
                            backgroundColor: b.status === 'success' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                            color: b.status === 'success' ? 'var(--status-success)' : 'var(--status-danger)'
                          }}
                        >
                          {b.status.toUpperCase()}
                        </span>
                        <span className="text-mono" style={{ fontSize: 11, color: "var(--text-muted)" }}>{new Date(b.collected_at).toLocaleString()}</span>
                      </div>
                      <pre className="text-mono" style={{ margin: 0, padding: 10, borderRadius: 4, background: "var(--background-deep)", color: "var(--primary)", fontSize: 11, overflowX: "auto", maxHeight: 100, border: "1px solid var(--border-whisper)" }}>{b.preview}</pre>
                      <div style={{ display: 'flex', gap: 8, marginTop: 10, justifyContent: 'flex-end' }}>
                        <button onClick={() => viewFullConfig(b.id)} className="btn-toggle" style={{ border: "1px solid var(--border-whisper)", borderRadius: 4 }}>View</button>
                        <button onClick={() => setCompareData({ id1: b.id })} className="btn-toggle active" style={{ borderRadius: 4 }}>Compare</button>
                      </div>
                    </div>
                  ))}
                  {backups.length === 0 && (
                    <div style={{ border: "1px dashed var(--border-whisper)", borderRadius: 8, padding: 24, textAlign: "center", color: "var(--text-muted)" }}>No backups found.</div>
                  )}
                  <Link 
                    to={`/device/${selectedDevice.id}/backups`} 
                    className="btn-toggle active"
                    style={{ textDecoration: 'none', textAlign: 'center', marginTop: 12, padding: "8px 16px", borderRadius: 6, display: "block" }}
                  >
                    View Full History
                  </Link>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {fullConfig && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(2, 6, 23, 0.85)", backdropFilter: "blur(8px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, zIndex: 1000 }} onClick={() => setFullConfig(null)}>
          <div className="chart-card" style={{ width: "min(1200px, 92vw)", maxHeight: "85vh", overflow: "hidden", display: "flex", flexDirection: "column" }} onClick={e => e.stopPropagation()}>
            <div className="chart-card-header" style={{ borderBottom: "1px solid var(--border-whisper)", paddingBottom: 16, marginBottom: 16 }}>
              <h3 className="chart-title">Config Backup — #{fullConfig.id}</h3>
              <button onClick={() => setFullConfig(null)} className="btn-toggle" style={{ border: "1px solid var(--border-whisper)", borderRadius: 6, padding: "4px 8px" }}>✕</button>
            </div>
            <div style={{ overflowY: "auto", flex: 1 }}>
              <pre className="text-mono" style={{ margin: 0, padding: 14, borderRadius: 6, background: "var(--background-deep)", color: "var(--primary)", fontSize: 12, lineHeight: 1.55, overflowX: "auto" }}>{fullConfig.config_text}</pre>
            </div>
          </div>
        </div>
      )}

      {compareData && (
        <CompareModal
          collectionType="backup"
          initialId1={compareData.id1}
          deviceName={selectedDevice?.hostname}
          deviceId={selectedDevice?.id}
          onClose={() => setCompareData(null)}
        />
      )}
    </div>
  );
}
