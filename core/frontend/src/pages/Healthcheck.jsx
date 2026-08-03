import React, { useEffect, useState, useMemo, useCallback } from "react";
import { Link } from "react-router-dom";
import { useTheme } from "../context/ThemeContext";
import { getBadgeStyle } from "../styles";
import { useAuth } from "../context/AuthContext";
import RatioCircle from "../components/RatioCircle";
import CompareModal from "../components/CompareModal";
import {
  PieChart, Pie, Cell, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip as ChartTooltip, Legend
} from "recharts";

const API = "/api";

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

const escapeHtml = (str) => {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
};

const HighlightVersionOutputHtml = (text, eoleos, colors) => {
  if (!text) return "";
  
  const terms = ["display version"];
  if (eoleos && eoleos.matched) {
    if (eoleos.platform) terms.push(eoleos.platform);
    if (eoleos.current_version && eoleos.current_version !== "Unknown") {
      terms.push(eoleos.current_version);
    }
  }

  const escapedTerms = terms
    .filter(t => t && t.trim())
    .map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  
  if (escapedTerms.length === 0) return escapeHtml(text);
  
  const regex = new RegExp(`(${escapedTerms.join('|')})`, 'gi');
  const parts = text.split(regex);
  
  const htmlParts = parts.map((part) => {
    const isMatched = terms.some(t => t && part.toLowerCase() === t.toLowerCase());
    if (isMatched) {
      const isCmd = part.toLowerCase() === "display version";
      const bg = isCmd ? '#ff4081' : '#4caf50';
      const shadow = isCmd ? 'box-shadow: 0 0 8px rgba(255, 64, 129, 0.5);' : 'box-shadow: 0 0 8px rgba(76, 175, 80, 0.5);';
      return `<mark style="background-color: ${bg}; color: #fff; padding: 2px 6px; border-radius: 4px; font-weight: bold; ${shadow}">${escapeHtml(part)}</mark>`;
    }
    return escapeHtml(part);
  });
  
  return htmlParts.join('');
};

export default function Healthcheck() {
  const { config, styles, theme } = useTheme();
  const { isViewer } = useAuth();
  const { colors } = theme;
  const isDark = config.mode === "dark";

  const [devices, setDevices] = useState([]);
  const [deviceGroups, setDeviceGroups] = useState([]);
  const [deviceTypes, setDeviceTypes] = useState([]);
  const [selectedGroup, setSelectedGroup] = useState("");
  const [selectedType, setSelectedType] = useState("");
  const [selectedCommandSource, setSelectedCommandSource] = useState("");
  const [quickFilter, setQuickFilter] = useState("all"); // 'all', 'never', 'success', 'failed'

  const [selectedDevice, setSelectedDevice] = useState(null);
  const [results, setResults] = useState([]); // history of selected device
  const [historyOpen, setHistoryOpen] = useState(false); // history sidebar drawer state
  const [loading, setLoading] = useState(false);
  const [reloading, setReloading] = useState(false);

  const [selectedForBatch, setSelectedForBatch] = useState(new Set());
  const [batchStatuses, setBatchStatuses] = useState(() => {
    try {
      const saved = localStorage.getItem("running_healthchecks");
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
          localStorage.setItem("running_healthchecks", JSON.stringify(clean));
        }
        return initial;
      }
    } catch (e) {}
    return {};
  });
  const [searchQuery, setSearchQuery] = useState("");
  const [fullResult, setFullResult] = useState(null);

  const [compareData, setCompareData] = useState(null);

  // Pagination states
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10); // 10, 50, 100, 'all'

  // Collapsible Dashboard Drawer Toggles
  const [dashboardOpen, setDashboardOpen] = useState(true);
  const [dashboardMaximized, setDashboardMaximized] = useState(false);
  const [stripMode, setStripMode] = useState("on"); // 'on' | 'off'

  // Chart modes states
  const [distChartMode, setDistChartMode] = useState("donut");
  const [vendorChartMode, setVendorChartMode] = useState("bar-v");
  const [groupChartMode, setGroupChartMode] = useState("bar-h");
  const [modalFullScreen, setModalFullScreen] = useState(false);

  // Spreadsheet column filters
  const [filterName, setFilterName] = useState("");
  const [filterIp, setFilterIp] = useState("");
  const [filterModel, setFilterModel] = useState("");
  const [filterGroup, setFilterGroup] = useState("");
  const [filterConnection, setFilterConnection] = useState("");
  const [filterVendor, setFilterVendor] = useState("");
  const [filterUpdates, setFilterUpdates] = useState(""); // success/failed/never
  const [filterTotalRuns, setFilterTotalRuns] = useState("");

  // Modal report text search states
  const [modalSearchTerm, setModalSearchTerm] = useState("");
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState("");
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
  const [totalMatches, setTotalMatches] = useState(0);
  const [tooManyMatches, setTooManyMatches] = useState(false);

  useEffect(() => {
    fetchSummaryDevices();
    fetchDeviceGroups();
    fetchDeviceTypes();
  }, []);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, selectedGroup, selectedType, quickFilter, itemsPerPage, filterName, filterIp, filterModel, filterGroup, filterConnection, filterUpdates, filterTotalRuns, filterVendor]);

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
      const savedStr = localStorage.getItem("running_healthchecks");
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
          
          const summary = d.healthcheck_summary || {};
          const lastCheck = summary.last_healthcheck;
          if (lastCheck && lastCheck.timestamp) {
            const completionTime = new Date(lastCheck.timestamp).getTime();
            if (completionTime > startTime - 5000) {
              delete clean[d.id];
              const statusVal = lastCheck.status === 'success' ? 'success' : 'failed';
              setBatchStatuses(prev => ({ 
                ...prev, 
                [d.id]: statusVal 
              }));
              updated = true;
              
              window.dispatchEvent(new CustomEvent('netact-notification', {
                detail: {
                  type: 'healthcheck',
                  status: statusVal,
                  title: 'Healthcheck Completed',
                  message: `Healthcheck for ${d.hostname} ${statusVal === 'success' ? 'succeeded' : 'failed'}.`,
                  targetUrl: `/healthcheck/device/${d.id}`
                }
              }));
            }
          }
        }
      });
      
      if (updated) {
        localStorage.setItem("running_healthchecks", JSON.stringify(clean));
      }
    } catch (e) {
      console.error("Error checking pending completions:", e);
    }
  };

  async function fetchSummaryDevices() {
    setLoading(true);
    try {
      const res = await fetch(`${API}/devices/healthchecks-summary`, { 
        headers: { 'x-api-key': sessionStorage.getItem('app_password') || '' } 
      });
      if (res.ok) {
        const data = await res.json();
        setDevices(data);
        checkPendingCompletions(data);
      }
    } catch (err) {
      console.error("Error fetching healthcheck summary:", err);
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
    } catch (e) { console.error(e); }
  }

  async function fetchDeviceTypes() {
    try {
      const res = await fetch(`${API}/device-types`, { 
        headers: { 'x-api-key': sessionStorage.getItem('app_password') || '' } 
      });
      if (res.ok) setDeviceTypes(await res.json());
    } catch (e) { console.error(e); }
  }

  async function fetchResults(device) {
    setSelectedDevice(device);
    setHistoryOpen(true);
    setLoading(true);
    try {
      const res = await fetch(`${API}/collections/${device.id}?collection_type=healthcheck`, { 
        headers: { 'x-api-key': sessionStorage.getItem('app_password') || '' } 
      });
      if (res.ok) {
        setResults(await res.json());
      }
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }

  async function triggerHealthcheck(id, e) {
    if (e) e.stopPropagation();
    setBatchStatuses(prev => ({ ...prev, [id]: 'pending' }));
    try {
      const saved = localStorage.getItem("running_healthchecks");
      const parsed = saved ? JSON.parse(saved) : {};
      parsed[id] = Date.now();
      localStorage.setItem("running_healthchecks", JSON.stringify(parsed));
    } catch (err) {}
    try {
      const url = `${API}/healthcheck/${id}${selectedCommandSource ? `?commands_source_path=${encodeURIComponent(selectedCommandSource)}` : ''}`;
      const res = await fetch(url, { 
        method: "POST", 
        headers: { 'x-api-key': sessionStorage.getItem('app_password') || '' } 
      });
      const data = await res.json();
      const statusVal = data.status === 'success' ? 'success' : 'failed';
      setBatchStatuses(prev => ({ ...prev, [id]: statusVal }));
      try {
        const saved = localStorage.getItem("running_healthchecks");
        if (saved) {
          const parsed = JSON.parse(saved);
          delete parsed[id];
          localStorage.setItem("running_healthchecks", JSON.stringify(parsed));
        }
      } catch (err) {}
      fetchSummaryDevices();
      if (selectedDevice?.id === id) {
        // Refresh history if current selected device is run
        const refreshRes = await fetch(`${API}/collections/${id}?collection_type=healthcheck`, {
          headers: { 'x-api-key': sessionStorage.getItem('app_password') || '' }
        });
        if (refreshRes.ok) setResults(await refreshRes.json());
      }

      const dev = devices.find(d => d.id === id);
      const hostname = dev?.hostname || `Device #${id}`;
      window.dispatchEvent(new CustomEvent('netact-notification', {
        detail: {
          type: 'healthcheck',
          status: statusVal,
          title: 'Healthcheck Completed',
          message: `Healthcheck for ${hostname} ${statusVal === 'success' ? 'succeeded' : 'failed'}.`,
          targetUrl: `/healthcheck/device/${id}`
        }
      }));
    } catch (err) {
      setBatchStatuses(prev => ({ ...prev, [id]: 'failed' }));
      try {
        const saved = localStorage.getItem("running_healthchecks");
        if (saved) {
          const parsed = JSON.parse(saved);
          delete parsed[id];
          localStorage.setItem("running_healthchecks", JSON.stringify(parsed));
        }
      } catch (err) {}

      const dev = devices.find(d => d.id === id);
      const hostname = dev?.hostname || `Device #${id}`;
      window.dispatchEvent(new CustomEvent('netact-notification', {
        detail: {
          type: 'healthcheck',
          status: 'failed',
          title: 'Healthcheck Failed',
          message: `Healthcheck execution failed for ${hostname}.`,
          targetUrl: `/healthcheck/device/${id}`
        }
      }));
    }
  }

  async function triggerBatchHealthcheck() {
    if (selectedForBatch.size === 0) return;
    const ids = Array.from(selectedForBatch);
    const initialStatuses = {};
    ids.forEach(id => { initialStatuses[id] = 'pending'; });
    setBatchStatuses(prev => ({ ...prev, ...initialStatuses }));
    await Promise.allSettled(ids.map(id => triggerHealthcheck(id)));
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

  async function viewFull(backupId) {
    try {
      const res = await fetch(`${API}/collections/${backupId}/full?collection_type=healthcheck&device_id=${selectedDevice?.id}`, {
        headers: { 'x-api-key': sessionStorage.getItem('app_password') || '' }
      });
      if (res.ok) {
        setFullResult(await res.json());
      }
    } catch (err) { console.error(err); }
  }

  // Reset modal search state when fullResult changes (modal opens/closes or switches device)
  useEffect(() => {
    setModalSearchTerm("");
    setDebouncedSearchTerm("");
    setTotalMatches(0);
    setCurrentMatchIndex(0);
    setTooManyMatches(false);
    setModalFullScreen(false);
  }, [fullResult]);

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
    if (!debouncedSearchTerm.trim() || !fullResult?.config_text) {
      setTotalMatches(0);
      return;
    }
    const escaped = debouncedSearchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escaped, 'gi');
    const matches = fullResult.config_text.match(regex);
    const count = matches ? matches.length : 0;
    setTotalMatches(count);

    if (count > 1000 || (fullResult.config_text.length > 200000 && debouncedSearchTerm.length < 2)) {
      setTooManyMatches(true);
    }
  }, [debouncedSearchTerm, fullResult]);

  const scrollToMatch = (index, prefix = 'hc-match') => {
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
        return `<mark id="hc-match-${idx}" class="hc-match" style="background-color: #ffc107; color: #000; padding: 0 2px; border-radius: 2px; transition: all 0.15s;">${escapeHtml(part)}</mark>`;
      }
      return escapeHtml(part);
    });
    
    return htmlParts.join('');
  }, []);

  const highlightedHtml = useMemo(() => {
    if (debouncedSearchTerm && !tooManyMatches && fullResult?.config_text) {
      return HighlightText(fullResult.config_text, debouncedSearchTerm);
    }
    if (fullResult?.config_text) {
      return HighlightVersionOutputHtml(fullResult.config_text, fullResult.eoleos_info, colors);
    }
    return "";
  }, [debouncedSearchTerm, tooManyMatches, fullResult, colors]);

  useEffect(() => {
    // 1. Reset any previously active match styling
    const activeElements = document.querySelectorAll('.hc-match-active');
    activeElements.forEach(el => {
      el.classList.remove('hc-match-active');
      el.style.backgroundColor = '#ffc107';
      el.style.boxShadow = '';
      el.style.fontWeight = 'normal';
    });

    // 2. Set the current match styling
    if (debouncedSearchTerm && totalMatches > 0 && !tooManyMatches) {
      const el = document.getElementById(`hc-match-${currentMatchIndex}`);
      if (el) {
        el.classList.add('hc-match-active');
        el.style.backgroundColor = '#ff9800';
        el.style.boxShadow = '0 0 0 2px rgba(255,255,255,0.5)';
        el.style.fontWeight = 'bold';
      }

      // 3. Scroll to the current match
      const timer = setTimeout(() => {
        scrollToMatch(currentMatchIndex, 'hc-match');
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [currentMatchIndex, debouncedSearchTerm, totalMatches, tooManyMatches, highlightedHtml]);

  // Dynamic command sources selection (filtered if group is selected, all unique sources if not)
  const activeCommandsSources = useMemo(() => {
    if (selectedGroup) {
      const grp = deviceGroups.find(g => g.group === selectedGroup);
      return grp?.commands_sources || [];
    }
    const list = [];
    const paths = new Set();
    deviceGroups.forEach(g => {
      if (g.commands_sources) {
        g.commands_sources.forEach(cs => {
          if (!paths.has(cs.path)) {
            paths.add(cs.path);
            list.push(cs);
          }
        });
      }
    });
    return list;
  }, [deviceGroups, selectedGroup]);

  // Extract unique options for columns dropdowns
  const modelOptions = useMemo(() => {
    const set = new Set(devices.map(d => d.device_type).filter(Boolean));
    return Array.from(set).sort();
  }, [devices]);

  const groupOptions = useMemo(() => {
    const set = new Set(devices.map(d => d.group || d.group_file).filter(Boolean));
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

  // Master filters computation
  const filteredAndQuickFilteredDevices = useMemo(() => {
    return devices.filter(d => {
      // Text Search
      const matchSearch = d.hostname.toLowerCase().includes(searchQuery.toLowerCase()) || d.ip_address.includes(searchQuery);
      
      // Toolbar selections
      const matchGroup = !selectedGroup || d.group_file === selectedGroup;
      const matchType = !selectedType || d.device_type === selectedType;
      
      if (!matchSearch || !matchGroup || !matchType) return false;

      // Spreadsheet header column filters
      if (filterName && !d.hostname.toLowerCase().includes(filterName.toLowerCase())) return false;
      if (filterIp && !d.ip_address.includes(filterIp)) return false;
      if (filterModel && d.device_type !== filterModel) return false;
      if (filterGroup && (d.group || d.group_file) !== filterGroup) return false;
      if (filterConnection && `${d.protocol}:${d.port}` !== filterConnection) return false;
      if (filterVendor && !d.vendor?.toLowerCase().includes(filterVendor.toLowerCase())) return false;
      
      if (filterUpdates) {
        const lastRun = d.healthcheck_summary?.last_healthcheck;
        if (filterUpdates === "success" && lastRun?.status !== "success") return false;
        if (filterUpdates === "failed" && lastRun?.status !== "failed" && lastRun !== null) return false;
        if (filterUpdates === "never" && lastRun !== null && lastRun !== undefined) return false;
      }
      
      if (filterTotalRuns) {
        const total = d.healthcheck_summary?.total_runs || 0;
        if (filterTotalRuns.startsWith(">")) {
          const num = Number(filterTotalRuns.slice(1));
          if (total <= num) return false;
        } else if (filterTotalRuns.startsWith("<")) {
          const num = Number(filterTotalRuns.slice(1));
          if (total >= num) return false;
        } else {
          const num = Number(filterTotalRuns);
          if (!isNaN(num) && total !== num) return false;
        }
      }

      // Quick visual cards selector presets
      const lastCheck = d.healthcheck_summary?.last_healthcheck;
      if (quickFilter === "success") {
        return lastCheck?.status === "success";
      }
      if (quickFilter === "failed") {
        return lastCheck?.status === "failed";
      }
      if (quickFilter === "never") {
        return !lastCheck;
      }

      return true; // 'all'
    });
  }, [devices, searchQuery, selectedGroup, selectedType, quickFilter, filterName, filterIp, filterModel, filterGroup, filterConnection, filterUpdates, filterTotalRuns, filterVendor]);

  // Visual card stats counts (always reflects overall raw list)
  const statsCounts = useMemo(() => {
    let success = 0;
    let failed = 0;
    let never = 0;

    devices.forEach(d => {
      const summary = d.healthcheck_summary || {};
      const lastCheck = summary.last_healthcheck;
      if (lastCheck?.status === "success") success++;
      else if (lastCheck?.status === "failed") failed++;
      else never++;
    });

    return {
      all: devices.length,
      success,
      failed,
      never
    };
  }, [devices]);

  // Clicked-slice stable cross-filtering algorithms
  
  // 1. Healthcheck Distribution Chart (Filters by all except filterUpdates)
  const distChartDevices = useMemo(() => {
    return devices.filter(d => {
      const matchSearch = d.hostname.toLowerCase().includes(searchQuery.toLowerCase()) || d.ip_address.includes(searchQuery);
      const matchGroup = !selectedGroup || d.group_file === selectedGroup;
      const matchType = !selectedType || d.device_type === selectedType;
      if (!matchSearch || !matchGroup || !matchType) return false;

      if (filterName && !d.hostname.toLowerCase().includes(filterName.toLowerCase())) return false;
      if (filterIp && !d.ip_address.includes(filterIp)) return false;
      if (filterModel && d.device_type !== filterModel) return false;
      if (filterGroup && (d.group || d.group_file) !== filterGroup) return false;
      if (filterConnection && `${d.protocol}:${d.port}` !== filterConnection) return false;
      if (filterVendor && !d.vendor?.toLowerCase().includes(filterVendor.toLowerCase())) return false;
      if (filterTotalRuns) {
        const total = d.healthcheck_summary?.total_runs || 0;
        if (filterTotalRuns.startsWith(">")) {
          const num = Number(filterTotalRuns.slice(1));
          if (total <= num) return false;
        } else if (filterTotalRuns.startsWith("<")) {
          const num = Number(filterTotalRuns.slice(1));
          if (total >= num) return false;
        } else {
          const num = Number(filterTotalRuns);
          if (!isNaN(num) && total !== num) return false;
        }
      }
      return true;
    });
  }, [devices, searchQuery, selectedGroup, selectedType, filterName, filterIp, filterModel, filterGroup, filterConnection, filterTotalRuns, filterVendor]);

  const distChartData = useMemo(() => {
    let success = 0;
    let failed = 0;
    let never = 0;
    distChartDevices.forEach(d => {
      const status = d.healthcheck_summary?.last_healthcheck?.status;
      if (status === "success") success++;
      else if (status === "failed") failed++;
      else never++;
    });
    return [
      { name: "Success", value: success, fill: colors.success },
      { name: "Failed", value: failed, fill: colors.danger },
      { name: "Never Run", value: never, fill: colors.gray }
    ];
  }, [distChartDevices, colors]);

  const distChartTotal = useMemo(() => distChartData.reduce((sum, item) => sum + item.value, 0), [distChartData]);

  // 2. Vendor Share Chart (Filters by all except filterVendor)
  const vendorChartDevices = useMemo(() => {
    return devices.filter(d => {
      const matchSearch = d.hostname.toLowerCase().includes(searchQuery.toLowerCase()) || d.ip_address.includes(searchQuery);
      const matchGroup = !selectedGroup || d.group_file === selectedGroup;
      const matchType = !selectedType || d.device_type === selectedType;
      if (!matchSearch || !matchGroup || !matchType) return false;

      if (filterName && !d.hostname.toLowerCase().includes(filterName.toLowerCase())) return false;
      if (filterIp && !d.ip_address.includes(filterIp)) return false;
      if (filterModel && d.device_type !== filterModel) return false;
      if (filterGroup && (d.group || d.group_file) !== filterGroup) return false;
      if (filterConnection && `${d.protocol}:${d.port}` !== filterConnection) return false;
      if (filterUpdates) {
        const lastRun = d.healthcheck_summary?.last_healthcheck;
        if (filterUpdates === "success" && lastRun?.status !== "success") return false;
        if (filterUpdates === "failed" && lastRun?.status !== "failed" && lastRun !== null) return false;
        if (filterUpdates === "never" && lastRun !== null && lastRun !== undefined) return false;
      }
      if (filterTotalRuns) {
        const total = d.healthcheck_summary?.total_runs || 0;
        if (filterTotalRuns.startsWith(">")) {
          const num = Number(filterTotalRuns.slice(1));
          if (total <= num) return false;
        } else if (filterTotalRuns.startsWith("<")) {
          const num = Number(filterTotalRuns.slice(1));
          if (total >= num) return false;
        } else {
          const num = Number(filterTotalRuns);
          if (!isNaN(num) && total !== num) return false;
        }
      }
      return true;
    });
  }, [devices, searchQuery, selectedGroup, selectedType, filterName, filterIp, filterModel, filterGroup, filterConnection, filterUpdates, filterTotalRuns]);

  const vendorChartData = useMemo(() => {
    const vendors = {};
    vendorChartDevices.forEach(d => {
      const v = (d.vendor || "unknown").toUpperCase();
      if (!vendors[v]) vendors[v] = { name: v, success: 0, failed: 0, never: 0, value: 0 };
      const status = d.healthcheck_summary?.last_healthcheck?.status;
      if (status === "success") vendors[v].success++;
      else if (status === "failed") vendors[v].failed++;
      else vendors[v].never++;
      vendors[v].value++;
    });
    return Object.values(vendors);
  }, [vendorChartDevices]);

  const vendorChartTotal = useMemo(() => vendorChartData.reduce((sum, item) => sum + item.value, 0), [vendorChartData]);

  // 3. Group Coverage Chart (Filters by all except filterGroup / selectedGroup)
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
        const lastRun = d.healthcheck_summary?.last_healthcheck;
        if (filterUpdates === "success" && lastRun?.status !== "success") return false;
        if (filterUpdates === "failed" && lastRun?.status !== "failed" && lastRun !== null) return false;
        if (filterUpdates === "never" && lastRun !== null && lastRun !== undefined) return false;
      }
      if (filterTotalRuns) {
        const total = d.healthcheck_summary?.total_runs || 0;
        if (filterTotalRuns.startsWith(">")) {
          const num = Number(filterTotalRuns.slice(1));
          if (total <= num) return false;
        } else if (filterTotalRuns.startsWith("<")) {
          const num = Number(filterTotalRuns.slice(1));
          if (total >= num) return false;
        } else {
          const num = Number(filterTotalRuns);
          if (!isNaN(num) && total !== num) return false;
        }
      }
      return true;
    });
  }, [devices, searchQuery, selectedType, filterName, filterIp, filterModel, filterConnection, filterUpdates, filterTotalRuns, filterVendor]);

  const groupChartData = useMemo(() => {
    const groups = {};
    groupChartDevices.forEach(d => {
      const g = d.group || d.group_file || "unknown";
      if (!groups[g]) groups[g] = { name: g, success: 0, failed: 0, never: 0, value: 0 };
      const status = d.healthcheck_summary?.last_healthcheck?.status;
      if (status === "success") groups[g].success++;
      else if (status === "failed") groups[g].failed++;
      else groups[g].never++;
      groups[g].value++;
    });
    return Object.values(groups);
  }, [groupChartDevices]);

  const groupChartTotal = useMemo(() => groupChartData.reduce((sum, item) => sum + item.value, 0), [groupChartData]);

  // Click slices handlers
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
    setFilterVendor("");
    setFilterUpdates("");
    setFilterTotalRuns("");
    setSearchQuery("");
    setSelectedGroup("");
    setSelectedType("");
    setSelectedCommandSource("");
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
    if (filterUpdates) pills.push({ key: "updates", label: `Last Status: ${filterUpdates}`, clear: () => setFilterUpdates("") });
    if (filterTotalRuns) pills.push({ key: "runs", label: `Runs: ${filterTotalRuns}`, clear: () => setFilterTotalRuns("") });
    if (searchQuery) pills.push({ key: "search", label: `Search: ${searchQuery}`, clear: () => setSearchQuery("") });
    return pills;
  }, [filterName, filterIp, filterModel, filterGroup, filterConnection, filterUpdates, filterTotalRuns, searchQuery, filterVendor]);

  // Card progress bar percentages
  const neverPct = useMemo(() => {
    if (!statsCounts.all) return 0;
    return Math.round((statsCounts.never / statsCounts.all) * 100);
  }, [statsCounts]);

  const successPct = useMemo(() => {
    const attempted = statsCounts.success + statsCounts.failed;
    if (!attempted) return 0;
    return Math.round((statsCounts.success / attempted) * 100);
  }, [statsCounts]);

  const failedPct = useMemo(() => {
    const attempted = statsCounts.success + statsCounts.failed;
    if (!attempted) return 0;
    return Math.round((statsCounts.failed / attempted) * 100);
  }, [statsCounts]);

  // Pagination computes
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

  // Polished JSON exporter
  const exportJsonReport = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(filteredAndQuickFilteredDevices, null, 2));
    const a = document.createElement("a");
    a.setAttribute("href", dataStr);
    a.setAttribute("download", `netact_healthchecks_filtered_${new Date().toISOString().slice(0,10)}.json`);
    a.click();
  };

  // Polished PDF exporter
  const exportPdfReport = () => {
    window.print();
  };

  // Enriched Excel CSV exporter
  const exportCsvReport = () => {
    let content = "";
    content += `"NETACT HEALTHCHECK DIAGNOSTICS EXECUTIVE ANALYTICS REPORT"\n`;
    content += `"Exported At:","${new Date().toLocaleString()}"\n`;
    
    const activeFiltersStr = activeFiltersPills.map(p => p.label).join(" | ") || "none";
    content += `"Active Filters:","${activeFiltersStr.replace(/"/g, '""')}"\n\n`;
    
    content += `"HEALTHCHECK DASHBOARD OVERVIEW SUMMARY"\n`;
    content += `"Metric","Count","Percentage"\n`;
    content += `"Total Nodes",${statsCounts.all},"100%"\n`;
    content += `"Never Run Checked",${statsCounts.never},"${neverPct}%"\n`;
    content += `"Diagnostic Success",${statsCounts.success},"${successPct}%"\n`;
    content += `"Diagnostic Failed",${statsCounts.failed},"${failedPct}%"\n\n`;
    
    content += `"DIAGNOSTIC DISTRIBUTION SUMMARY"\n`;
    content += `"Category","Count","Percentage"\n`;
    distChartData.forEach(d => {
      const percentage = distChartTotal ? Math.round((d.value / distChartTotal) * 100) : 0;
      content += `"${d.name}",${d.value},"${percentage}%"\n`;
    });
    content += `\n`;
    
    content += `"VENDOR DIAGNOSTIC BREAKDOWN"\n`;
    content += `"Vendor","Total Nodes","Success","Failed","Never"\n`;
    vendorChartData.forEach(v => {
      content += `"${v.name}",${v.value},${v.success},${v.failed},${v.never}\n`;
    });
    content += `\n`;
    
    content += `"GROUP DIAGNOSTIC COVERAGE SUMMARY"\n`;
    content += `"Group","Total Nodes","Success","Failed","Never"\n`;
    groupChartData.forEach(g => {
      content += `"${g.name}",${g.value},${g.success},${g.failed},${g.never}\n`;
    });
    content += `\n`;
    
    content += `"DETAILED DIAGNOSTIC DEVICES RECORDS GRID"\n`;
    const headers = ["Name", "IP Address", "Model", "Group", "Connection", "Vendor", "Last Attempt Date", "Last Attempt Status", "Success RunsCount", "Failed RunsCount", "Total RunsCount"];
    content += headers.map(h => `"${h}"`).join(",") + "\n";
    
    filteredAndQuickFilteredDevices.forEach(d => {
      const summary = d.healthcheck_summary || {};
      const lastCheck = summary.last_healthcheck;
      const row = [
        d.hostname,
        d.ip_address,
        d.device_type,
        d.group || d.group_file || "unknown",
        `${d.protocol}:${d.port}`,
        d.vendor || "",
        lastCheck ? new Date(lastCheck.collected_at).toLocaleString() : "Never",
        lastCheck ? lastCheck.status : "Never",
        summary.success_count || 0,
        summary.failed_count || 0,
        summary.total_runs || 0
      ];
      content += row.map(val => `"${val.toString().replace(/"/g, '""')}"`).join(",") + "\n";
    });
    
    const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.setAttribute("href", url);
    a.setAttribute("download", `netact_healthcheck_analytics_${new Date().toISOString().slice(0,10)}.csv`);
    a.click();
    URL.revokeObjectURL(url);
  };

  // Recharts Chart Renderer
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
                onClick={onChartClick}
                cursor="pointer"
              >
                {data.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.fill || colors.primary} />
                ))}
              </Pie>
              <ChartTooltip {...tooltipProps} />
            </PieChart>
          </ResponsiveContainer>
          {mode === "donut" && (
            <DonutCenter total={totalCount} label="Nodes" colors={colors} />
          )}
        </div>
      );
    }

    if (mode === "bar-v") {
      return (
        <div style={{ height: 180 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 5 }} onClick={onChartClick} style={{ cursor: 'pointer' }}>
              {showGrids && <CartesianGrid strokeDasharray="3 3" opacity={isDark ? 0.08 : 0.4} />}
              <XAxis dataKey="name" stroke={colors.gray} fontSize={9} tickLine={false} />
              <YAxis stroke={colors.gray} fontSize={9} tickLine={false} />
              <ChartTooltip {...tooltipProps} />
              <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                {data.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.fill || colors.primary} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      );
    }

    if (mode === "bar-h") {
      return (
        <div style={{ height: 180 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart layout="vertical" data={data} margin={{ top: 10, right: 10, left: -10, bottom: 5 }} onClick={onChartClick} style={{ cursor: 'pointer' }}>
              {showGrids && <CartesianGrid strokeDasharray="3 3" opacity={isDark ? 0.08 : 0.4} />}
              <XAxis type="number" stroke={colors.gray} fontSize={9} tickLine={false} />
              <YAxis type="category" dataKey="name" stroke={colors.gray} fontSize={9} tickLine={false} width={70} />
              <ChartTooltip {...tooltipProps} />
              <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                {data.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.fill || colors.primary} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      );
    }

    return null;
  };

  return (
    <div style={styles.container}>
      
      {/* ─── 1. COLLAPSIBLE TOP DRAWER VISUAL CONSOLE ─── */}
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
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: colors.light, letterSpacing: "-0.3px" }}>Health Diagnostics Analytics Console</h3>
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
            maxHeight: dashboardOpen ? (dashboardMaximized ? "85vh" : "800px") : "0px",
            opacity: dashboardOpen ? 1 : 0,
            overflow: "hidden",
            transition: "all 0.5s cubic-bezier(0.4, 0, 0.2, 1)"
          }}
          className="chart-print-row"
        >
          {dashboardOpen && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 20 }}>
              
              {/* Chart 1: Diagnostics Attempt Status */}
              <div style={{ 
                background: "var(--surface)", 
                borderRadius: 12, padding: "14px 16px", border: "1px solid var(--border-whisper)",
                position: "relative"
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: colors.gray }}>Diagnostic Status</div>
                  <ModeToggle modes={CHART_MODES} current={distChartMode} onChange={setDistChartMode} styles={styles} colors={colors} />
                </div>
                {renderChart(distChartData, distChartMode, handleDistChartClick)}
              </div>

              {/* Chart 2: Vendor Diagnostics breakdown */}
              <div style={{ 
                background: "var(--surface)", 
                borderRadius: 12, padding: "14px 16px", border: "1px solid var(--border-whisper)"
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: colors.gray }}>Vendor Breakdown</div>
                  <ModeToggle modes={CHART_MODES} current={vendorChartMode} onChange={setVendorChartMode} styles={styles} colors={colors} />
                </div>
                {renderChart(vendorChartData.map(v => ({ name: v.name, value: v.value, fill: colors.primary })), vendorChartMode, handleVendorChartClick)}
              </div>

              {/* Chart 3: Group Diagnostics Coverage */}
              <div style={{ 
                background: "var(--surface)", 
                borderRadius: 12, padding: "14px 16px", border: "1px solid var(--border-whisper)"
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: colors.gray }}>Group Coverage</div>
                  <ModeToggle modes={CHART_MODES} current={groupChartMode} onChange={setGroupChartMode} styles={styles} colors={colors} />
                </div>
                {renderChart(groupChartData.map(g => ({ name: g.name, value: g.value, fill: colors.info })), groupChartMode, handleGroupChartClick)}
              </div>

            </div>
          )}
        </div>
      </div>

      {/* ─── 2. HIGH-END 4-DECK STATS CARDS ROW ─── */}
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 20,
        marginTop: 18, marginBottom: 20
      }}>
        
        {/* CARD 1: Total Checked Nodes */}
        <div 
          onClick={() => setQuickFilter("all")}
          style={{
            background: "var(--surface)",
            border: `1px solid ${quickFilter === "all" ? colors.primary : "var(--border-whisper)"}`,
            borderRadius: 16, padding: "18px 20px", cursor: "pointer", position: "relative", overflow: "hidden",
            boxShadow: quickFilter === "all" ? `0 8px 30px ${colors.primary}30` : `0 4px 12px rgba(0,0,0,${isDark ? 0.2 : 0.04})`,
            transform: quickFilter === "all" ? "translateY(-4px)" : "none",
            transition: "all .3s cubic-bezier(0.4, 0, 0.2, 1)"
          }}
          className="kpi-card"
          onMouseEnter={e => {
            e.currentTarget.style.transform = "translateY(-4px)";
            e.currentTarget.style.boxShadow = `0 12px 28px ${colors.primary}20`;
          }}
          onMouseLeave={e => {
            const isActive = quickFilter === "all";
            e.currentTarget.style.transform = isActive ? "translateY(-4px)" : "none";
            e.currentTarget.style.boxShadow = isActive ? `0 8px 30px ${colors.primary}30` : `0 4px 12px rgba(0,0,0,${isDark ? 0.2 : 0.04})`;
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", color: colors.gray }}>Total Checked Nodes</span>
            <span style={{ fontSize: 20 }}>🖥️</span>
          </div>
          <div style={{ fontSize: 28, fontWeight: 900, color: colors.light, marginTop: 12 }}>{statsCounts.all}</div>
          <div style={{ position: "absolute", bottom: 0, left: 0, width: "100%", height: 4, background: colors.primary }} />
        </div>

        {/* CARD 2: Success diagnostics */}
        <div 
          onClick={() => setQuickFilter("success")}
          style={{
            background: "var(--surface)",
            border: `1px solid ${quickFilter === "success" ? colors.success : "var(--border-whisper)"}`,
            borderRadius: 16, padding: "18px 20px", cursor: "pointer", position: "relative", overflow: "hidden",
            boxShadow: quickFilter === "success" ? `0 8px 30px ${colors.success}30` : `0 4px 12px rgba(0,0,0,${isDark ? 0.2 : 0.04})`,
            transform: quickFilter === "success" ? "translateY(-4px)" : "none",
            transition: "all .3s cubic-bezier(0.4, 0, 0.2, 1)"
          }}
          className="kpi-card"
          onMouseEnter={e => {
            e.currentTarget.style.transform = "translateY(-4px)";
            e.currentTarget.style.boxShadow = `0 12px 28px ${colors.success}20`;
          }}
          onMouseLeave={e => {
            const isActive = quickFilter === "success";
            e.currentTarget.style.transform = isActive ? "translateY(-4px)" : "none";
            e.currentTarget.style.boxShadow = isActive ? `0 8px 30px ${colors.success}30` : `0 4px 12px rgba(0,0,0,${isDark ? 0.2 : 0.04})`;
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", color: colors.gray }}>Diagnostic Success</span>
            <span style={{ fontSize: 10, fontWeight: 700, color: colors.success, background: `${colors.success}20`, padding: "2px 6px", borderRadius: 10 }}>{successPct}%</span>
          </div>
          <div style={{ fontSize: 28, fontWeight: 900, color: colors.success, marginTop: 12 }}>{statsCounts.success}</div>
          <div style={{ position: "absolute", bottom: 0, left: 0, width: `${successPct}%`, height: 4, background: colors.success, transition: "width .5s" }} />
        </div>

        {/* CARD 3: Failed diagnostics */}
        <div 
          onClick={() => setQuickFilter("failed")}
          style={{
            background: "var(--surface)",
            border: `1px solid ${quickFilter === "failed" ? colors.danger : "var(--border-whisper)"}`,
            borderRadius: 16, padding: "18px 20px", cursor: "pointer", position: "relative", overflow: "hidden",
            boxShadow: quickFilter === "failed" ? `0 8px 30px ${colors.danger}30` : `0 4px 12px rgba(0,0,0,${isDark ? 0.2 : 0.04})`,
            transform: quickFilter === "failed" ? "translateY(-4px)" : "none",
            transition: "all .3s cubic-bezier(0.4, 0, 0.2, 1)"
          }}
          className="kpi-card"
          onMouseEnter={e => {
            e.currentTarget.style.transform = "translateY(-4px)";
            e.currentTarget.style.boxShadow = `0 12px 28px ${colors.danger}20`;
          }}
          onMouseLeave={e => {
            const isActive = quickFilter === "failed";
            e.currentTarget.style.transform = isActive ? "translateY(-4px)" : "none";
            e.currentTarget.style.boxShadow = isActive ? `0 8px 30px ${colors.danger}30` : `0 4px 12px rgba(0,0,0,${isDark ? 0.2 : 0.04})`;
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", color: colors.gray }}>Diagnostic Failures</span>
            <span style={{ fontSize: 10, fontWeight: 700, color: colors.danger, background: `${colors.danger}20`, padding: "2px 6px", borderRadius: 10 }}>{failedPct}%</span>
          </div>
          <div style={{ fontSize: 28, fontWeight: 900, color: colors.danger, marginTop: 12 }}>{statsCounts.failed}</div>
          <div style={{ position: "absolute", bottom: 0, left: 0, width: `${failedPct}%`, height: 4, background: colors.danger, transition: "width .5s" }} />
        </div>

        {/* CARD 4: Never Run Checked */}
        <div 
          onClick={() => setQuickFilter("never")}
          style={{
            background: "var(--surface)",
            border: `1px solid ${quickFilter === "never" ? colors.gray : "var(--border-whisper)"}`,
            borderRadius: 16, padding: "18px 20px", cursor: "pointer", position: "relative", overflow: "hidden",
            boxShadow: quickFilter === "never" ? `0 8px 30px ${colors.gray}30` : `0 4px 12px rgba(0,0,0,${isDark ? 0.2 : 0.04})`,
            transform: quickFilter === "never" ? "translateY(-4px)" : "none",
            transition: "all .3s cubic-bezier(0.4, 0, 0.2, 1)"
          }}
          className="kpi-card"
          onMouseEnter={e => {
            e.currentTarget.style.transform = "translateY(-4px)";
            e.currentTarget.style.boxShadow = `0 12px 28px ${colors.gray}20`;
          }}
          onMouseLeave={e => {
            const isActive = quickFilter === "never";
            e.currentTarget.style.transform = isActive ? "translateY(-4px)" : "none";
            e.currentTarget.style.boxShadow = isActive ? `0 8px 30px ${colors.gray}30` : `0 4px 12px rgba(0,0,0,${isDark ? 0.2 : 0.04})`;
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", color: colors.gray }}>Never Diagnosed</span>
            <span style={{ fontSize: 10, fontWeight: 700, color: colors.gray, background: `${colors.gray}20`, padding: "2px 6px", borderRadius: 10 }}>{neverPct}%</span>
          </div>
          <div style={{ fontSize: 28, fontWeight: 900, color: colors.gray, marginTop: 12 }}>{statsCounts.never}</div>
          <div style={{ position: "absolute", bottom: 0, left: 0, width: `${neverPct}%`, height: 4, background: colors.gray, transition: "width .5s" }} />
        </div>

      </div>

      {/* ─── 3. TABLE FILTERS TOOLBAR ─── */}
      <div style={{ ...styles.panel, padding: "16px 20px", borderRadius: 16, marginBottom: 16 }} className="no-print">
        
        {/* Dynamic active pills container */}
        {activeFiltersPills.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
            <span style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", color: colors.gray, display: "flex", alignItems: "center" }}>
              Active Facets:
            </span>
            {activeFiltersPills.map(p => (
              <span key={p.key} style={{
                fontSize: 10, fontWeight: 700, color: colors.light, background: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)",
                padding: "3px 8px", borderRadius: 6, display: "flex", alignItems: "center", gap: 6,
                border: `1.5px solid ${colors.border}`, boxShadow: "0 0 10px rgba(0,0,0,0.05)"
              }}>
                {p.label}
                <button onClick={p.clear} style={{
                  background: "none", border: "none", color: colors.danger, padding: 0,
                  fontSize: 10, cursor: "pointer", fontWeight: "bold", marginLeft: 2
                }}>✕</button>
              </span>
            ))}
            <button onClick={clearAllFilters} style={{
              background: "none", border: "none", color: colors.primary, fontSize: 10,
              fontWeight: 800, cursor: "pointer", textDecoration: "underline"
            }}>Clear All Filters</button>
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 16 }}>
          
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            
            {/* Selection filters */}
            <select value={selectedGroup} onChange={e => { setSelectedGroup(e.target.value); setSelectedCommandSource(""); }} style={{ ...styles.input, width: 140 }}>
              <option value="">All Groups</option>
              {deviceGroups.map(g => <option key={g.group} value={g.group}>{g.group}</option>)}
            </select>

            {activeCommandsSources.length > 0 && (
              <select value={selectedCommandSource} onChange={e => setSelectedCommandSource(e.target.value)} style={{ ...styles.input, width: 180 }}>
                <option value="">Default Commands</option>
                {activeCommandsSources.map(cs => (
                  <option key={cs.path} value={cs.path}>{cs.name}</option>
                ))}
              </select>
            )}

            <select value={selectedType} onChange={e => setSelectedType(e.target.value)} style={{ ...styles.input, width: 140 }}>
              <option value="">All Device Types</option>
              {deviceTypes.map(t => <option key={t} value={t}>{t}</option>)}
            </select>

            {/* Quick Text Search */}
            <input 
              type="text" placeholder="Fuzzy text search (name, ip)..." value={searchQuery} 
              onChange={e => setSearchQuery(e.target.value)} style={{ ...styles.input, width: 220 }} 
            />

          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            
            {/* Batch execution controls */}
            <button onClick={() => selectAllFiltered(filteredAndQuickFilteredDevices)} style={styles.buttonSecondary}>
              {selectedForBatch.size === filteredAndQuickFilteredDevices.length && filteredAndQuickFilteredDevices.length > 0 ? "Deselect All" : "Select All Filtered"}
            </button>
            
            {!isViewer && (
              <button onClick={triggerBatchHealthcheck} style={styles.buttonPrimary} disabled={selectedForBatch.size === 0}>
                Run Batch ({selectedForBatch.size})
              </button>
            )}

            {/* Export controls */}
            <div style={{ display: "flex", border: `1px solid ${colors.border}`, borderRadius: 8, overflow: "hidden" }}>
              <button onClick={exportCsvReport} style={{ ...styles.buttonSecondary, padding: "8px 12px", border: "none", borderRadius: 0 }} title="Export spreadsheet to CSV (Excel)">
                📁 CSV Excel
              </button>
              <button onClick={exportJsonReport} style={{ ...styles.buttonSecondary, padding: "8px 12px", border: "none", borderRadius: 0, borderLeft: `1px solid ${colors.border}` }} title="Export to JSON text">
                📄 JSON
              </button>
              <button onClick={exportPdfReport} style={{ ...styles.buttonSecondary, padding: "8px 12px", border: "none", borderRadius: 0, borderLeft: `1px solid ${colors.border}` }} title="Print visual report PDF">
                🖨️ Print PDF
              </button>
            </div>

          </div>

        </div>

      </div>

      {/* ─── 4. HIGH-DENSITY FACETED TABLE GRID ─── */}
      <div style={{ ...styles.panel, borderRadius: 16, overflow: "hidden" }}>
        
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              {/* Header Title Row */}
              <tr style={{ 
                background: isDark ? "rgba(15, 23, 42, 0.5)" : "rgba(241, 245, 249, 0.8)",
                borderBottom: `1.5px solid ${colors.border}`
              }}>
                <th style={{ padding: "12px 14px", width: 40, textAlign: "center" }}>
                  <input 
                    type="checkbox" 
                    checked={filteredAndQuickFilteredDevices.length > 0 && selectedForBatch.size === filteredAndQuickFilteredDevices.length}
                    onChange={() => selectAllFiltered(filteredAndQuickFilteredDevices)}
                  />
                </th>
                <th style={{ padding: "12px 14px", textAlign: "left", fontWeight: 700, color: colors.light }}>Name</th>
                <th style={{ padding: "12px 14px", textAlign: "left", fontWeight: 700, color: colors.light }}>IP Address</th>
                <th style={{ padding: "12px 14px", textAlign: "left", fontWeight: 700, color: colors.light }}>Model</th>
                <th style={{ padding: "12px 14px", textAlign: "left", fontWeight: 700, color: colors.light }}>Group</th>
                <th style={{ padding: "12px 14px", textAlign: "left", fontWeight: 700, color: colors.light }}>Connection</th>
                <th style={{ padding: "12px 14px", textAlign: "left", fontWeight: 700, color: colors.light }}>Vendor</th>
                <th style={{ padding: "12px 14px", textAlign: "left", fontWeight: 700, color: colors.light }}>Last Updates</th>
                <th style={{ padding: "12px 14px", textAlign: "left", fontWeight: 700, color: colors.light }}>Last Changed</th>
                <th style={{ padding: "12px 14px", textAlign: "right", fontWeight: 700, color: colors.light }} className="no-print">Actions</th>
              </tr>
              
              {/* Spreadsheet Faceted Filter inputs Row */}
              <tr style={{ 
                background: "var(--surface-container)",
                borderBottom: "1.5px solid var(--border-whisper)"
              }} className="no-print">
                <td style={{ padding: 6 }}></td>
                <td style={{ padding: 6 }}>
                  <input 
                    type="text" placeholder="Filter Name..." value={filterName}
                    onChange={e => setFilterName(e.target.value)}
                    style={{ ...styles.input, width: "92%", padding: "4px 8px", fontSize: 11 }}
                  />
                </td>
                <td style={{ padding: 6 }}>
                  <input 
                    type="text" placeholder="Filter IP..." value={filterIp}
                    onChange={e => setFilterIp(e.target.value)}
                    style={{ ...styles.input, width: "92%", padding: "4px 8px", fontSize: 11 }}
                  />
                </td>
                <td style={{ padding: 6 }}>
                  <select 
                    value={filterModel} onChange={e => setFilterModel(e.target.value)}
                    style={{ ...styles.input, width: "96%", padding: "3px 6px", fontSize: 11 }}
                  >
                    <option value="">All</option>
                    {modelOptions.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </td>
                <td style={{ padding: 6 }}>
                  <select 
                    value={filterGroup} onChange={e => setFilterGroup(e.target.value)}
                    style={{ ...styles.input, width: "96%", padding: "3px 6px", fontSize: 11 }}
                  >
                    <option value="">All</option>
                    {groupOptions.map(g => <option key={g} value={g}>{g}</option>)}
                  </select>
                </td>
                <td style={{ padding: 6 }}>
                  <select 
                    value={filterConnection} onChange={e => setFilterConnection(e.target.value)}
                    style={{ ...styles.input, width: "96%", padding: "3px 6px", fontSize: 11 }}
                  >
                    <option value="">All</option>
                    {connectionOptions.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </td>
                <td style={{ padding: 6 }}>
                  <select 
                    value={filterVendor} onChange={e => setFilterVendor(e.target.value)}
                    style={{ ...styles.input, width: "96%", padding: "3px 6px", fontSize: 11 }}
                  >
                    <option value="">All</option>
                    {vendorOptions.map(v => <option key={v} value={v}>{v.toUpperCase()}</option>)}
                  </select>
                </td>
                <td style={{ padding: 6 }}>
                  <select 
                    value={filterUpdates} onChange={e => setFilterUpdates(e.target.value)}
                    style={{ ...styles.input, width: "96%", padding: "3px 6px", fontSize: 11 }}
                  >
                    <option value="">All</option>
                    <option value="success">Success Only</option>
                    <option value="failed">Failed Only</option>
                    <option value="never">Never checked</option>
                  </select>
                </td>
                <td style={{ padding: 6 }}>
                  <input 
                    type="text" placeholder="e.g. >0" value={filterTotalRuns}
                    onChange={e => setFilterTotalRuns(e.target.value)}
                    style={{ ...styles.input, width: "88%", padding: "4px 8px", fontSize: 11 }}
                  />
                </td>
                <td style={{ padding: 6 }} className="no-print"></td>
              </tr>
            </thead>
            <tbody>
              {loading && filteredAndQuickFilteredDevices.length === 0 ? (
                <tr>
                  <td colSpan="10" style={{ padding: 40, textAlign: "center", color: colors.gray }}>
                    ⏳ Gathering device diagnostic history metrics...
                  </td>
                </tr>
              ) : paginatedDevices.length === 0 ? (
                <tr>
                  <td colSpan="10" style={{ padding: 40, textAlign: "center", color: colors.gray }}>
                    🔍 No checked devices matching active spreadsheet filters.
                  </td>
                </tr>
              ) : (
                paginatedDevices.map((d, index) => {
                  const summary = d.healthcheck_summary || {};
                  const lastCheck = summary.last_healthcheck;
                  const batchStatus = batchStatuses[d.id];
                  
                  return (
                    <tr 
                      key={d.id} 
                      style={{ 
                        borderBottom: `1px solid ${colors.border}`,
                        background: index % 2 === 0 ? "transparent" : (isDark ? "rgba(255,255,255,0.015)" : "rgba(0,0,0,0.01)"),
                        transition: "background .15s"
                      }}
                      className="hover-row"
                    >
                      <td style={{ padding: "10px 14px", textAlign: "center" }}>
                        <input 
                          type="checkbox" 
                          checked={selectedForBatch.has(d.id)}
                          onChange={e => toggleBatchSelection(d.id, e)}
                        />
                      </td>
                      <td style={{ padding: "10px 14px", fontWeight: 700 }}>
                        <Link 
                          to={`/healthcheck/device/${d.id}`}
                          style={{
                            color: colors.primary, fontWeight: 700,
                            textDecoration: "underline", fontFamily: "inherit"
                          }}
                        >
                          {d.hostname}
                        </Link>
                      </td>
                      <td style={{ padding: "10px 14px", fontFamily: "monospace", opacity: 0.8 }}>
                        {d.ip_address}
                      </td>
                      <td style={{ padding: "10px 14px" }}>
                        {d.device_type}
                      </td>
                      <td style={{ padding: "10px 14px" }}>
                        {d.group || d.group_file || "unknown"}
                      </td>
                      <td style={{ padding: "10px 14px", fontSize: 11, fontFamily: "monospace", opacity: 0.8 }}>
                        {d.protocol}:{d.port}
                      </td>
                      <td style={{ padding: "10px 14px", fontSize: 11, opacity: 0.8 }}>
                        {d.vendor?.toUpperCase()}
                      </td>
                      
                      {/* Last diagnostic run Attempt info */}
                      <td style={{ padding: "10px 14px" }}>
                        {lastCheck ? (
                          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                              <span style={getBadgeStyle(lastCheck.status, colors)}>{lastCheck.status}</span>
                              <span style={{ fontSize: 10, color: colors.gray }}>
                                {new Date(lastCheck.collected_at).toLocaleString()}
                              </span>
                            </div>
                            {lastCheck.error_msg && (
                              <div style={{ fontSize: 10, color: colors.danger, opacity: 0.8, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={lastCheck.error_msg}>
                                ⚠️ {lastCheck.error_msg}
                              </div>
                            )}
                          </div>
                        ) : (
                          <span style={getBadgeStyle("never", colors)}>Never</span>
                        )}
                      </td>
                      
                      {/* Total runs attempt counts */}
                      <td style={{ padding: "10px 14px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ fontWeight: 700, color: colors.light }}>{summary.total_runs || 0}</span>
                          {summary.total_runs > 0 && (
                            <span style={{ fontSize: 11, color: colors.gray }}>
                              ({summary.success_count || 0} ✅ / {summary.failed_count || 0} ❌)
                            </span>
                          )}
                        </div>
                      </td>
                      
                      {/* Row actions block */}
                      <td style={{ padding: "10px 14px", textAlign: "right" }} className="no-print">
                        <div style={{ display: "inline-flex", gap: 6 }}>
                          <button 
                            onClick={e => triggerHealthcheck(d.id, e)} 
                            style={{ 
                              width: 32,
                              height: 32,
                              borderRadius: 8,
                              border: `1px solid var(--border-whisper)`,
                              background: 'var(--surface-container)',
                              color: colors.primary,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              cursor: 'pointer',
                              transition: 'all 0.2s',
                              padding: 0
                            }}
                            disabled={batchStatus === 'pending' || isViewer}
                            title={batchStatus === 'pending' ? 'Checking...' : 'Run Diagnostics Check'}
                            className={batchStatus === 'pending' ? "status-blinking" : ""}
                          >
                            {batchStatus === 'pending' ? (
                              <span style={{ display: 'inline-block', animation: "spin 1s linear infinite" }}>🔄</span>
                            ) : (
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
                            )}
                          </button>
                          <Link 
                            to={`/healthcheck/device/${d.id}`}
                            style={{ 
                              width: 32,
                              height: 32,
                              borderRadius: 8,
                              border: `1px solid var(--border-whisper)`,
                              background: 'var(--surface-container)',
                              color: colors.info,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              cursor: 'pointer',
                              transition: 'all 0.2s',
                              textDecoration: 'none',
                              padding: 0
                            }}
                            title="View Diagnostics History"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                          </Link>
                        </div>
                      </td>

                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* ─── 5. PREMIUM PAGINATION CONTROLS ─── */}
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          padding: "12px 20px", borderTop: "1.5px solid var(--border-whisper)",
          background: "var(--surface-container)"
        }} className="no-print">
          
          <div style={{ fontSize: 12, color: colors.gray }}>
            Showing <strong>{filteredAndQuickFilteredDevices.length > 0 ? (currentPage - 1) * (itemsPerPage === 'all' ? filteredAndQuickFilteredDevices.length : Number(itemsPerPage)) + 1 : 0}</strong> to <strong>{Math.min(currentPage * (itemsPerPage === 'all' ? filteredAndQuickFilteredDevices.length : Number(itemsPerPage)), filteredAndQuickFilteredDevices.length)}</strong> of <strong>{filteredAndQuickFilteredDevices.length}</strong> devices
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            
            {/* Items per page selector */}
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: colors.gray }}>
              <span>Show</span>
              <select 
                value={itemsPerPage} onChange={e => { setItemsPerPage(e.target.value); setCurrentPage(1); }} 
                style={{ ...styles.input, padding: "3px 8px", fontSize: 12, width: 70 }}
              >
                <option value="10">10</option>
                <option value="50">50</option>
                <option value="100">100</option>
                <option value="all">All</option>
              </select>
              <span>entries</span>
            </div>

            {/* Nav Arrows */}
            {itemsPerPage !== 'all' && totalPages > 1 && (
              <div style={{ display: "flex", gap: 4 }}>
                <button 
                  onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                  disabled={currentPage === 1}
                  style={{ ...styles.buttonSecondary, padding: "5px 10px", fontSize: 11 }}
                >
                  ◀
                </button>
                <span style={{ fontSize: 12, color: colors.light, padding: "6px 12px", background: isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)", borderRadius: 6, fontWeight: 700 }}>
                  Page {currentPage} of {totalPages}
                </span>
                <button 
                  onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                  disabled={currentPage === totalPages}
                  style={{ ...styles.buttonSecondary, padding: "5px 10px", fontSize: 11 }}
                >
                  ▶
                </button>
              </div>
            )}

          </div>

        </div>

      </div>

      {/* ─── 6. DETAIL HISTORY SLIDING DRAWER MODAL ─── */}
      {historyOpen && selectedDevice && (
        <div 
          style={styles.modalBackdrop} 
          onClick={() => { setHistoryOpen(false); setResults([]); }}
        >
          <div 
            style={{ ...styles.modalCard, maxWidth: '90vw', width: '560px', borderRadius: "20px 0 0 20px", height: '100vh', margin: 0, position: 'fixed', right: 0, top: 0, animation: 'slideIn .3s ease' }} 
            onClick={e => e.stopPropagation()}
          >
            <div style={styles.modalHeader}>
              <div>
                <h3 style={styles.modalTitle}>Diagnostic History</h3>
                <div style={{ fontSize: 12, color: colors.gray, marginTop: 4 }}>{selectedDevice.hostname} ({selectedDevice.ip_address})</div>
              </div>
              <button 
                onClick={() => { setHistoryOpen(false); setResults([]); }} 
                style={styles.closeButton}
              >✕</button>
            </div>
            
            <div style={{ ...styles.modalBody, height: 'calc(100vh - 100px)', overflowY: 'auto', padding: 20 }}>
              
              {/* Donut Success rate indicator */}
              {results.length > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 16, background: "var(--surface-solid)", border: "1px solid var(--border-whisper)", borderRadius: 16, marginBottom: 20 }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 800, color: colors.light }}>Diagnostic Success Rate</div>
                    <div style={{ fontSize: 10, color: colors.gray, marginTop: 2 }}>Last {results.length} checks analysis</div>
                  </div>
                  <RatioCircle 
                    success={results.filter(c => c.status === "success").length} 
                    fail={results.filter(c => c.status !== "success").length} 
                    colors={colors} 
                  />
                </div>
              )}

              {/* History list card elements */}
              {loading && results.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 40, color: colors.gray }}>⏳ Reading run records...</div>
              ) : results.length === 0 ? (
                <div style={styles.emptyState}>No previous diagnostic runs found for this node.</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {results.map(c => (
                    <div key={c.id} style={{ 
                      background: isDark ? "rgba(15, 23, 42, 0.25)" : "#fff",
                      border: `1.5px solid ${colors.border}`, borderRadius: 14, padding: 14,
                      boxShadow: "0 4px 6px -1px rgba(0,0,0,0.05)"
                    }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                        <span style={getBadgeStyle(c.status, colors)}>{c.status}</span>
                        <span style={{ fontSize: 11, color: colors.gray, fontFamily: "monospace" }}>
                          {new Date(c.collected_at).toLocaleString()}
                        </span>
                      </div>
                      <pre style={{ ...styles.codeBlock, maxHeight: 100, fontSize: 11, marginBottom: 12 }}>{c.preview}</pre>
                      <div style={{ display: "flex", gap: 8, justifyContent: 'flex-end' }}>
                        <button onClick={() => viewFull(c.id)} style={{ ...styles.buttonSecondary, padding: "5px 10px", fontSize: 11 }}>
                          📄 View Full Result
                        </button>
                        <button 
                          onClick={() => setCompareData({ id1: c.id, id2: results.find(b => b.id !== c.id)?.id })} 
                          style={{ ...styles.buttonInfo, padding: "5px 10px", fontSize: 11 }}
                          disabled={results.length < 2}
                        >
                          ⚖️ Compare
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

            </div>
          </div>
        </div>
      )}

      {/* ─── 7. FULL RESULT DETAIL OVERLAY MODAL ─── */}
      {fullResult && (
        <div style={styles.modalBackdrop} onClick={() => { setFullResult(null); setModalSearchTerm(""); setTotalMatches(0); setCurrentMatchIndex(0); }}>
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
                <h3 style={styles.modalTitle}>Full Healthcheck Report — #{fullResult.id}</h3>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, maxWidth: 600 }}>
                  <div style={{ position: 'relative', flex: 1 }}>
                    <input 
                      type="text" 
                      placeholder="Search in report output... (Press Enter)" 
                      value={modalSearchTerm}
                      onChange={e => setModalSearchTerm(e.target.value)}
                      onKeyDown={handleSearchKeyDown}
                      style={{ ...styles.input, paddingLeft: 36, paddingRight: 80 }}
                    />
                    <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', opacity: 0.5 }}>🔍</span>
                    {modalSearchTerm && (
                      <div style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 11, color: tooManyMatches ? colors.danger : colors.gray, marginRight: 4 }}>
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
                      <button 
                        onClick={() => setCurrentMatchIndex(prev => (prev > 0 ? prev - 1 : totalMatches - 1))}
                        style={{ ...styles.buttonSecondary, padding: '8px 12px' }}
                        title="Previous match (↑)"
                      >↑</button>
                      <button 
                        onClick={() => setCurrentMatchIndex(prev => (prev < totalMatches - 1 ? prev + 1 : 0))}
                        style={{ ...styles.buttonSecondary, padding: '8px 12px' }}
                        title="Next match (↓)"
                      >↓</button>
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
                <button onClick={() => { setFullResult(null); setModalSearchTerm(""); setTotalMatches(0); setCurrentMatchIndex(0); }} style={styles.closeButton}>✕</button>
              </div>
            </div>
            
            <div style={{ ...styles.modalBody, maxHeight: modalFullScreen ? 'calc(100vh - 80px)' : '70vh', overflowY: 'auto' }}>
              {/* EOL/EOS Lifecycle overlay match */}
              {fullResult.eoleos_info && fullResult.eoleos_info.matched && (
                <div style={{
                  background: fullResult.eoleos_info.status === 'danger' ? 'rgba(244, 67, 54, 0.12)' : 'rgba(255, 152, 0, 0.12)',
                  border: `1px solid ${fullResult.eoleos_info.status === 'danger' ? colors.danger : colors.warning}`,
                  borderRadius: '16px',
                  padding: '20px',
                  marginBottom: '20px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ fontSize: '24px' }}>⚠️</span>
                    <h4 style={{ margin: 0, fontSize: '15px', fontWeight: 800, color: colors.light }}>
                      EOL/EOS Lifecycle Comparison: Match Found for <strong style={{ color: colors.primary }}>{fullResult.eoleos_info.platform}</strong>
                    </h4>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '16px', marginTop: '4px' }}>
                    <div>
                      <div style={{ fontSize: '11px', color: colors.gray, textTransform: 'uppercase', fontWeight: 700 }}>Platform Model</div>
                      <div style={{ fontSize: '14px', fontWeight: 700, color: colors.light, marginTop: '2px' }}>{fullResult.eoleos_info.platform}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: '11px', color: colors.gray, textTransform: 'uppercase', fontWeight: 700 }}>Running Software</div>
                      <div style={{ fontSize: '14px', fontWeight: 700, color: colors.light, marginTop: '2px' }}>{fullResult.eoleos_info.current_version}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: '11px', color: colors.gray, textTransform: 'uppercase', fontWeight: 700 }}>Hardware EOS Date</div>
                      <div style={{ 
                        fontSize: '14px', 
                        fontWeight: 700, 
                        color: fullResult.eoleos_info.status === 'danger' ? colors.danger : colors.success, 
                        marginTop: '2px' 
                      }}>{fullResult.eoleos_info.hardware_eos}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: '11px', color: colors.gray, textTransform: 'uppercase', fontWeight: 700 }}>Software EOS Date</div>
                      <div style={{ 
                        fontSize: '14px', 
                        fontWeight: 700, 
                        color: fullResult.eoleos_info.status === 'danger' ? colors.danger : colors.success, 
                        marginTop: '2px' 
                      }}>{fullResult.eoleos_info.software_eos}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: '11px', color: colors.gray, textTransform: 'uppercase', fontWeight: 700 }}>Recommended Software</div>
                      <div style={{ fontSize: '14px', fontWeight: 700, color: colors.info, marginTop: '2px' }}>{fullResult.eoleos_info.recommended_version}</div>
                    </div>
                  </div>
                </div>
              )}

              <pre 
                style={{ ...styles.codeBlock, maxHeight: "none", color: colors.info, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}
                dangerouslySetInnerHTML={{ __html: highlightedHtml }}
              />
            </div>
          </div>
        </div>
      )}

      {/* ─── 8. INTERACTIVE COMPARE DIALOG ─── */}
      {compareData && compareData.id1 && compareData.id2 && (
        <CompareModal
          collectionType="healthcheck"
          initialId1={compareData.id1}
          initialId2={compareData.id2}
          deviceName={selectedDevice?.hostname}
          deviceId={selectedDevice?.id}
          onClose={() => setCompareData(null)}
        />
      )}

    </div>
  );
}
