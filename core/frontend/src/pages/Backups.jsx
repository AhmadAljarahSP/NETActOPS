import React, { useEffect, useState, useMemo, useCallback } from "react";
import { Link } from "react-router-dom";
import { useTheme } from "../context/ThemeContext";
import { getBadgeStyle } from "../styles";
import { useAuth } from "../context/AuthContext";
import CompareModal from "../components/CompareModal";
import RollbackModal from "../components/RollbackModal";
import {
  PieChart, Pie, Cell, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip as ChartTooltip, Legend
} from "recharts";

const API = "/api";

const escapeHtml = (str) => {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
};

// Recharts Custom Tooltip Helper
const CustomTooltip = ({ active, payload, label, colors, themeColors, styles }) => {
  if (!active || !payload?.length) return null;
  const activeColors = colors || themeColors || {};
  const activeStyles = styles || {};
  return (
    <div style={{
      background: activeStyles.panel?.background || "rgba(15, 23, 42, 0.95)",
      border: `1.5px solid ${activeColors.border || "#334155"}`,
      borderRadius: 10, padding: "10px 14px", fontSize: 12,
      boxShadow: "0 10px 25px rgba(0,0,0,0.3)",
      color: activeColors.light || "#f8fafc"
    }}>
      {label && <div style={{ fontWeight: 700, marginBottom: 6, color: activeColors.light || "#f8fafc" }}>{label}</div>}
      {payload.map((p, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, opacity: 0.9, color: activeColors.light || "#f8fafc" }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: p.fill || p.color, display: "inline-block" }} />
          {p.name}: <strong style={{ marginLeft: "auto", color: activeColors.light || "#f8fafc" }}>{p.value}</strong>
        </div>
      ))}
    </div>
  );
};

// Recharts Donut Center Label Component
const DonutCenter = ({ total, label, colors }) => (
  <div style={{
    position: "absolute", top: "52%", left: "50%",
    transform: "translate(-50%,-50%)", textAlign: "center", pointerEvents: "none"
  }}>
    <div style={{ fontSize: 22, fontWeight: 800, color: colors.light, lineHeight: 1 }}>{total}</div>
    <div style={{ fontSize: 10, color: colors.gray, marginTop: 4, textTransform: "uppercase", letterSpacing: "0.5px" }}>{label}</div>
  </div>
);

/* ─── Chart Mode Toggle Component ─── */
const ModeToggle = ({ modes, current, onChange }) => (
  <div style={{ display: "flex", gap: 3, background: 'var(--background-deep)', padding: 3, borderRadius: 8 }} className="no-print">
    {modes.map(m => (
      <button key={m.value} onClick={() => onChange(m.value)} style={{
        padding: "4px 8px", fontSize: 10, border: "none", borderRadius: 6, cursor: "pointer",
        fontFamily: "inherit", display: "flex", alignItems: "center", gap: 4,
        background: current === m.value ? 'var(--primary)' : "transparent",
        color: current === m.value ? "#fff" : 'var(--text-muted)',
        fontWeight: current === m.value ? 700 : 500, transition: "all .15s"
      }}>
        {m.icon} {m.label}
      </button>
    ))}
  </div>
);

const CHART_MODES = [
  { value: "donut", label: "Donut", icon: "◎" },
  { value: "pie", label: "Pie", icon: "◕" },
  { value: "bar-v", label: "Bar V", icon: "▥" },
  { value: "bar-h", label: "Bar H", icon: "▤" },
];

export default function Backups() {
  const { config, styles, theme } = useTheme();
  const { isViewer } = useAuth();
  const { colors } = theme;
  const isDark = config.mode === "dark";

  const [devices, setDevices] = useState([]);
  const [deviceGroups, setDeviceGroups] = useState([]);
  const [deviceTypes, setDeviceTypes] = useState([]);
  const [selectedGroup, setSelectedGroup] = useState("");
  const [selectedType, setSelectedType] = useState("");
  const [quickFilter, setQuickFilter] = useState("all"); // 'all', 'never', 'success', 'failed', 'drift'

  const [selectedDevice, setSelectedDevice] = useState(null);
  const [loading, setLoading] = useState(false);
  const [reloading, setReloading] = useState(false);

  const [selectedForBatch, setSelectedForBatch] = useState(new Set());
  const [batchStatuses, setBatchStatuses] = useState(() => {
    try {
      const saved = localStorage.getItem("running_backups");
      if (saved) {
        const parsed = JSON.parse(saved);
        const now = Date.now();
        const initial = {};
        let updated = false;
        
        for (const [id, startTime] of Object.entries(parsed)) {
          if (now - startTime < 120000) {
            initial[id] = 'pending';
          } else {
            updated = true;
          }
        }
        if (updated) {
          const clean = {};
          for (const [id, startTime] of Object.entries(parsed)) {
            if (now - startTime < 120000) clean[id] = startTime;
          }
          localStorage.setItem("running_backups", JSON.stringify(clean));
        }
        return initial;
      }
    } catch (e) {}
    return {};
  });
  const [searchQuery, setSearchQuery] = useState("");
  const [fullConfig, setFullConfig] = useState(null);

  const [compareData, setCompareData] = useState(null);
  const [rollbackTarget, setRollbackTarget] = useState(null);
  
  // Gold Standard Baseline modal states
  const [goldStandardModal, setGoldStandardModal] = useState(null);
  const [deviceHistory, setDeviceHistory] = useState([]);
  const [selectedBaselineId, setSelectedBaselineId] = useState("");
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Pagination states
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10); // 10, 50, 100, 'all'

  // Collapsible Dashboard Toggles
  const [dashboardOpen, setDashboardOpen] = useState(true);
  const [dashboardMaximized, setDashboardMaximized] = useState(false);
  const [stripMode, setStripMode] = useState("on"); // 'on' | 'off'

  // Charts type states
  const [distChartMode, setDistChartMode] = useState("donut"); // donut, pie, bar-v, bar-h
  const [vendorChartMode, setVendorChartMode] = useState("bar-v");
  const [groupChartMode, setGroupChartMode] = useState("bar-h");

  // Spreadsheet filter inputs
  const [filterName, setFilterName] = useState("");
  const [filterIp, setFilterIp] = useState("");
  const [filterModel, setFilterModel] = useState("");
  const [filterGroup, setFilterGroup] = useState("");
  const [filterConnection, setFilterConnection] = useState("");
  const [filterUpdates, setFilterUpdates] = useState("");
  const [filterChanged, setFilterChanged] = useState("");
  const [filterVendor, setFilterVendor] = useState("");

  // Modal configuration search states
  const [modalSearchTerm, setModalSearchTerm] = useState("");
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState("");
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
  const [totalMatches, setTotalMatches] = useState(0);
  const [tooManyMatches, setTooManyMatches] = useState(false);
  const [modalFullScreen, setModalFullScreen] = useState(false);

  useEffect(() => {
    fetchSummaryDevices();
    fetchDeviceGroups();
    fetchDeviceTypes();
  }, []);

  // When search or filter changes, reset to first page
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, selectedGroup, selectedType, quickFilter, itemsPerPage, filterName, filterIp, filterModel, filterGroup, filterConnection, filterUpdates, filterChanged, filterVendor]);

  useEffect(() => {
    const pendingIds = Object.keys(batchStatuses).filter(id => batchStatuses[id] === 'pending');
    if (pendingIds.length === 0) return;

    const interval = setInterval(() => {
      fetchSummaryDevices();
    }, 5000);

    return () => clearInterval(interval);
  }, [batchStatuses]);

  const checkPendingCompletions = (freshDevicesList) => {
    try {
      const savedStr = localStorage.getItem("running_backups");
      if (!savedStr) return;
      const parsed = JSON.parse(savedStr);
      const now = Date.now();
      let updated = false;
      const clean = { ...parsed };
      
      freshDevicesList.forEach(d => {
        const startTime = parsed[d.id];
        if (startTime) {
          if (now - startTime > 120000) {
            delete clean[d.id];
            setBatchStatuses(prev => {
              const copy = { ...prev };
              delete copy[d.id];
              return copy;
            });
            updated = true;
            return;
          }
          
          const summary = d.backup_summary || {};
          const lastBackup = summary.last_backup;
          if (lastBackup && lastBackup.collected_at) {
            const completionTime = new Date(lastBackup.collected_at).getTime();
            if (completionTime > startTime - 5000) {
              delete clean[d.id];
              const statusVal = lastBackup.status === 'success' ? 'success' : 'failed';
              setBatchStatuses(prev => ({ 
                ...prev, 
                [d.id]: statusVal 
              }));
              updated = true;
              
              window.dispatchEvent(new CustomEvent('netact-notification', {
                detail: {
                  type: 'backup',
                  status: statusVal,
                  title: 'Backup Completed',
                  message: `Backup for ${d.hostname} ${statusVal === 'success' ? 'succeeded' : 'failed'}.`,
                  targetUrl: `/backup/device/${d.id}`
                }
              }));
            }
          }
        }
      });
      
      if (updated) {
        localStorage.setItem("running_backups", JSON.stringify(clean));
      }
    } catch (e) {
      console.error("Error checking pending completions:", e);
    }
  };

  async function fetchSummaryDevices() {
    setLoading(true);
    try {
      const res = await fetch(`${API}/devices/backups-summary`, { 
        headers: { 'x-api-key': sessionStorage.getItem('app_password') || '' } 
      });
      if (res.ok) {
        const data = await res.json();
        setDevices(data);
        checkPendingCompletions(data);
      }
    } catch (err) { 
      console.error("Error fetching summary:", err); 
    } finally {
      setLoading(false);
    }
  }

  async function fetchDeviceGroups() {
    try {
      const res = await fetch(`${API}/device-groups`, { 
        headers: { 'x-api-key': sessionStorage.getItem('app_password') || '' } 
      });
      if (res.ok) setDeviceGroups(await res.json());
    } catch (e) { 
      console.error(e); 
    }
  }

  async function fetchDeviceTypes() {
    try {
      const res = await fetch(`${API}/device-types`, { 
        headers: { 'x-api-key': sessionStorage.getItem('app_password') || '' } 
      });
      if (res.ok) setDeviceTypes(await res.json());
    } catch (e) { 
      console.error(e); 
    }
  }

  async function triggerBackup(id, e) {
    if (e) e.stopPropagation();
    setBatchStatuses(prev => ({ ...prev, [id]: 'pending' }));
    try {
      const saved = localStorage.getItem("running_backups");
      const parsed = saved ? JSON.parse(saved) : {};
      parsed[id] = Date.now();
      localStorage.setItem("running_backups", JSON.stringify(parsed));
    } catch (err) {}
    try {
      const res = await fetch(`${API}/backup/${id}`, {
        method: "POST",
        headers: { 'x-api-key': sessionStorage.getItem('app_password') || '' }
      });
      const data = await res.json();
      const statusVal = data.status === 'success' ? 'success' : 'failed';
      setBatchStatuses(prev => ({ ...prev, [id]: statusVal }));
      try {
        const saved = localStorage.getItem("running_backups");
        if (saved) {
          const parsed = JSON.parse(saved);
          delete parsed[id];
          localStorage.setItem("running_backups", JSON.stringify(parsed));
        }
      } catch (err) {}
      fetchSummaryDevices();

      const dev = devices.find(d => d.id === id);
      const hostname = dev?.hostname || `Device #${id}`;
      window.dispatchEvent(new CustomEvent('netact-notification', {
        detail: {
          type: 'backup',
          status: statusVal,
          title: 'Backup Completed',
          message: `Backup for ${hostname} ${statusVal === 'success' ? 'succeeded' : 'failed'}.`,
          targetUrl: `/backup/device/${id}`
        }
      }));
    } catch (err) {
      setBatchStatuses(prev => ({ ...prev, [id]: 'failed' }));
      try {
        const saved = localStorage.getItem("running_backups");
        if (saved) {
          const parsed = JSON.parse(saved);
          delete parsed[id];
          localStorage.setItem("running_backups", JSON.stringify(parsed));
        }
      } catch (err) {}

      const dev = devices.find(d => d.id === id);
      const hostname = dev?.hostname || `Device #${id}`;
      window.dispatchEvent(new CustomEvent('netact-notification', {
        detail: {
          type: 'backup',
          status: 'failed',
          title: 'Backup Failed',
          message: `Backup execution failed for ${hostname}.`,
          targetUrl: `/backup/device/${id}`
        }
      }));
    }
  }

  async function triggerBatchBackup() {
    if (selectedForBatch.size === 0) return;
    const ids = Array.from(selectedForBatch);
    const initialStatuses = {};
    ids.forEach(id => { initialStatuses[id] = 'pending'; });
    setBatchStatuses(prev => ({ ...prev, ...initialStatuses }));
    await Promise.allSettled(ids.map(id => triggerBackup(id)));
  }

  async function triggerBatchZIP() {
    if (selectedForBatch.size === 0) return;
    try {
      const res = await fetch(`${API}/backup/group/export`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          'x-api-key': sessionStorage.getItem('app_password') || ''
        },
        body: JSON.stringify({ device_ids: Array.from(selectedForBatch) })
      });
      if (res.ok) {
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `netact_backups_batch_${new Date().toISOString().slice(0,10)}.zip`;
        a.click();
        window.URL.revokeObjectURL(url);
      } else {
        alert("Batch export failed");
      }
    } catch (err) {
      console.error("Export error:", err);
    }
  }

  async function reloadDevicesFromYaml() {
    setReloading(true);
    try {
      await fetch(`${API}/devices/reload`, {
        method: "POST",
        headers: { 'x-api-key': sessionStorage.getItem('app_password') || '' }
      });
      fetchSummaryDevices();
    } finally { 
      setReloading(false); 
    }
  }

  function toggleBatchSelection(id, e) {
    if (e) e.stopPropagation();
    const newSet = new Set(selectedForBatch);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    setSelectedForBatch(newSet);
  }

  function selectAllFiltered(filteredList) {
    if (selectedForBatch.size === filteredList.length && filteredList.length > 0) {
      setSelectedForBatch(new Set());
    } else {
      setSelectedForBatch(new Set(filteredList.map(d => d.id)));
    }
  }

  async function viewFull(backupId, device) {
    setSelectedDevice(device);
    try {
      const res = await fetch(`${API}/collections/${backupId}/full?collection_type=backup&device_id=${device.id}`, {
        headers: { 'x-api-key': sessionStorage.getItem('app_password') || '' }
      });
      if (res.ok) {
        setFullConfig(await res.json());
      }
    } catch (err) {
      console.error(err);
    }
  }

  const downloadConfig = useCallback(async (backupId, device) => {
    setSelectedDevice(device);
    try {
      const res = await fetch(`${API}/backups/${backupId}/full?device_id=${device.id}`, {
        headers: { 'x-api-key': sessionStorage.getItem('app_password') || '' }
      });
      if (res.ok) {
        const data = await res.json();
        const blob = new Blob([data?.config_text || ""], { type: "text/plain;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${device.hostname.replace(/[^\w.-]+/g, "_")}-backup-${backupId}.txt`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch (err) { 
      console.error(err); 
    }
  }, []);

  // Gold Standard Baseline modal
  async function openGoldStandardModal(device, e) {
    if (e) e.stopPropagation();
    setGoldStandardModal(device);
    setSelectedBaselineId(device.backup_summary?.gold_standard?.id || "");
    setLoadingHistory(true);
    try {
      const res = await fetch(`${API}/collections/${device.id}?collection_type=backup`, {
        headers: { 'x-api-key': sessionStorage.getItem('app_password') || '' }
      });
      if (res.ok) {
        const history = await res.json();
        setDeviceHistory(history.filter(h => h.status === "success"));
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingHistory(false);
    }
  }

  async function saveBaseline() {
    if (!goldStandardModal) return;
    try {
      const res = await fetch(`${API}/backup/${goldStandardModal.id}/gold-standard`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          'x-api-key': sessionStorage.getItem('app_password') || ''
        },
        body: JSON.stringify({ backup_id: selectedBaselineId || null })
      });
      if (res.ok) {
        setGoldStandardModal(null);
        fetchSummaryDevices();
      }
    } catch (err) {
      console.error(err);
    }
  }

  // Reset modal search state when fullConfig changes (modal opens/closes or switches device/version)
  useEffect(() => {
    setModalSearchTerm("");
    setDebouncedSearchTerm("");
    setTotalMatches(0);
    setCurrentMatchIndex(0);
    setTooManyMatches(false);
    setModalFullScreen(false);
  }, [fullConfig]);

  // Trigger search on Enter key or when cleared
  const handleSearchKeyDown = (e) => {
    if (e.key === 'Enter') {
      setDebouncedSearchTerm(modalSearchTerm);
    }
  };

  useEffect(() => {
    if (modalSearchTerm === "") {
      setDebouncedSearchTerm("");
    }
  }, [modalSearchTerm]);

  // Compute matches and search indexing from debounced term
  useEffect(() => {
    setCurrentMatchIndex(0);
    setTooManyMatches(false);
    if (!debouncedSearchTerm.trim() || !fullConfig?.config_text) {
      setTotalMatches(0);
      return;
    }
    const escaped = debouncedSearchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escaped, 'gi');
    const matches = fullConfig.config_text.match(regex);
    const count = matches ? matches.length : 0;
    setTotalMatches(count);

    if (count > 1000 || (fullConfig.config_text.length > 200000 && debouncedSearchTerm.length < 2)) {
      setTooManyMatches(true);
    }
  }, [debouncedSearchTerm, fullConfig]);

  const scrollToMatch = (index, prefix = 'bu-match') => {
    const el = document.getElementById(`${prefix}-${index}`);
    if (el) {
      let parent = el.parentElement;
      while (parent && parent !== document.body) {
        const style = window.getComputedStyle(parent);
        const isScrollable = style.overflowY === 'auto' || style.overflowY === 'scroll';
        if (isScrollable && parent.tagName !== 'PRE' && parent.scrollHeight > parent.clientHeight) {
          break;
        }
        parent = parent.parentElement;
      }
      if (parent && parent !== document.body) {
        const parentRect = parent.getBoundingClientRect();
        const elRect = el.getBoundingClientRect();
        const scrollTop = parent.scrollTop + (elRect.top - parentRect.top) - (parentRect.height / 2) + (elRect.height / 2);
        try {
          parent.scrollTo({ top: scrollTop, behavior: 'smooth' });
        } catch (err) {
          parent.scrollTop = scrollTop;
        }
      } else {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  };

  const HighlightText = useCallback((text, highlight) => {
    if (!highlight.trim()) return escapeHtml(text);
    const escapedHighlight = highlight.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${escapedHighlight})`, 'gi');
    const parts = text.split(regex);
    let matchIdx = 0;
    
    const htmlParts = parts.map((part) => {
      if (part.toLowerCase() === highlight.toLowerCase()) {
        const idx = matchIdx++;
        return `<mark id="bu-match-${idx}" class="bu-match" style="background-color: #ffc107; color: #000; padding: 0 2px; border-radius: 2px; transition: all 0.15s;">${escapeHtml(part)}</mark>`;
      }
      return escapeHtml(part);
    });
    
    return htmlParts.join('');
  }, []);

  const highlightedHtml = useMemo(() => {
    if (debouncedSearchTerm && !tooManyMatches && fullConfig?.config_text) {
      return HighlightText(fullConfig.config_text, debouncedSearchTerm);
    }
    if (fullConfig?.config_text) {
      return HighlightText(fullConfig.config_text, "");
    }
    return "";
  }, [debouncedSearchTerm, tooManyMatches, fullConfig]);

  useEffect(() => {
    // 1. Reset any previously active match styling
    const activeElements = document.querySelectorAll('.bu-match-active');
    activeElements.forEach(el => {
      el.classList.remove('bu-match-active');
      el.style.backgroundColor = '#ffc107';
      el.style.boxShadow = '';
      el.style.fontWeight = 'normal';
    });

    // 2. Set the current match styling
    if (debouncedSearchTerm && totalMatches > 0 && !tooManyMatches) {
      const el = document.getElementById(`bu-match-${currentMatchIndex}`);
      if (el) {
        el.classList.add('bu-match-active');
        el.style.backgroundColor = '#ff9800';
        el.style.boxShadow = '0 0 0 2px rgba(255,255,255,0.5)';
        el.style.fontWeight = 'bold';
      }

      // 3. Scroll to the current match
      const timer = setTimeout(() => {
        scrollToMatch(currentMatchIndex, 'bu-match');
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [currentMatchIndex, debouncedSearchTerm, totalMatches, tooManyMatches, highlightedHtml]);

  // Column auto-extraction options
  const modelOptions = useMemo(() => {
    const set = new Set(devices.map(d => d.device_type).filter(Boolean));
    return Array.from(set).sort();
  }, [devices]);

  const groupOptions = useMemo(() => {
    const set = new Set(devices.map(d => d.group).filter(Boolean));
    return Array.from(set).sort();
  }, [devices]);

  const connectionOptions = useMemo(() => {
    const set = new Set(devices.map(d => `${d.protocol}:${d.port}`).filter(Boolean));
    return Array.from(set).sort();
  }, [devices]);

  const vendorOptions = useMemo(() => {
    const set = new Set(devices.map(d => d.vendor).filter(Boolean));
    return Array.from(set).sort();
  }, [devices]);

  // Master filter computation (Search bar + groups + cards + columns)
  const filteredAndQuickFilteredDevices = useMemo(() => {
    return devices.filter(d => {
      // 1. Text Search matching
      const matchSearch = d.hostname.toLowerCase().includes(searchQuery.toLowerCase()) || d.ip_address.includes(searchQuery);
      
      // 2. Dropdown Group Filters matching
      const matchGroup = !selectedGroup || d.group_file === selectedGroup;
      const matchType = !selectedType || d.device_type === selectedType;
      
      if (!matchSearch || !matchGroup || !matchType) return false;

      // 3. Column-specific filters matching
      if (filterName && !d.hostname.toLowerCase().includes(filterName.toLowerCase())) return false;
      if (filterIp && !d.ip_address.includes(filterIp)) return false;
      if (filterModel && d.device_type !== filterModel) return false;
      if (filterGroup && d.group !== filterGroup) return false;
      if (filterConnection && `${d.protocol}:${d.port}` !== filterConnection) return false;
      if (filterVendor && !d.vendor?.toLowerCase().includes(filterVendor.toLowerCase())) return false;
      
      if (filterUpdates) {
        const status = d.backup_summary?.last_backup?.status;
        if (filterUpdates === "success" && status !== "success") return false;
        if (filterUpdates === "failed" && status !== "failed") return false;
        if (filterUpdates === "never" && d.backup_summary?.last_backup !== null && d.backup_summary?.last_backup !== undefined) return false;
      }
      
      if (filterChanged) {
        const lastChanged = d.backup_summary?.last_changed;
        if (filterChanged === "never" && lastChanged) return false;
        if (filterChanged === "changed" && !lastChanged) return false;
        
        if (lastChanged) {
          const changedTime = new Date(lastChanged.collected_at).getTime();
          const now = new Date().getTime();
          const oneDay = 24 * 60 * 60 * 1000;
          if (filterChanged === "24h" && (now - changedTime) > oneDay) return false;
          if (filterChanged === "7d" && (now - changedTime) > 7 * oneDay) return false;
        }
      }

      // 4. Quick preset stats-cards filter matching
      const summary = d.backup_summary || {};
      if (quickFilter === "success") {
        return summary.last_backup?.status === "success";
      }
      if (quickFilter === "failed") {
        return summary.last_backup?.status === "failed";
      }
      if (quickFilter === "never") {
        return !summary.last_backup;
      }
      if (quickFilter === "drift") {
        return summary.is_compliant === false;
      }
      return true; // 'all'
    });
  }, [devices, searchQuery, selectedGroup, selectedType, quickFilter, filterName, filterIp, filterModel, filterGroup, filterConnection, filterUpdates, filterChanged, filterVendor]);

  // Quick stats card counts (dynamic based on raw list)
  const statsCounts = useMemo(() => {
    let success = 0;
    let failed = 0;
    let never = 0;
    let drift = 0;

    devices.forEach(d => {
      const summary = d.backup_summary || {};
      const status = summary.last_backup?.status;
      if (status === "success") success++;
      else if (status === "failed") failed++;
      else never++;

      if (summary.is_compliant === false) drift++;
    });

    return {
      all: devices.length,
      success,
      failed,
      never,
      drift
    };
  }, [devices]);

  // =========================================================================
  // GOLD-STANDARD CROSS-FILTERING ALGORITHM FOR DYNAMIC DASHBOARD DRAWER CHARTS
  // =========================================================================
  
  // Unify all charts to depend on current filters.
  // To keep the clicked chart stable (not collapse to 100% when clicked), 
  // we filter by everything EXCEPT the filter that chart governs.
  
  // 1. Backup Distribution devices (Filters by everything EXCEPT filterUpdates / quickFilter)
  const distChartDevices = useMemo(() => {
    return devices.filter(d => {
      const matchSearch = d.hostname.toLowerCase().includes(searchQuery.toLowerCase()) || d.ip_address.includes(searchQuery);
      const matchGroup = !selectedGroup || d.group_file === selectedGroup;
      const matchType = !selectedType || d.device_type === selectedType;
      if (!matchSearch || !matchGroup || !matchType) return false;
      
      if (filterName && !d.hostname.toLowerCase().includes(filterName.toLowerCase())) return false;
      if (filterIp && !d.ip_address.includes(filterIp)) return false;
      if (filterModel && d.device_type !== filterModel) return false;
      if (filterGroup && d.group !== filterGroup) return false;
      if (filterConnection && `${d.protocol}:${d.port}` !== filterConnection) return false;
      if (filterVendor && !d.vendor?.toLowerCase().includes(filterVendor.toLowerCase())) return false;
      if (filterChanged) {
        const lastChanged = d.backup_summary?.last_changed;
        if (filterChanged === "never" && lastChanged) return false;
        if (filterChanged === "changed" && !lastChanged) return false;
        if (lastChanged) {
          const changedTime = new Date(lastChanged.collected_at).getTime();
          const now = new Date().getTime();
          const oneDay = 24 * 60 * 60 * 1000;
          if (filterChanged === "24h" && (now - changedTime) > oneDay) return false;
          if (filterChanged === "7d" && (now - changedTime) > 7 * oneDay) return false;
        }
      }
      return true;
    });
  }, [devices, searchQuery, selectedGroup, selectedType, filterName, filterIp, filterModel, filterGroup, filterConnection, filterVendor, filterChanged]);

  const distChartData = useMemo(() => {
    let success = 0;
    let failed = 0;
    let never = 0;
    distChartDevices.forEach(d => {
      const status = d.backup_summary?.last_backup?.status;
      if (status === "success") success++;
      else if (status === "failed") failed++;
      else never++;
    });
    return [
      { name: "Success", value: success, fill: colors.success },
      { name: "Failed", value: failed, fill: colors.danger },
      { name: "Never Backed Up", value: never, fill: colors.gray }
    ];
  }, [distChartDevices, colors]);

  const distChartTotal = useMemo(() => distChartData.reduce((sum, item) => sum + item.value, 0), [distChartData]);

  // 2. Vendor Share devices (Filters by everything EXCEPT filterVendor)
  const vendorChartDevices = useMemo(() => {
    return devices.filter(d => {
      const matchSearch = d.hostname.toLowerCase().includes(searchQuery.toLowerCase()) || d.ip_address.includes(searchQuery);
      const matchGroup = !selectedGroup || d.group_file === selectedGroup;
      const matchType = !selectedType || d.device_type === selectedType;
      if (!matchSearch || !matchGroup || !matchType) return false;
      
      if (filterName && !d.hostname.toLowerCase().includes(filterName.toLowerCase())) return false;
      if (filterIp && !d.ip_address.includes(filterIp)) return false;
      if (filterModel && d.device_type !== filterModel) return false;
      if (filterGroup && d.group !== filterGroup) return false;
      if (filterConnection && `${d.protocol}:${d.port}` !== filterConnection) return false;
      if (filterUpdates) {
        const status = d.backup_summary?.last_backup?.status;
        if (filterUpdates === "success" && status !== "success") return false;
        if (filterUpdates === "failed" && status !== "failed") return false;
        if (filterUpdates === "never" && d.backup_summary?.last_backup !== null && d.backup_summary?.last_backup !== undefined) return false;
      }
      if (filterChanged) {
        const lastChanged = d.backup_summary?.last_changed;
        if (filterChanged === "never" && lastChanged) return false;
        if (filterChanged === "changed" && !lastChanged) return false;
        if (lastChanged) {
          const changedTime = new Date(lastChanged.collected_at).getTime();
          const now = new Date().getTime();
          const oneDay = 24 * 60 * 60 * 1000;
          if (filterChanged === "24h" && (now - changedTime) > oneDay) return false;
          if (filterChanged === "7d" && (now - changedTime) > 7 * oneDay) return false;
        }
      }
      return true;
    });
  }, [devices, searchQuery, selectedGroup, selectedType, filterName, filterIp, filterModel, filterGroup, filterConnection, filterUpdates, filterChanged]);

  const vendorChartData = useMemo(() => {
    const vendors = {};
    vendorChartDevices.forEach(d => {
      const v = (d.vendor || "unknown").toUpperCase();
      if (!vendors[v]) vendors[v] = { name: v, success: 0, failed: 0, never: 0, value: 0 };
      const status = d.backup_summary?.last_backup?.status;
      if (status === "success") vendors[v].success++;
      else if (status === "failed") vendors[v].failed++;
      else vendors[v].never++;
      vendors[v].value++;
    });
    return Object.values(vendors);
  }, [vendorChartDevices]);

  const vendorChartTotal = useMemo(() => vendorChartData.reduce((sum, item) => sum + item.value, 0), [vendorChartData]);

  // 3. Group Coverage devices (Filters by everything EXCEPT filterGroup / selectedGroup)
  const groupChartDevices = useMemo(() => {
    return devices.filter(d => {
      const matchSearch = d.hostname.toLowerCase().includes(searchQuery.toLowerCase()) || d.ip_address.includes(searchQuery);
      const matchType = !selectedType || d.device_type === selectedType;
      if (!matchSearch || !matchType) return false;
      
      if (filterName && !d.hostname.toLowerCase().includes(filterName.toLowerCase())) return false;
      if (filterIp && !d.ip_address.includes(filterIp)) return false;
      if (filterModel && d.device_type !== filterModel) return false;
      if (filterConnection && `${d.protocol}:${d.port}` !== filterConnection) return false;
      if (filterVendor && !d.vendor?.toLowerCase().includes(filterVendor.toLowerCase())) return false;
      if (filterUpdates) {
        const status = d.backup_summary?.last_backup?.status;
        if (filterUpdates === "success" && status !== "success") return false;
        if (filterUpdates === "failed" && status !== "failed") return false;
        if (filterUpdates === "never" && d.backup_summary?.last_backup !== null && d.backup_summary?.last_backup !== undefined) return false;
      }
      if (filterChanged) {
        const lastChanged = d.backup_summary?.last_changed;
        if (filterChanged === "never" && lastChanged) return false;
        if (filterChanged === "changed" && !lastChanged) return false;
        if (lastChanged) {
          const changedTime = new Date(lastChanged.collected_at).getTime();
          const now = new Date().getTime();
          const oneDay = 24 * 60 * 60 * 1000;
          if (filterChanged === "24h" && (now - changedTime) > oneDay) return false;
          if (filterChanged === "7d" && (now - changedTime) > 7 * oneDay) return false;
        }
      }
      return true;
    });
  }, [devices, searchQuery, selectedType, filterName, filterIp, filterModel, filterConnection, filterVendor, filterUpdates, filterChanged]);

  const groupChartData = useMemo(() => {
    const groups = {};
    groupChartDevices.forEach(d => {
      const g = d.group || d.group_file || "unknown";
      if (!groups[g]) groups[g] = { name: g, success: 0, failed: 0, never: 0, value: 0 };
      const status = d.backup_summary?.last_backup?.status;
      if (status === "success") groups[g].success++;
      else if (status === "failed") groups[g].failed++;
      else groups[g].never++;
      groups[g].value++;
    });
    return Object.values(groups);
  }, [groupChartDevices]);

  const groupChartTotal = useMemo(() => groupChartData.reduce((sum, item) => sum + item.value, 0), [groupChartData]);

  // =========================================================================
  // INTERACTIVE CHART CLICK CROSS-FILTERING HANDLERS
  // =========================================================================
  const handleDistChartClick = (entry) => {
    const name = entry?.name || entry?.activePayload?.[0]?.payload?.name;
    if (!name) return;
    const mapped = name === "Success" ? "success" : name === "Failed" ? "failed" : "never";
    setFilterUpdates(prev => prev === mapped ? "" : mapped);
  };

  const handleVendorChartClick = (entry) => {
    const name = entry?.name || entry?.activePayload?.[0]?.payload?.name;
    if (!name) return;
    const vendorVal = name.toLowerCase();
    setFilterVendor(prev => prev === vendorVal ? "" : vendorVal);
  };

  const handleGroupChartClick = (entry) => {
    const name = entry?.name || entry?.activePayload?.[0]?.payload?.name;
    if (!name) return;
    setFilterGroup(prev => prev === name ? "" : name);
  };

  const clearAllFilters = () => {
    setFilterName("");
    setFilterIp("");
    setFilterModel("");
    setFilterGroup("");
    setFilterConnection("");
    setFilterUpdates("");
    setFilterChanged("");
    setFilterVendor("");
    setSearchQuery("");
    setSelectedGroup("");
    setSelectedType("");
    setQuickFilter("all");
  };

  const activeFiltersPills = useMemo(() => {
    const pills = [];
    if (filterName) pills.push({ key: "name", label: `Name: ${filterName}`, clear: () => setFilterName("") });
    if (filterIp) pills.push({ key: "ip", label: `IP: ${filterIp}`, clear: () => setFilterIp("") });
    if (filterModel) pills.push({ key: "model", label: `Model: ${filterModel}`, clear: () => setFilterModel("") });
    if (filterGroup) pills.push({ key: "group", label: `Group: ${filterGroup}`, clear: () => setFilterGroup("") });
    if (filterConnection) pills.push({ key: "conn", label: `Conn: ${filterConnection}`, clear: () => setFilterConnection("") });
    if (filterVendor) pills.push({ key: "vendor", label: `Vendor: ${filterVendor.toUpperCase()}`, clear: () => setFilterVendor("") });
    if (filterUpdates) pills.push({ key: "updates", label: `Updates: ${filterUpdates}`, clear: () => setFilterUpdates("") });
    if (filterChanged) pills.push({ key: "changed", label: `Drift: ${filterChanged}`, clear: () => setFilterChanged("") });
    if (searchQuery) pills.push({ key: "search", label: `Search: ${searchQuery}`, clear: () => setSearchQuery("") });
    return pills;
  }, [filterName, filterIp, filterModel, filterGroup, filterConnection, filterVendor, filterUpdates, filterChanged, searchQuery]);

  // Dynamic percentages for stat cards bottom progress bars
  const neverPct = useMemo(() => {
    if (!statsCounts.all) return 0;
    return Math.round((statsCounts.never / statsCounts.all) * 100);
  }, [statsCounts]);

  const successPct = useMemo(() => {
    const totalAttempted = statsCounts.success + statsCounts.failed;
    if (!totalAttempted) return 0;
    return Math.round((statsCounts.success / totalAttempted) * 100);
  }, [statsCounts]);

  const failedPct = useMemo(() => {
    const totalAttempted = statsCounts.success + statsCounts.failed;
    if (!totalAttempted) return 0;
    return Math.round((statsCounts.failed / totalAttempted) * 100);
  }, [statsCounts]);

  const driftPct = useMemo(() => {
    if (!statsCounts.all) return 0;
    return Math.round((statsCounts.drift / statsCounts.all) * 100);
  }, [statsCounts]);

  // Declaring missing variables for pagination & exports to fix ReferenceError crashes
  const totalPages = useMemo(() => {
    const limit = itemsPerPage === 'all' ? filteredAndQuickFilteredDevices.length : Number(itemsPerPage);
    if (!limit || limit <= 0) return 1;
    return Math.ceil(filteredAndQuickFilteredDevices.length / limit);
  }, [filteredAndQuickFilteredDevices, itemsPerPage]);

  const paginatedDevices = useMemo(() => {
    if (itemsPerPage === 'all') return filteredAndQuickFilteredDevices;
    const limit = Number(itemsPerPage);
    const start = (currentPage - 1) * limit;
    const end = start + limit;
    return filteredAndQuickFilteredDevices.slice(start, end);
  }, [filteredAndQuickFilteredDevices, currentPage, itemsPerPage]);

  const paginatedDevicesList = paginatedDevices;

  // Polished JSON Exporter
  const exportJsonReport = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(filteredAndQuickFilteredDevices, null, 2));
    const a = document.createElement("a");
    a.setAttribute("href", dataStr);
    a.setAttribute("download", `netact_backups_filtered_${new Date().toISOString().slice(0,10)}.json`);
    a.click();
  };

  // Polished PDF Exporter
  const exportPdfReport = () => {
    window.print();
  };

  // Consolidating Excel Excel/CSV Exporter (Highly polished and fully complete)
  const exportCsvReport = () => {
    let content = "";
    content += `"NETACT BACKUPS EXECUTIVE ANALYTICS REPORT"\n`;
    content += `"Exported At:","${new Date().toLocaleString()}"\n`;
    
    const activeFiltersStr = activeFiltersPills.map(p => p.label).join(" | ") || "none";
    content += `"Active Filters:","${activeFiltersStr.replace(/"/g, '""')}"\n\n`;
    
    content += `"BACKUPS DASHBOARD OVERVIEW SUMMARY"\n`;
    content += `"Metric","Count","Percentage"\n`;
    content += `"Total Nodes",${statsCounts.all},"100%"\n`;
    content += `"Never Backed Up",${statsCounts.never},"${neverPct}%"\n`;
    content += `"Backup Success",${statsCounts.success},"${successPct}%"\n`;
    content += `"Backup Failed",${statsCounts.failed},"${failedPct}%"\n`;
    content += `"Compliance Drift",${statsCounts.drift},"${driftPct}%"\n\n`;
    
    content += `"BACKUP DISTRIBUTION DETAILS"\n`;
    content += `"Category","Count","Percentage"\n`;
    distChartData.forEach(d => {
      const percentage = distChartTotal ? Math.round((d.value / distChartTotal) * 100) : 0;
      content += `"${d.name}",${d.value},"${percentage}%"\n`;
    });
    content += `\n`;
    
    content += `"VENDOR BREAKDOWN SUMMARY"\n`;
    content += `"Vendor","Total Nodes","Success","Failed","Never"\n`;
    vendorChartData.forEach(v => {
      content += `"${v.name}",${v.value},${v.success},${v.failed},${v.never}\n`;
    });
    content += `\n`;
    
    content += `"GROUP COVERAGE SUMMARY"\n`;
    content += `"Group","Total Nodes","Success","Failed","Never"\n`;
    groupChartData.forEach(g => {
      content += `"${g.name}",${g.value},${g.success},${g.failed},${g.never}\n`;
    });
    content += `\n`;
    
    content += `"DETAILED DEVICES TABLE RECORDS"\n`;
    const headers = ["Name", "IP Address", "Model", "Group", "Connection", "Vendor", "Last Update", "Last Changed", "Compliance Baseline"];
    content += headers.map(h => `"${h}"`).join(",") + "\n";
    
    filteredAndQuickFilteredDevices.forEach(d => {
      const row = [
        d.hostname,
        d.ip_address,
        d.device_type,
        d.group || d.group_file || "unknown",
        `${d.protocol}:${d.port}`,
        d.vendor || "",
        d.backup_summary?.last_backup ? new Date(d.backup_summary.last_backup.collected_at).toLocaleString() : "Never",
        d.backup_summary?.last_changed ? new Date(d.backup_summary.last_changed.collected_at).toLocaleString() : "No Changes",
        d.backup_summary?.gold_standard ? (d.backup_summary.is_compliant ? "Compliant" : "Drift Detected") : "No Baseline"
      ];
      content += row.map(val => `"${val.toString().replace(/"/g, '""')}"`).join(",") + "\n";
    });
    
    const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.setAttribute("href", url);
    a.setAttribute("download", `netact_backups_analytics_report_${new Date().toISOString().slice(0,10)}.csv`);
    a.click();
    URL.revokeObjectURL(url);
  };

  // Recharts Chart Renderer (Fully optimized dashboard-style)
  const renderChart = (data, mode, onChartClick) => {
    const successColor = colors.success;
    const failedColor = colors.danger;
    const neverColor = colors.gray;
    const showGrids = stripMode === "on";
    const totalCount = data.reduce((sum, item) => sum + (item.value || 0), 0);

    const tooltipProps = { 
      content: <CustomTooltip themeColors={colors} styles={styles} /> 
    };
    
    if (mode === "donut" || mode === "pie") {
      return (
        <div style={{ position: "relative", height: 180 }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                cx="50%"
                cy="50%"
                innerRadius={mode === "donut" ? "55%" : 0}
                outerRadius="78%"
                paddingAngle={mode === "donut" ? 2 : 0}
                dataKey="value"
                stroke="none"
                style={{ cursor: "pointer" }}
                onClick={(entry) => {
                  if (onChartClick && entry) {
                    onChartClick(entry);
                  }
                }}
              >
                {data.map((entry, index) => {
                  let fill = entry.fill;
                  if (!fill) {
                    const palette = [colors.primary, colors.info, colors.success, colors.warning, colors.danger, colors.gray, "#7f77dd", "#d85a30", "#639922", "#d4537e"];
                    fill = palette[index % palette.length];
                  }
                  return <Cell key={`cell-${index}`} fill={fill} />;
                })}
              </Pie>
              {showGrids && <ChartTooltip {...tooltipProps} />}
            </PieChart>
          </ResponsiveContainer>
          {mode === "donut" && <DonutCenter total={totalCount} label="Total" colors={colors} />}
        </div>
      );
    }
    
    const isHoriz = mode === "bar-h";
    
    return (
      <div style={{ height: 180 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart 
            data={data} 
            layout={isHoriz ? "vertical" : "horizontal"}
            margin={{ left: isHoriz ? 10 : 0, right: 16, top: 4, bottom: 4 }}
          >
            {showGrids && <CartesianGrid strokeDasharray="3 3" stroke={colors.border} opacity={0.3} vertical={isHoriz} horizontal={!isHoriz} />}
            {showGrids && <XAxis dataKey={isHoriz ? undefined : "name"} type={isHoriz ? "number" : "category"} stroke={colors.gray} fontSize={9} tickLine={false} axisLine={false} />}
            {showGrids && <YAxis dataKey={isHoriz ? "name" : undefined} type={isHoriz ? "category" : "number"} stroke={colors.gray} fontSize={9} tickLine={false} axisLine={false} width={isHoriz ? 65 : 30} />}
            <ChartTooltip {...tooltipProps} cursor={{ fill: "rgba(128,128,128,0.06)" }} />
            {data[0] && data[0].success !== undefined ? (
              <>
                <Bar dataKey="success" name="Success" fill={successColor} radius={isHoriz ? [0, 4, 4, 0] : [4, 4, 0, 0]} maxBarSize={16} 
                  onClick={(entry) => {
                    const val = entry.activePayload?.[0]?.payload || entry;
                    if (onChartClick && val) onChartClick(val);
                  }} 
                  style={{ cursor: "pointer" }} 
                />
                <Bar dataKey="failed" name="Failed" fill={failedColor} radius={isHoriz ? [0, 4, 4, 0] : [4, 4, 0, 0]} maxBarSize={16} 
                  onClick={(entry) => {
                    const val = entry.activePayload?.[0]?.payload || entry;
                    if (onChartClick && val) onChartClick(val);
                  }} 
                  style={{ cursor: "pointer" }} 
                />
                <Bar dataKey="never" name="Never" fill={neverColor} radius={isHoriz ? [0, 4, 4, 0] : [4, 4, 0, 0]} maxBarSize={16} 
                  onClick={(entry) => {
                    const val = entry.activePayload?.[0]?.payload || entry;
                    if (onChartClick && val) onChartClick(val);
                  }} 
                  style={{ cursor: "pointer" }} 
                />
              </>
            ) : (
              <Bar dataKey="value" fill={colors.primary} radius={isHoriz ? [0, 4, 4, 0] : [4, 4, 0, 0]} maxBarSize={20} 
                onClick={(entry) => {
                  const val = entry.activePayload?.[0]?.payload || entry;
                  if (onChartClick && val) onChartClick(val);
                }} 
                style={{ cursor: "pointer" }}
              >
                {data.map((entry, index) => {
                  const palette = [colors.primary, colors.info, colors.success, colors.warning, colors.danger, colors.gray, "#7f77dd", "#d85a30", "#639922", "#d4537e"];
                  const fill = palette[index % palette.length];
                  return <Cell key={`cell-${index}`} fill={fill} />;
                })}
              </Bar>
            )}
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  };

  const customStyles = {
    gridHeader: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 20,
      background: "var(--surface)",
      border: "1px solid var(--border-whisper)",
      borderRadius: 16,
      padding: "16px 24px",
      backdropFilter: "blur(10px)",
      gap: 16,
      flexWrap: "wrap"
    },
    statsContainer: {
      display: "grid",
      gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
      gap: 16,
      marginBottom: 24
    },
    statCard: (active, colorGlow) => ({
      background: "var(--surface)",
      border: `1px solid ${active ? colors.primary : "var(--border-whisper)"}`,
      borderRadius: 16,
      padding: "16px 20px 24px 20px",
      cursor: "pointer",
      boxShadow: active ? `0 8px 30px ${colors.primary}30` : `0 4px 12px rgba(0,0,0,${isDark ? 0.2 : 0.04})`,
      transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
      position: "relative",
      overflow: "hidden",
      transform: active ? "translateY(-4px)" : "none",
      borderLeft: `4px solid ${colorGlow}`
    }),
    statTitle: {
      fontSize: 11,
      fontWeight: 700,
      textTransform: "uppercase",
      letterSpacing: "0.5px",
      color: colors.gray,
      marginBottom: 6
    },
    statCount: {
      fontSize: 26,
      fontWeight: 800,
      color: colors.light
    },
    tableWrapper: {
      background: "var(--surface)",
      border: "1px solid var(--border-whisper)",
      borderRadius: 20,
      padding: "20px 0 0 0",
      boxShadow: `0 12px 36px rgba(0,0,0,${isDark ? 0.3 : 0.05})`,
      backdropFilter: "blur(12px)",
      overflow: "hidden"
    },
    table: {
      width: "100%",
      borderCollapse: "collapse",
      textAlign: "left"
    },
    th: {
      padding: "12px 16px",
      fontSize: 11,
      fontWeight: 700,
      textTransform: "uppercase",
      color: colors.gray,
      borderBottom: "2px solid var(--border-whisper)",
      background: "var(--surface-container)",
      letterSpacing: "0.5px"
    },
    td: {
      padding: "14px 16px",
      fontSize: 13,
      borderBottom: "1px solid var(--border-whisper)",
      color: colors.light,
      verticalAlign: "middle"
    },
    tr: {
      transition: "background 0.2s"
    },
    iconBtn: (colorHex) => ({
      width: 30,
      height: 30,
      borderRadius: 8,
      border: "1px solid var(--border-whisper)",
      background: "var(--surface-solid)",
      color: colors.light,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      cursor: "pointer",
      position: "relative",
      transition: "all 0.2s",
      outline: "none"
    }),
    badgeGroup: (group) => ({
      display: "inline-flex",
      padding: "3px 10px",
      borderRadius: 8,
      fontSize: 11,
      fontWeight: 600,
      background: `${colors.primary}15`,
      color: colors.primary,
      border: `1px solid ${colors.primary}30`
    }),
    batchFloatBar: {
      position: "fixed",
      bottom: 24,
      left: "50%",
      transform: "translateX(-50%)",
      background: "var(--surface)",
      border: `1.5px solid ${colors.primary}`,
      boxShadow: `0 20px 40px rgba(0,0,0,0.5), 0 0 15px ${colors.primary}40`,
      borderRadius: 20,
      padding: "12px 24px",
      display: "flex",
      alignItems: "center",
      gap: 16,
      zIndex: 999,
      backdropFilter: "blur(12px)",
      animation: "slideUp 0.3s cubic-bezier(0.18, 0.89, 0.32, 1.28) forwards"
    },
    glowCircle: (status) => ({
      width: 8,
      height: 8,
      borderRadius: "50%",
      display: "inline-block",
      marginRight: 8,
      background: status === "success" ? colors.success : colors.danger,
      boxShadow: `0 0 8px ${status === "success" ? colors.success : colors.danger}`
    }),
    tooltip: {
      position: "relative",
      display: "inline-block"
    },
    chartToggle: (isActive) => ({
      padding: "4px 8px",
      fontSize: 10,
      border: "none",
      borderRadius: 4,
      cursor: "pointer",
      background: isActive ? colors.primary : "transparent",
      color: isActive ? "#fff" : colors.gray,
      fontWeight: 600,
      transition: "all 0.2s"
    })
  };

  return (
    <div style={styles.container} className="print-layout">
      {/* High-End Executive PDF CSS print layout overrides */}
      <style dangerouslySetInnerHTML={{__html: `
        @media print {
          body, html, #root {
            background: #ffffff !important;
            color: #000000 !important;
          }
          #sidebar-container, .no-print, button, select, input, .batch-float-bar {
            display: none !important;
          }
          .print-layout {
            max-width: 100% !important;
            margin: 0 !important;
            padding: 0 !important;
            background: #ffffff !important;
            color: #000000 !important;
          }
          .chart-print-row {
            display: flex !important;
            flex-direction: row !important;
            flex-wrap: nowrap !important;
            gap: 12px !important;
            margin-bottom: 24px !important;
          }
          .chart-print-card {
            flex: 1 !important;
            border: 1px solid #e2e8f0 !important;
            background: #ffffff !important;
            border-radius: 12px !important;
            padding: 12px !important;
            color: #000000 !important;
          }
          .stats-card-print {
            border: 1px solid #e2e8f0 !important;
            background: #ffffff !important;
            color: #000000 !important;
          }
          table {
            color: #000000 !important;
            border: 1px solid #cbd5e1 !important;
          }
          th {
            background: #f1f5f9 !important;
            color: #475569 !important;
            border-bottom: 2px solid #cbd5e1 !important;
          }
          td {
            color: #000000 !important;
            border-bottom: 1px solid #cbd5e1 !important;
          }
        }
      `}} />

      {/* Analytics Collapsible Drawer Panel (aligned styled exactly with actual Dashboard) */}
      <div 
        style={{
          background: "var(--surface)",
          border: "1.5px solid var(--border-whisper)",
          borderRadius: 22,
          padding: dashboardOpen ? 20 : "12px 24px",
          marginBottom: 20,
          boxShadow: isDark ? "0 20px 50px rgba(0,0,0,0.35)" : "0 10px 30px rgba(0,0,0,0.1)",
          transition: "all 0.4s cubic-bezier(0.4, 0, 0.2, 1)",
          backdropFilter: "blur(14px)",
          position: dashboardMaximized ? "fixed" : "relative",
          inset: dashboardMaximized ? 20 : "auto",
          zIndex: dashboardMaximized ? 999 : 5
        }}
        className={dashboardMaximized ? "print-layout" : "no-print"}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: dashboardOpen ? "1px solid var(--border-whisper)" : "none", paddingBottom: dashboardOpen ? 12 : 0, marginBottom: dashboardOpen ? 20 : 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 16 }}>📈</span>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: colors.light, letterSpacing: "-0.3px" }}>Backups Analytics drawer</h3>
          </div>
          <div style={{ display: "flex", gap: 8 }} className="no-print">
            <button 
              onClick={clearAllFilters}
              style={{ ...styles.buttonSecondary, padding: "4px 10px", fontSize: 11 }}
              title="Reset all active search, column, and chart selections"
            >
              ↺ Reset Filters
            </button>
            <button 
              onClick={() => setStripMode(prev => prev === "on" ? "off" : "on")}
              style={{ ...styles.buttonSecondary, padding: "4px 10px", fontSize: 11 }}
              title="Toggle coordinates, ticks and grid lines on/off"
            >
              {stripMode === "on" ? "Strip Off" : "Strip On"}
            </button>
            <button 
              onClick={() => setDashboardMaximized(prev => !prev)}
              style={{ ...styles.buttonSecondary, padding: "4px 10px", fontSize: 11 }}
            >
              {dashboardMaximized ? "🗖 Minimize" : "🗖 Maximize"}
            </button>
            <button 
              onClick={() => setDashboardOpen(prev => !prev)}
              style={{ ...styles.buttonPrimary, padding: "4px 12px", fontSize: 11 }}
            >
              {dashboardOpen ? "▲ Collapse" : "▼ Expand"}
            </button>
          </div>
        </div>

        {/* Dashboard charts grid with premium transitions */}
        <div 
          style={{ 
            maxHeight: dashboardOpen ? "800px" : "0px",
            opacity: dashboardOpen ? 1 : 0,
            overflow: "hidden",
            transition: "all 0.5s cubic-bezier(0.4, 0, 0.2, 1)"
          }}
          className="chart-print-row"
        >
          {dashboardOpen && (
            <div 
              style={{ 
                display: "grid", 
                gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", 
                gap: 20 
              }}
            >
              {/* Chart 1: Backup Distribution (Interactive Click crossfiltering) */}
              <div style={{ background: "var(--surface)", border: "1px solid var(--border-whisper)", borderRadius: 16, padding: 16, position: "relative" }} className="chart-print-card">
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12, alignItems: "center" }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: colors.light }}>Backup Distribution</span>
                  <ModeToggle modes={CHART_MODES} current={distChartMode} onChange={setDistChartMode} styles={styles} colors={colors} />
                </div>
                {renderChart(distChartData, distChartMode, handleDistChartClick)}
              </div>

              {/* Chart 2: Vendor Share (Interactive Click crossfiltering) */}
              <div style={{ background: "var(--surface)", border: "1px solid var(--border-whisper)", borderRadius: 16, padding: 16, position: "relative" }} className="chart-print-card">
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12, alignItems: "center" }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: colors.light }}>Vendor Share</span>
                  <ModeToggle modes={CHART_MODES} current={vendorChartMode} onChange={setVendorChartMode} styles={styles} colors={colors} />
                </div>
                {renderChart(vendorChartData, vendorChartMode, handleVendorChartClick)}
              </div>

              {/* Chart 3: Group Coverage (Interactive Click crossfiltering) */}
              <div style={{ background: "var(--surface)", border: "1px solid var(--border-whisper)", borderRadius: 16, padding: 16, position: "relative" }} className="chart-print-card">
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12, alignItems: "center" }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: colors.light }}>Group Coverage</span>
                  <ModeToggle modes={CHART_MODES} current={groupChartMode} onChange={setGroupChartMode} styles={styles} colors={colors} />
                </div>
                {renderChart(groupChartData, groupChartMode, handleGroupChartClick)}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 5-Deck Summary Filtering Cards styled exactly like Actual Main Dashboard KPI cards */}
      <div style={customStyles.statsContainer}>
        {/* Card 1: Total Nodes */}
        <div 
          onClick={() => setQuickFilter("all")} 
          style={{
            ...customStyles.statCard(quickFilter === "all", colors.primary),
            transition: "all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1)"
          }}
          className="stats-card-print"
          onMouseEnter={e => {
            e.currentTarget.style.transform = "translateY(-4px)";
            e.currentTarget.style.boxShadow = `0 12px 28px ${colors.primary}20`;
          }}
          onMouseLeave={e => {
            e.currentTarget.style.transform = quickFilter === "all" ? "translateY(-4px)" : "none";
            e.currentTarget.style.boxShadow = quickFilter === "all" ? `0 8px 30px ${colors.primary}30` : `0 4px 12px rgba(0,0,0,${isDark ? 0.2 : 0.04})`;
          }}
        >
          <div style={customStyles.statTitle}>Total Nodes</div>
          <div style={customStyles.statCount}>{statsCounts.all}</div>
          <div style={{ fontSize: 11, color: colors.gray, marginTop: 4 }}>All managed network assets</div>
          <div style={{ position: "absolute", bottom: 0, left: 0, height: 3, width: "100%", background: colors.primary, borderRadius: "0 2px 2px 0", transition: "width .6s ease" }} />
        </div>

        {/* Card 2: Never Backed Up */}
        <div 
          onClick={() => setQuickFilter("never")} 
          style={{
            ...customStyles.statCard(quickFilter === "never", colors.gray),
            transition: "all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1)"
          }}
          className="stats-card-print"
          onMouseEnter={e => {
            e.currentTarget.style.transform = "translateY(-4px)";
            e.currentTarget.style.boxShadow = `0 12px 28px ${colors.gray}20`;
          }}
          onMouseLeave={e => {
            e.currentTarget.style.transform = quickFilter === "never" ? "translateY(-4px)" : "none";
            e.currentTarget.style.boxShadow = quickFilter === "never" ? `0 8px 30px ${colors.primary}30` : `0 4px 12px rgba(0,0,0,${isDark ? 0.2 : 0.04})`;
          }}
        >
          <div style={customStyles.statTitle}>Never Backed Up</div>
          <div style={{ ...customStyles.statCount, color: colors.gray }}>{statsCounts.never}</div>
          <div style={{ fontSize: 11, color: colors.gray, marginTop: 4 }}>{neverPct}% of total nodes count</div>
          <div style={{ position: "absolute", bottom: 0, left: 0, height: 3, width: `${neverPct}%`, background: colors.gray, borderRadius: "0 2px 2px 0", transition: "width .6s ease" }} />
        </div>

        {/* Card 3: Backup Success */}
        <div 
          onClick={() => setQuickFilter("success")} 
          style={{
            ...customStyles.statCard(quickFilter === "success", colors.success),
            transition: "all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1)"
          }}
          className="stats-card-print"
          onMouseEnter={e => {
            e.currentTarget.style.transform = "translateY(-4px)";
            e.currentTarget.style.boxShadow = `0 12px 28px ${colors.success}20`;
          }}
          onMouseLeave={e => {
            e.currentTarget.style.transform = quickFilter === "success" ? "translateY(-4px)" : "none";
            e.currentTarget.style.boxShadow = quickFilter === "success" ? `0 8px 30px ${colors.primary}30` : `0 4px 12px rgba(0,0,0,${isDark ? 0.2 : 0.04})`;
          }}
        >
          <div style={customStyles.statTitle}>Backup Success</div>
          <div style={{ ...customStyles.statCount, color: colors.success }}>{statsCounts.success}</div>
          <div style={{ fontSize: 11, color: colors.gray, marginTop: 4 }}>{successPct}% success rate of backed nodes</div>
          <div style={{ position: "absolute", bottom: 0, left: 0, height: 3, width: `${successPct}%`, background: colors.success, borderRadius: "0 2px 2px 0", transition: "width .6s ease" }} />
        </div>

        {/* Card 4: Backup Failed */}
        <div 
          onClick={() => setQuickFilter("failed")} 
          style={{
            ...customStyles.statCard(quickFilter === "failed", colors.danger),
            transition: "all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1)"
          }}
          className="stats-card-print"
          onMouseEnter={e => {
            e.currentTarget.style.transform = "translateY(-4px)";
            e.currentTarget.style.boxShadow = `0 12px 28px ${colors.danger}20`;
          }}
          onMouseLeave={e => {
            e.currentTarget.style.transform = quickFilter === "failed" ? "translateY(-4px)" : "none";
            e.currentTarget.style.boxShadow = quickFilter === "failed" ? `0 8px 30px ${colors.primary}30` : `0 4px 12px rgba(0,0,0,${isDark ? 0.2 : 0.04})`;
          }}
        >
          <div style={customStyles.statTitle}>Backup Failed</div>
          <div style={{ ...customStyles.statCount, color: colors.danger }}>{statsCounts.failed}</div>
          <div style={{ fontSize: 11, color: colors.gray, marginTop: 4 }}>{failedPct}% failure rate of backed nodes</div>
          <div style={{ position: "absolute", bottom: 0, left: 0, height: 3, width: `${failedPct}%`, background: colors.danger, borderRadius: "0 2px 2px 0", transition: "width .6s ease" }} />
        </div>

        {/* Card 5: Compliance Drift */}
        <div 
          onClick={() => setQuickFilter("drift")} 
          style={{
            ...customStyles.statCard(quickFilter === "drift", colors.warning),
            transition: "all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1)"
          }}
          className="stats-card-print"
          onMouseEnter={e => {
            e.currentTarget.style.transform = "translateY(-4px)";
            e.currentTarget.style.boxShadow = `0 12px 28px ${colors.warning}20`;
          }}
          onMouseLeave={e => {
            e.currentTarget.style.transform = quickFilter === "drift" ? "translateY(-4px)" : "none";
            e.currentTarget.style.boxShadow = quickFilter === "drift" ? `0 8px 30px ${colors.primary}30` : `0 4px 12px rgba(0,0,0,${isDark ? 0.2 : 0.04})`;
          }}
        >
          <div style={customStyles.statTitle}>Compliance Drift</div>
          <div style={{ ...customStyles.statCount, color: colors.warning }}>{statsCounts.drift}</div>
          <div style={{ fontSize: 11, color: colors.gray, marginTop: 4 }}>{driftPct}% baseline compliance drift</div>
          <div style={{ position: "absolute", bottom: 0, left: 0, height: 3, width: `${driftPct}%`, background: colors.warning, borderRadius: "0 2px 2px 0", transition: "width .6s ease" }} />
        </div>
      </div>

      {/* Active Filter Faceted Tags / Clear Pill row */}
      {activeFiltersPills.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 16 }} className="no-print">
          <span style={{ fontSize: 12, color: colors.gray, fontWeight: 700 }}>Active Filters:</span>
          {activeFiltersPills.map(p => (
            <span 
              key={p.key} 
              onClick={p.clear}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "4px 10px",
                borderRadius: 8,
                fontSize: 11,
                fontWeight: 600,
                background: isDark ? `${colors.primary}25` : `${colors.primary}15`,
                color: colors.primary,
                border: `1px solid ${colors.primary}30`,
                cursor: "pointer"
              }}
              title="Click to remove filter"
            >
              {p.label} <span style={{ opacity: 0.7 }}>✕</span>
            </span>
          ))}
          <button 
            onClick={clearAllFilters}
            style={{
              padding: "4px 10px",
              borderRadius: 8,
              border: "1px solid var(--border-whisper)",
              background: "transparent",
              color: colors.light,
              fontSize: 11,
              fontWeight: 700,
              cursor: "pointer"
            }}
          >
            Clear All
          </button>
        </div>
      )}

      {/* Main Control Panel */}
      <div style={customStyles.gridHeader} className="no-print">
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flex: 1, flexWrap: "wrap" }}>
          <input
            type="text" 
            placeholder="Search devices..." 
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)} 
            style={{ ...styles.input, maxWidth: 220 }}
          />

          <select value={selectedGroup} onChange={e => setSelectedGroup(e.target.value)} style={{ ...styles.input, width: 130 }}>
            <option value="">All Groups</option>
            {deviceGroups.map(g => <option key={g.group} value={g.group}>{g.group}</option>)}
          </select>

          <select value={selectedType} onChange={e => setSelectedType(e.target.value)} style={{ ...styles.input, width: 130 }}>
            <option value="">All Device Types</option>
            {deviceTypes.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: "center" }}>
          {/* Reports Export dropdown menu button group */}
          <div style={{ display: "flex", gap: 1, background: colors.border, borderRadius: 10, padding: 2 }}>
            <button onClick={exportJsonReport} style={{ ...styles.buttonSecondary, padding: "8px 12px", border: "none", borderRadius: 8, fontSize: 12 }}>Export JSON</button>
            <button onClick={exportCsvReport} style={{ ...styles.buttonSecondary, padding: "8px 12px", border: "none", borderRadius: 8, fontSize: 12 }} title="Export combined Excel layout containing dashboard metrics and device rows">Export Excel</button>
            <button onClick={exportPdfReport} style={{ ...styles.buttonPrimary, padding: "8px 12px", border: "none", borderRadius: 8, fontSize: 12 }}>Export PDF</button>
          </div>

          <button onClick={reloadDevicesFromYaml} style={styles.buttonSecondary} disabled={reloading}>
            {reloading ? "Reloading..." : "Reload"}
          </button>
        </div>
      </div>

      {/* Unified High-Density Grid Table */}
      <div style={customStyles.tableWrapper}>
        <div style={{ overflowX: "auto" }}>
          <table style={customStyles.table}>
            <thead>
              {/* Main table headers */}
              <tr>
                <th style={{ ...customStyles.th, width: 40, textAlign: "center" }} className="no-print">
                  <input 
                    type="checkbox"
                    checked={filteredAndQuickFilteredDevices.length > 0 && selectedForBatch.size === filteredAndQuickFilteredDevices.length}
                    onChange={() => selectAllFiltered(filteredAndQuickFilteredDevices)}
                  />
                </th>
                <th style={customStyles.th}>Name</th>
                <th style={customStyles.th}>IP Address</th>
                <th style={customStyles.th}>Model</th>
                <th style={customStyles.th}>Group</th>
                <th style={customStyles.th}>Connection</th>
                <th style={customStyles.th}>Vendor</th>
                <th style={customStyles.th}>Last Updates</th>
                <th style={customStyles.th}>Last Changed</th>
                <th style={{ ...customStyles.th, textAlign: "right" }} className="no-print">Actions</th>
              </tr>

              {/* Column-specific spreadsheet-like filters */}
              <tr className="no-print" style={{ background: "var(--surface-container)" }}>
                <td style={{ padding: "6px 16px" }}></td>
                <td style={{ padding: "6px 16px" }}>
                  <input 
                    type="text" 
                    placeholder="Filter Name..." 
                    value={filterName}
                    onChange={e => setFilterName(e.target.value)}
                    style={{ ...styles.input, padding: "4px 8px", fontSize: 11 }}
                  />
                </td>
                <td style={{ padding: "6px 16px" }}>
                  <input 
                    type="text" 
                    placeholder="Filter IP..." 
                    value={filterIp}
                    onChange={e => setFilterIp(e.target.value)}
                    style={{ ...styles.input, padding: "4px 8px", fontSize: 11 }}
                  />
                </td>
                <td style={{ padding: "6px 16px" }}>
                  <select
                    value={filterModel}
                    onChange={e => setFilterModel(e.target.value)}
                    style={{ ...styles.input, padding: "4px 8px", fontSize: 11 }}
                  >
                    <option value="">All</option>
                    {modelOptions.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </td>
                <td style={{ padding: "6px 16px" }}>
                  <select
                    value={filterGroup}
                    onChange={e => setFilterGroup(e.target.value)}
                    style={{ ...styles.input, padding: "4px 8px", fontSize: 11 }}
                  >
                    <option value="">All</option>
                    {groupOptions.map(g => <option key={g} value={g}>{g}</option>)}
                  </select>
                </td>
                <td style={{ padding: "6px 16px" }}>
                  <select
                    value={filterConnection}
                    onChange={e => setFilterConnection(e.target.value)}
                    style={{ ...styles.input, padding: "4px 8px", fontSize: 11 }}
                  >
                    <option value="">All</option>
                    {connectionOptions.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </td>
                <td style={{ padding: "6px 16px" }}>
                  <select
                    value={filterVendor}
                    onChange={e => setFilterVendor(e.target.value)}
                    style={{ ...styles.input, padding: "4px 8px", fontSize: 11 }}
                  >
                    <option value="">All</option>
                    {vendorOptions.map(v => <option key={v} value={v}>{v.toUpperCase()}</option>)}
                  </select>
                </td>
                <td style={{ padding: "6px 16px" }}>
                  <select
                    value={filterUpdates}
                    onChange={e => setFilterUpdates(e.target.value)}
                    style={{ ...styles.input, padding: "4px 8px", fontSize: 11 }}
                  >
                    <option value="">All</option>
                    <option value="success">Success</option>
                    <option value="failed">Failed</option>
                    <option value="never">Never Backed Up</option>
                  </select>
                </td>
                <td style={{ padding: "6px 16px" }}>
                  <select
                    value={filterChanged}
                    onChange={e => setFilterChanged(e.target.value)}
                    style={{ ...styles.input, padding: "4px 8px", fontSize: 11 }}
                  >
                    <option value="">All</option>
                    <option value="changed">Has Changes</option>
                    <option value="never">No Changes</option>
                    <option value="24h">Drifted (Last 24h)</option>
                    <option value="7d">Drifted (Last 7d)</option>
                  </select>
                </td>
                <td style={{ padding: "6px 16px" }}></td>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={10} style={{ ...customStyles.td, textAlign: "center", padding: 40 }}>
                    <div style={styles.loadingState}>Loading summary backup records...</div>
                  </td>
                </tr>
              ) : paginatedDevicesList.length === 0 ? (
                <tr>
                  <td colSpan={10} style={{ ...customStyles.td, textAlign: "center", padding: 40 }}>
                    <div style={styles.emptyState}>No devices matching current search and filter criteria.</div>
                  </td>
                </tr>
              ) : (
                paginatedDevicesList.map(d => {
                  const summary = d.backup_summary || {};
                  const batchStatus = batchStatuses[d.id];
                  const hasSuccess = summary.last_backup?.status === "success" || summary.last_changed;
                  
                  return (
                    <tr 
                      key={d.id} 
                      style={customStyles.tr}
                      onMouseEnter={e => e.currentTarget.style.background = isDark ? "rgba(255, 255, 255, 0.03)" : "rgba(2, 6, 23, 0.02)"}
                      onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                    >
                      <td style={{ ...customStyles.td, textAlign: "center" }} className="no-print">
                        <input 
                          type="checkbox"
                          checked={selectedForBatch.has(d.id)}
                          onChange={e => toggleBatchSelection(d.id, e)}
                        />
                      </td>
                      <td style={{ ...customStyles.td, fontWeight: 700 }}>
                        <Link 
                          to={`/backup/device/${d.id}`} 
                          style={{ color: colors.primary, textDecoration: "none" }}
                          onMouseEnter={e => e.target.style.textDecoration = "underline"}
                          onMouseLeave={e => e.target.style.textDecoration = "none"}
                        >
                          {d.hostname}
                        </Link>
                      </td>
                      <td style={{ ...customStyles.td, fontFamily: "monospace", opacity: 0.8 }}>
                        {d.ip_address}
                      </td>
                      <td style={customStyles.td}>
                        {d.device_type}
                      </td>
                      <td style={customStyles.td}>
                        <span style={customStyles.badgeGroup(d.group)}>
                          {d.group}
                        </span>
                      </td>
                      <td style={customStyles.td}>
                        <span style={{ textTransform: "uppercase", fontSize: 11, fontWeight: 700, color: colors.gray }}>
                          {d.protocol}:{d.port}
                        </span>
                      </td>
                      <td style={customStyles.td}>
                        <span style={{ textTransform: "uppercase", fontSize: 11, fontWeight: 700, color: colors.info }}>
                          {d.vendor}
                        </span>
                      </td>
                      <td style={customStyles.td}>
                        {batchStatus === 'pending' ? (
                          <span style={getBadgeStyle('warning', colors)} className="status-blinking">Backing up...</span>
                        ) : summary.last_backup ? (
                          <div style={{ display: 'flex', alignItems: 'center' }}>
                            <span style={customStyles.glowCircle(summary.last_backup.status)} />
                            <span>
                              {new Date(summary.last_backup.collected_at).toLocaleString()}
                            </span>
                          </div>
                        ) : (
                          <span style={{ color: colors.gray }}>Never Backed Up</span>
                        )}
                      </td>
                      <td style={customStyles.td}>
                        {summary.last_changed ? (
                          <div style={{ display: 'flex', flexDirection: "column", gap: 4 }}>
                            <span>
                              {new Date(summary.last_changed.collected_at).toLocaleString()}
                            </span>
                            {(summary.last_changed.lines_added > 0 || summary.last_changed.lines_deleted > 0) && (
                              <div style={{ display: "flex", gap: 6 }}>
                                <span style={{ fontSize: 10, fontWeight: 700, color: colors.success }}>
                                  +{summary.last_changed.lines_added}
                                </span>
                                <span style={{ fontSize: 10, fontWeight: 700, color: colors.danger }}>
                                  -{summary.last_changed.lines_deleted}
                                </span>
                              </div>
                            )}
                          </div>
                        ) : (
                          <span style={{ color: colors.gray }}>No changes recorded</span>
                        )}
                      </td>
                      <td style={customStyles.td} className="no-print">
                        <div style={{ display: 'flex', gap: 6, justifyContent: "flex-end", alignItems: "center" }}>
                          
                          {summary.gold_standard && (
                            <span 
                              style={{ 
                                display: "inline-flex", 
                                marginRight: 6, 
                                fontSize: 11, 
                                fontWeight: 700, 
                                padding: "2px 8px", 
                                borderRadius: 6,
                                background: summary.is_compliant ? `${colors.success}15` : `${colors.danger}15`,
                                color: summary.is_compliant ? colors.success : colors.danger,
                                border: `1px solid ${summary.is_compliant ? colors.success : colors.danger}30`
                              }}
                              title={summary.is_compliant ? "Matches baseline" : "Config Drift Detected"}
                            >
                              {summary.is_compliant ? "Baseline: Match" : "Baseline: Drift"}
                            </span>
                          )}

                          <button 
                            onClick={e => triggerBackup(d.id, e)} 
                            style={{ 
                              ...customStyles.iconBtn(colors.primary), 
                              borderColor: batchStatus === 'pending' ? colors.warning : colors.border 
                            }} 
                            disabled={batchStatus === 'pending' || isViewer}
                            title="Collect New Backup"
                            className={batchStatus === 'pending' ? "status-blinking" : ""}
                          >
                            {batchStatus === 'pending' ? (
                              <span style={{ animation: "spin 1s linear infinite" }}>🔄</span>
                            ) : (
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>
                            )}
                          </button>

                          <button 
                            onClick={() => viewFull(summary.last_backup?.id, d)}
                            style={customStyles.iconBtn(colors.info)}
                            disabled={!hasSuccess}
                            title={hasSuccess ? "View Full Config" : "View Unavailable"}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                          </button>

                          <button 
                            onClick={() => downloadConfig(summary.last_backup?.id, d)}
                            style={customStyles.iconBtn(colors.success)}
                            disabled={!hasSuccess}
                            title={hasSuccess ? "Download Config (.txt)" : "Download Unavailable"}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
                          </button>

                          <button 
                            onClick={() => setCompareData({ backup1: summary.last_backup?.id, backup2: null, device: d })}
                            style={customStyles.iconBtn(colors.warning)}
                            disabled={!hasSuccess}
                            title={hasSuccess ? "Compare History" : "Compare History Unavailable"}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M16 3h5v5M4 20L20 4M21 16v5h-5M4 4l16 16"/></svg>
                          </button>

                          <button 
                            onClick={e => openGoldStandardModal(d, e)}
                            style={customStyles.iconBtn(colors.primary)}
                            disabled={isViewer || !hasSuccess}
                            title={hasSuccess ? "Set Gold Standard compliance baseline" : "Gold Standard Unavailable"}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="7"/><path d="M8.21 13.89L7 23l5-3 5 3-1.21-9.12"/></svg>
                          </button>

                          <button 
                            onClick={() => setRollbackTarget({ id: summary.last_backup?.id, device: d })}
                            style={customStyles.iconBtn(colors.danger)}
                            disabled={isViewer || !hasSuccess}
                            title={hasSuccess ? "Rollback Device Config" : "Rollback Unavailable"}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8M3 3v5h5"/></svg>
                          </button>

                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Dynamic Pagination Footer Control */}
        <div style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "16px 24px",
          borderTop: "1px solid var(--border-whisper)",
          background: "var(--surface-container)",
          flexWrap: "wrap",
          gap: 12
        }} className="no-print">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 13, color: colors.gray }}>
              Showing {filteredAndQuickFilteredDevices.length === 0 ? 0 : (currentPage - 1) * Number(itemsPerPage === 'all' ? filteredAndQuickFilteredDevices.length : itemsPerPage) + 1}–
              {itemsPerPage === 'all' ? filteredAndQuickFilteredDevices.length : Math.min(currentPage * Number(itemsPerPage), filteredAndQuickFilteredDevices.length)} of {filteredAndQuickFilteredDevices.length} nodes
            </span>

            <select 
              value={itemsPerPage} 
              onChange={e => setItemsPerPage(e.target.value)} 
              style={{ ...styles.input, width: 80, padding: "4px 8px", fontSize: 12 }}
            >
              <option value={10}>10</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
              <option value="all">All</option>
            </select>
            <span style={{ fontSize: 12, color: colors.gray }}>per page</span>
          </div>

          {itemsPerPage !== 'all' && totalPages > 1 && (
            <div style={{ display: "flex", gap: 6 }}>
              <button 
                onClick={() => setCurrentPage(1)} 
                style={{ ...styles.buttonSecondary, padding: "6px 12px", opacity: currentPage === 1 ? 0.5 : 1 }}
                disabled={currentPage === 1}
              >
                « First
              </button>
              <button 
                onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))} 
                style={{ ...styles.buttonSecondary, padding: "6px 12px", opacity: currentPage === 1 ? 0.5 : 1 }}
                disabled={currentPage === 1}
              >
                ‹ Prev
              </button>
              
              <span style={{ display: 'inline-flex', alignItems: 'center', padding: "0 12px", fontSize: 13, fontWeight: 700 }}>
                Page {currentPage} of {totalPages}
              </span>

              <button 
                onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))} 
                style={{ ...styles.buttonSecondary, padding: "6px 12px", opacity: currentPage === totalPages ? 0.5 : 1 }}
                disabled={currentPage === totalPages}
              >
                Next ›
              </button>
              <button 
                onClick={() => setCurrentPage(totalPages)} 
                style={{ ...styles.buttonSecondary, padding: "6px 12px", opacity: currentPage === totalPages ? 0.5 : 1 }}
                disabled={currentPage === totalPages}
              >
                Last »
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Floating Batch Actions Bar */}
      {selectedForBatch.size > 0 && (
        <div style={customStyles.batchFloatBar} className="no-print">
          <span style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>
            {selectedForBatch.size} devices selected
          </span>
          <button 
            onClick={() => setSelectedForBatch(new Set())}
            style={styles.buttonSecondary}
          >
            Deselect All
          </button>
          {!isViewer && (
            <button 
              onClick={triggerBatchBackup}
              style={styles.buttonPrimary}
            >
              Batch Backup
            </button>
          )}
          <button 
            onClick={triggerBatchZIP}
            style={styles.buttonSuccess}
          >
            Export ZIP
          </button>
        </div>
      )}

      {/* Baseline Gold Standard Sub-Modal */}
      {goldStandardModal && (
        <div style={styles.modalBackdrop} onClick={() => setGoldStandardModal(null)}>
          <div style={{ ...styles.modalCard, maxWidth: '500px' }} onClick={e => e.stopPropagation()}>
            <div style={styles.modalHeader}>
              <h3 style={styles.modalTitle}>Set Compliance Baseline — {goldStandardModal.hostname}</h3>
              <button onClick={() => setGoldStandardModal(null)} style={styles.closeButton}>✕</button>
            </div>
            <div style={styles.modalBody}>
              <p style={{ fontSize: 13, color: colors.gray, marginBottom: 16 }}>
                Choose a successful configuration from this device's backup history to serve as the **Gold Standard Baseline**. Active backups will be monitored for compliance/drift against this version.
              </p>
              
              {loadingHistory ? (
                <div style={styles.loadingState}>Retrieving backup list...</div>
              ) : deviceHistory.length === 0 ? (
                <div style={styles.emptyState}>
                  No successful backups found for this device.<br />
                  Run a backup first to establish a compliance target.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <div style={styles.fieldWrap}>
                    <label style={styles.label}>Select Baseline Target</label>
                    <select 
                      value={selectedBaselineId || ""} 
                      onChange={e => setSelectedBaselineId(e.target.value)} 
                      style={styles.input}
                    >
                      <option value="">-- No Baseline (Disable compliance checks) --</option>
                      {deviceHistory.map(h => (
                        <option key={h.id} value={h.id}>
                          Backup #{h.id} ({new Date(h.collected_at).toLocaleString()})
                        </option>
                      ))}
                    </select>
                  </div>
                  
                  <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 10 }}>
                    <button onClick={() => setGoldStandardModal(null)} style={styles.buttonSecondary}>Cancel</button>
                    <button onClick={saveBaseline} style={styles.buttonPrimary}>Save Baseline</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Existing Full Configuration View Modal */}
      {fullConfig && selectedDevice && (
        <div style={styles.modalBackdrop} onClick={() => { setFullConfig(null); setModalSearchTerm(""); setTotalMatches(0); setCurrentMatchIndex(0); }}>
          <div 
            style={{ 
              ...styles.modalCard, 
              ...(modalFullScreen ? {
                position: "fixed",
                inset: 0,
                width: "100vw",
                height: "100vh",
                maxWidth: "none",
                maxHeight: "none",
                borderRadius: 0,
                margin: 0,
                zIndex: 9999
              } : {
                maxWidth: '90vw', 
                width: '1200px'
              })
            }} 
            onClick={e => e.stopPropagation()}
          >
            <div style={styles.modalHeader}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 20, flex: 1 }}>
                <h3 style={styles.modalTitle}>Full Configuration — {selectedDevice.hostname} (#{fullConfig.id})</h3>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, maxWidth: 600 }}>
                  <div style={{ position: 'relative', flex: 1 }}>
                    <input 
                      type="text" 
                      placeholder="Search config text... (Press Enter)" 
                      value={modalSearchTerm}
                      onChange={e => setModalSearchTerm(e.target.value)}
                      onKeyDown={handleSearchKeyDown}
                      style={{ ...styles.input, paddingLeft: 36, paddingRight: 80 }}
                    />
                    <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', opacity: 0.5 }}>🔍</span>
                    {modalSearchTerm && (
                      <div style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 12, color: tooManyMatches ? colors.danger : colors.gray, marginRight: 4 }}>
                          {tooManyMatches 
                            ? `>1000 matches (refine search)` 
                            : (totalMatches > 0 ? `${currentMatchIndex + 1}/${totalMatches}` : '0/0')
                          }
                        </span>
                        <button 
                          onClick={() => setModalSearchTerm("")}
                          style={{ background: 'none', border: 'none', color: colors.gray, cursor: 'pointer', padding: 4 }}
                        >✕</button>
                      </div>
                    )}
                  </div>
                  {totalMatches > 0 && !tooManyMatches && (
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button onClick={() => setCurrentMatchIndex(prev => (prev > 0 ? prev - 1 : totalMatches - 1))} style={{ ...styles.buttonSecondary, padding: '8px 12px' }}>↑</button>
                      <button onClick={() => setCurrentMatchIndex(prev => (prev < totalMatches - 1 ? prev + 1 : 0))} style={{ ...styles.buttonSecondary, padding: '8px 12px' }}>↓</button>
                    </div>
                  )}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button 
                  onClick={() => setModalFullScreen(prev => !prev)} 
                  style={{
                    ...styles.closeButton,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                  title={modalFullScreen ? "Exit Full Screen" : "Full Screen"}
                >
                  {modalFullScreen ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 14h6v6m10-6h-6v6M4 10h6V4m10 6h-6V4"/></svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>
                  )}
                </button>
                <button onClick={() => { setFullConfig(null); setModalSearchTerm(""); setTotalMatches(0); setCurrentMatchIndex(0); }} style={styles.closeButton}>✕</button>
              </div>
            </div>
            <div style={{ ...styles.modalBody, maxHeight: modalFullScreen ? 'calc(100vh - 80px)' : '70vh', overflowY: 'auto' }}>
              <pre 
                style={{ ...styles.codeBlock, maxHeight: "none", color: colors.info, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}
                dangerouslySetInnerHTML={{ __html: highlightedHtml }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Existing Compare History Modal */}
      {compareData && (
        <CompareModal
          collectionType="backup"
          initialId1={compareData.backup1}
          initialId2={compareData.backup2}
          deviceName={compareData.device.hostname}
          deviceId={compareData.device.id}
          onClose={() => setCompareData(null)}
        />
      )}

      {/* Existing Rollback Target Modal */}
      {rollbackTarget && (
        <RollbackModal
          backupId={rollbackTarget.id}
          deviceName={rollbackTarget.device.hostname}
          deviceId={rollbackTarget.device.id}
          onClose={() => setRollbackTarget(null)}
          onRollbackComplete={fetchSummaryDevices}
        />
      )}
    </div>
  );
}
