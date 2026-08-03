import React, { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { Link } from "react-router-dom";
import { useTheme } from "../context/ThemeContext";
import { useAuth } from "../context/AuthContext";
import { getBadgeStyle } from "../styles";
import {
  PieChart, Pie, Cell, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend
} from "recharts";

const API = "/api";
const AUTO_REFRESH_MS = 60_000; // 60 seconds

/* ─── Tiny helpers ─────────────────────────────────────────────────────────── */
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const fmt = n => n?.toLocaleString() ?? 0;

const getSiteFromHostname = (hostname) => {
  if (!hostname) return "CORE";
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) return "IP Subnet";
  const match = hostname.match(/^([A-Za-z]+)[-_]/);
  return match?.[1]?.toUpperCase() || "CORE";
};

/* Single source of truth for vendor detection.
   Prefer the explicit vendor field from the API; fall back to hostname heuristics. */
const detectVendor = (hostname = "", vendorField = "") => {
  if (vendorField) return vendorField.charAt(0).toUpperCase() + vendorField.slice(1).toLowerCase();
  const h = hostname.toLowerCase();
  if (h.includes("ne40") || h.includes("ne8") || h.includes("chain") ||
      h.includes("iptv") || h.includes("dist")) return "Huawei";
  return "Cisco";
};

/* ─── Custom Tooltip ───────────────────────────────────────────────────────── */
const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: "var(--surface-container)",
      border: "1px solid var(--border-whisper)",
      borderRadius: 8, padding: "10px 14px", fontSize: 12,
    }}>
      {label && <div style={{ fontWeight: 600, marginBottom: 6, color: "var(--text-high-contrast)" }}>{label}</div>}
      {payload.map((p, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--text-muted)" }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: p.fill || p.color, display: "inline-block" }} />
          {p.name}: <strong style={{ color: "var(--text-high-contrast)" }}>{fmt(p.value)}</strong>
        </div>
      ))}
    </div>
  );
};

/* ─── Chart Mode Toggle ────────────────────────────────────────────────────── */
const ModeToggle = ({ modes, current, onChange }) => (
  <div style={{ display: "flex", gap: 3, background: "var(--background-deep)", padding: 3, borderRadius: 8 }}>
    {modes.map(m => (
      <button key={m.value} onClick={() => onChange(m.value)} style={{
        padding: "4px 10px", fontSize: 11, border: "none", borderRadius: 6, cursor: "pointer",
        fontFamily: "inherit", display: "flex", alignItems: "center", gap: 4,
        background: current === m.value ? "var(--primary-accent)" : "transparent",
        color: current === m.value ? "#fff" : "var(--text-muted)",
        fontWeight: current === m.value ? 600 : 400, transition: "all .15s"
      }}>
        {m.icon} {m.label}
      </button>
    ))}
  </div>
);

const BAR_MODES = [
  { value: "bar-v", label: "Vertical", icon: "▥" },
  { value: "bar-h", label: "Horizontal", icon: "▤" },
  { value: "pie", label: "Pie", icon: "◕" },
  { value: "donut", label: "Donut", icon: "◎" },
];
const PIE_MODES = [
  { value: "donut", label: "Donut", icon: "◎" },
  { value: "pie", label: "Pie", icon: "◕" },
  { value: "bar-v", label: "Bar V", icon: "▥" },
  { value: "bar-h", label: "Bar H", icon: "▤" },
];

/* ─── Donut center label ───────────────────────────────────────────────────── */
const DonutCenter = ({ total }) => (
  <div style={{
    position: "absolute", top: "50%", left: "50%",
    transform: "translate(-50%,-50%)", textAlign: "center", pointerEvents: "none"
  }}>
    <div style={{ fontSize: 26, fontWeight: 700, color: "var(--text-high-contrast)", lineHeight: 1, fontFamily: "var(--font-mono)" }}>{fmt(total)}</div>
    <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 3 }}>Total</div>
  </div>
);

/* ─── Unified Chart ────────────────────────────────────────────────────────── */
const UnifiedChart = ({ data, mode, dataKey = "value", nameKey = "name", height = 250, onChartClick }) => {
  const { theme } = useTheme();
  const { colors } = theme;
  const palette = useMemo(() => [
    colors?.primary || "#6366f1",
    colors?.info    || "#3b82f6",
    colors?.success || "#10b981",
    colors?.warning || "#f59e0b",
    colors?.danger  || "#ef4444",
    colors?.gray    || "#8b949e",
    "#7f77dd", "#d85a30", "#639922", "#d4537e"
  ], [colors]);

  const colored = useMemo(() => data.map((d, i) => ({ ...d, color: d.color || palette[i % palette.length] })), [data, palette]);
  const total   = useMemo(() => colored.reduce((s, d) => s + (d[dataKey] || 0), 0), [colored, dataKey]);
  const tooltipProps = { content: <CustomTooltip /> };

  if (mode === "pie" || mode === "donut") {
    return (
      <div style={{ position: "relative", height }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={colored} cx="50%" cy="50%"
              innerRadius={mode === "donut" ? "55%" : 0}
              outerRadius="78%" dataKey={dataKey} nameKey={nameKey} stroke="none"
              paddingAngle={mode === "donut" ? 2 : 0}
              style={{ cursor: onChartClick ? "pointer" : "default" }}
              onClick={entry => entry && onChartClick?.(entry.name || entry[nameKey])}
            >
              {colored.map((e, i) => <Cell key={i} fill={e.color} />)}
            </Pie>
            <Tooltip {...tooltipProps} />
          </PieChart>
        </ResponsiveContainer>
        {mode === "donut" && <DonutCenter total={total} />}
      </div>
    );
  }

  const isHoriz = mode === "bar-h";
  // "bar-h" needs real pixel headroom per row (fixed-height content scrolls/
  // squashes badly otherwise) — only apply the Math.max sizing when height
  // is a number. Auto-scale mode passes "100%" (fill the panel), which a
  // horizontal bar list can't sensibly grow-to-fit, so it keeps its own
  // natural per-row sizing regardless of the auto-scale setting.
  const barH = isHoriz ? Math.max(typeof height === "number" ? height : 220, colored.length * 42 + 60) : height;

  return (
    <div style={{ height: barH }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={colored} layout={isHoriz ? "vertical" : "horizontal"}
          margin={{ left: isHoriz ? 10 : 0, right: 16, top: 4, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-whisper)" opacity={.5}
            vertical={isHoriz} horizontal={!isHoriz} />
          <XAxis dataKey={isHoriz ? undefined : nameKey}
            type={isHoriz ? "number" : "category"}
            stroke="var(--text-muted)" fontSize={10}
            tick={{ fill: "var(--text-muted)", fontFamily: "var(--font-body)" }}
            tickLine={false} axisLine={false} />
          <YAxis dataKey={isHoriz ? nameKey : undefined}
            type={isHoriz ? "category" : "number"}
            stroke="var(--text-muted)" fontSize={10}
            tick={{ fill: "var(--text-muted)", fontFamily: "var(--font-body)" }}
            tickLine={false} axisLine={false} width={isHoriz ? 90 : 36} />
          <Tooltip {...tooltipProps} cursor={{ fill: "rgba(128,128,128,.06)" }} />
          <Bar dataKey={dataKey} radius={isHoriz ? [0, 4, 4, 0] : [4, 4, 0, 0]} maxBarSize={36}
            style={{ cursor: onChartClick ? "pointer" : "default" }}
            onClick={entry => {
              if (onChartClick && entry) {
                const val = entry.activePayload?.[0]?.payload?.[nameKey] || entry[nameKey] || entry.name;
                if (val) onChartClick(val);
              }
            }}
          >
            {colored.map((e, i) => <Cell key={i} fill={e.color} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};

/* ─── Legend strip ─────────────────────────────────────────────────────────── */
const LegendStrip = ({ data, dataKey = "value", nameKey = "name", hiddenKeys, onToggle }) => {
  const { theme } = useTheme();
  const { colors } = theme;
  const total = data.reduce((s, d) => s + (d[dataKey] || 0), 0);
  const palette = [
    colors?.primary || "#6366f1", colors?.info    || "#3b82f6",
    colors?.success || "#10b981", colors?.warning || "#f59e0b",
    colors?.danger  || "#ef4444", colors?.gray    || "#8b949e",
    "#7f77dd", "#d85a30", "#639922", "#d4537e"
  ];
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 12px", marginBottom: 10 }}>
      {data.map((d, i) => {
        const key = d[nameKey];
        const hidden = hiddenKeys?.has(key);
        return (
          <span key={i} onClick={() => onToggle?.(key)} style={{
            display: "flex", alignItems: "center", gap: 5, fontSize: 11,
            color: hidden ? "var(--text-inactive)" : "var(--text-muted)",
            cursor: onToggle ? "pointer" : "default", userSelect: "none",
            fontFamily: "var(--font-body)"
          }}>
            <span style={{ width: 9, height: 9, borderRadius: 2, background: hidden ? "#475569" : (d.color || palette[i % palette.length]), flexShrink: 0 }} />
            {key} ({fmt(d[dataKey])}){total ? " " + pct(d[dataKey], total) + "%" : ""}
          </span>
        );
      })}
    </div>
  );
};

/* ─── Filter Bar ───────────────────────────────────────────────────────────── */
const FilterBar = ({ filters, setFilters, onReset, sites, vendors, groups }) => {
  const sel = (id, val) => setFilters(f => ({ ...f, [id]: val }));
  const fields = [
    { id: "site",     label: "Site",       opts: sites },
    { id: "vendor",   label: "Vendor",     opts: vendors },
    { id: "group",    label: "Group",      opts: groups },
    { id: "status",   label: "Status",     opts: ["All Status", "success", "failed"] },
    { id: "type",     label: "Type",       opts: ["All Types", "backup", "healthcheck"] },
    { id: "logLimit", label: "Log Rows",   opts: ["Top 5", "Top 10", "Top 20", "All"] },
    { id: "chartLayout", label: "Chart Layout", opts: ["Default Layout", "donut", "pie", "bar-v", "bar-h"] },
  ];
  const layoutLabels = { "Default Layout": "Default Layout", donut: "◎ Donut", pie: "◕ Pie", "bar-v": "▥ Vertical", "bar-h": "▤ Horizontal" };

  return (
    <div style={{
      display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center",
      padding: "10px 16px", background: "var(--surface-container)",
      border: "1px solid var(--border-whisper)", borderRadius: 8, marginBottom: 20
    }}>
      {fields.map((f, i, arr) => (
        <React.Fragment key={f.id}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <label style={{ fontSize: 11, color: "var(--text-muted)", whiteSpace: "nowrap" }}>{f.label}</label>
            <select value={filters[f.id]} onChange={e => sel(f.id, e.target.value)} style={{
              fontSize: 12, padding: "5px 9px", borderRadius: 6,
              border: "1px solid var(--border-whisper)",
              background: "var(--surface)", color: "var(--text-high-contrast)",
              fontFamily: "inherit", cursor: "pointer"
            }}>
              {f.opts.map(o => <option key={o} value={o}>{f.id === "chartLayout" ? (layoutLabels[o] || o) : o}</option>)}
            </select>
          </div>
          {i < arr.length - 1 && <div style={{ width: 1, height: 20, background: "var(--border-whisper)", flexShrink: 0 }} />}
        </React.Fragment>
      ))}
      <button onClick={onReset} className="btn-toggle" style={{
        marginLeft: "auto", border: "1px solid var(--border-whisper)", borderRadius: 6, padding: "5px 13px"
      }}>↺ Reset</button>
    </div>
  );
};

/* ─── KPI Card ─────────────────────────────────────────────────────────────── */
const KpiCard = ({ label, value, sub, color, barPct, icon, onClick }) => (
  <div className="metric-card" onClick={onClick}>
    <div className="metric-card-header">
      <div className="metric-card-title">{label}</div>
      {icon && <span className="material-symbols-outlined metric-card-icon">{icon}</span>}
    </div>
    <div className="metric-card-value" style={{ color }}>{value}</div>
    {sub && <div className="metric-card-sub">{sub}</div>}
    <div className="metric-card-progress">
      <div className="metric-card-progress-bar" style={{ width: `${barPct || 0}%`, backgroundColor: color }} />
    </div>
  </div>
);

/* ─── Panel wrapper ────────────────────────────────────────────────────────── */
// className carries the grid column-span (col-4 / col-6 / col-8 / col-12) —
// every caller must pass one. This is the single source of truth for a
// panel's card styling; callers must never re-wrap the result in their own
// "chart-card" div (that produced a nested double-card and, when the class
// was forgotten entirely as it was for "Counts by attribute", left the
// panel with no explicit grid-column at all — a bare 1-track sliver next to
// its properly-sized siblings, which is what "not properly fit" was).
// dragProps (admin-only reordering) spread directly onto this same element
// so the drag handle and the grid-sized element are one and the same node.
const Panel = ({ title, subtitle, children, controls, onMaximize, className = "", dragProps = null }) => (
  <div
    className={`chart-card ${className} ${dragProps?.isDropTarget ? "chart-drop-target" : ""}`.trim()}
    {...(dragProps?.containerProps || {})}
  >
    <div className="chart-card-header">
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        {dragProps && (
          <span
            {...dragProps.handleProps}
            title="Drag to reorder (admin)"
            className="chart-drag-handle"
          >
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>drag_indicator</span>
          </span>
        )}
        <div>
          <h3 className="chart-title">{title}</h3>
          {subtitle && <div className="chart-subtitle">{subtitle}</div>}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {controls}
        {onMaximize && (
          <button onClick={onMaximize} title="Maximize" className="btn-toggle"
            style={{ border: "1px solid var(--border-whisper)", borderRadius: 6, padding: "4px 6px", display: "flex", alignItems: "center" }}>
            <span className="material-symbols-outlined" style={{ fontSize: 13 }}>fullscreen</span>
          </button>
        )}
      </div>
    </div>
    <div style={{ flex: 1, position: "relative" }}>{children}</div>
  </div>
);

/* ─── Maximized Chart Modal ────────────────────────────────────────────────── */
const MaximizedChartModal = ({ chartKey, onClose, chartProps }) => {
  if (!chartKey || !chartProps) return null;
  const { title, subtitle, data, mode, dataKey, nameKey, legendData, hiddenKeys, onToggle, onChartClick } = chartProps;

  return (
    <div
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 3000, backdropFilter: "blur(8px)"
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border-whisper)",
          borderRadius: 16, width: "90%", maxWidth: 900, padding: 24,
          display: "flex", flexDirection: "column", gap: 16,
          boxShadow: "0 20px 50px rgba(0,0,0,0.5)", position: "relative"
        }}
        onClick={e => e.stopPropagation()}
      >
        <button onClick={onClose} style={{
          position: "absolute", top: 18, right: 18,
          background: "transparent", border: "none",
          color: "var(--text-muted)", fontSize: 18, cursor: "pointer",
          padding: "4px 8px", borderRadius: 6
        }}>✕</button>

        <div>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "var(--text-high-contrast)" }}>{title}</h3>
          {subtitle && <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>{subtitle}</div>}
        </div>

        {legendData && (
          <LegendStrip data={legendData} dataKey={dataKey} nameKey={nameKey} hiddenKeys={hiddenKeys} onToggle={onToggle} />
        )}

        <div style={{ flex: 1, minHeight: 400, marginTop: 10 }}>
          <UnifiedChart data={data} mode={mode} dataKey={dataKey} nameKey={nameKey} height={400} onChartClick={onChartClick} />
        </div>
      </div>
    </div>
  );
};

/* ══════════════════════════════════════════════════════════════════════════════
   MAIN DASHBOARD
══════════════════════════════════════════════════════════════════════════════ */
const DEFAULT_FILTERS = {
  site: "All Sites", vendor: "All Vendors", group: "All Groups",
  status: "All Status", type: "All Types", logLimit: "Top 10",
  chartLayout: "Default Layout"
};

const CHART_ORDER_KEY = "netact_dashboard_chart_order";
const CHART_AUTOSCALE_KEY = "netact_dashboard_autoscale";
const DEFAULT_CHART_ORDER = ["attribute", "backup", "health", "automation", "vendor", "group"];

function loadChartOrder() {
  try {
    const saved = JSON.parse(localStorage.getItem(CHART_ORDER_KEY));
    if (Array.isArray(saved) && saved.length === DEFAULT_CHART_ORDER.length
      && DEFAULT_CHART_ORDER.every(k => saved.includes(k))) {
      return saved;
    }
  } catch { /* fall through to default */ }
  return DEFAULT_CHART_ORDER;
}

export default function Dashboard() {
  const { styles, theme } = useTheme();
  const { colors } = theme;
  const { isAdmin } = useAuth();

  /* ── State ── */
  const [data,                  setData]                  = useState(null);
  const [health,                setHealth]                = useState(null);
  const [initialLoading,        setInitialLoading]        = useState(true);
  const [refreshing,            setRefreshing]            = useState(false);
  const [error,                 setError]                 = useState(null);
  const [lastUpdated,           setLastUpdated]           = useState(null);
  const [filters,               setFilters]               = useState(DEFAULT_FILTERS);
  const [deviceMap,             setDeviceMap]             = useState({});
  const [executions,            setExecutions]            = useState([]);
  const [backupsSummary,        setBackupsSummary]        = useState([]);
  const [healthchecksSummary,   setHealthchecksSummary]   = useState([]);

  /* chart modes */
  const [backupMode,     setBackupMode]     = useState("donut");
  const [healthMode,     setHealthMode]     = useState("donut");
  const [automationMode, setAutomationMode] = useState("donut");
  const [vendorMode,     setVendorMode]     = useState("bar-h");
  const [groupMode,      setGroupMode]      = useState("bar-v");
  const [barBy,          setBarBy]          = useState("vendor");

  /* hidden legend keys */
  const [hiddenBackup,     setHiddenBackup]     = useState(new Set());
  const [hiddenHealth,     setHiddenHealth]     = useState(new Set());
  const [hiddenAutomation, setHiddenAutomation] = useState(new Set());

  /* maximized modal */
  const [maximizedChartKey, setMaximizedChartKey] = useState(null);

  /* chart panel layout — auto-scale height + admin drag-to-reorder,
     both persisted per-browser in localStorage, same pattern the
     Centralized Appearance Engine already uses for theme config. */
  const [autoScale, setAutoScale] = useState(() => localStorage.getItem(CHART_AUTOSCALE_KEY) === "true");
  const [chartOrder, setChartOrder] = useState(loadChartOrder);
  const dragKeyRef = useRef(null);
  const [dragOverKey, setDragOverKey] = useState(null);

  const toggleAutoScale = useCallback(() => {
    setAutoScale(prev => {
      const next = !prev;
      localStorage.setItem(CHART_AUTOSCALE_KEY, String(next));
      return next;
    });
  }, []);

  const reorderCharts = useCallback((fromKey, toKey) => {
    if (!fromKey || !toKey || fromKey === toKey) return;
    setChartOrder(prev => {
      const next = [...prev];
      const fromIdx = next.indexOf(fromKey);
      const toIdx = next.indexOf(toKey);
      if (fromIdx === -1 || toIdx === -1) return prev;
      next.splice(fromIdx, 1);
      next.splice(toIdx, 0, fromKey);
      localStorage.setItem(CHART_ORDER_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const makeDragProps = useCallback((key) => {
    if (!isAdmin) return null;
    return {
      containerProps: {
        draggable: true,
        onDragStart: () => { dragKeyRef.current = key; },
        onDragOver: (e) => { e.preventDefault(); if (dragOverKey !== key) setDragOverKey(key); },
        onDragLeave: () => setDragOverKey(prev => (prev === key ? null : prev)),
        onDrop: (e) => {
          e.preventDefault();
          reorderCharts(dragKeyRef.current, key);
          dragKeyRef.current = null;
          setDragOverKey(null);
        },
        onDragEnd: () => { dragKeyRef.current = null; setDragOverKey(null); },
      },
      handleProps: {},
      isDropTarget: dragOverKey === key,
    };
  }, [isAdmin, dragOverKey, reorderCharts]);

  const autoRefreshRef = useRef(null);

  /* ── Fetch ── */
  const apiFetch = useCallback(async url => {
    return fetch(url, { headers: { "x-api-key": sessionStorage.getItem("app_password") || "" } });
  }, []);

  const fetchData = useCallback(async (isAuto = false) => {
    if (isAuto) setRefreshing(true);
    else if (!data) setInitialLoading(true);
    else setRefreshing(true);

    setError(null);
    try {
      const [rStats, rHealth, rBackupsSummary, rHealthchecksSummary, rExecutions] = await Promise.all([
        apiFetch(`${API}/dashboard/stats`),
        apiFetch(`${API}/health`),
        apiFetch(`${API}/devices/backups-summary`),
        apiFetch(`${API}/devices/healthchecks-summary`),
        apiFetch(`${API}/automation/executions`)
      ]);
      if (rStats.ok)   setData(await rStats.json());
      if (rHealth.ok)  setHealth(await rHealth.json());
      if (rBackupsSummary.ok) {
        const devs = await rBackupsSummary.json();
        setBackupsSummary(devs);
        const map = {};
        devs.forEach(d => { map[d.hostname] = d.group_file; });
        setDeviceMap(map);
      }
      if (rHealthchecksSummary.ok) setHealthchecksSummary(await rHealthchecksSummary.json());
      if (rExecutions.ok)          setExecutions(await rExecutions.json());
      setLastUpdated(new Date());
    } catch (e) {
      console.error("Dashboard fetch error:", e);
      setError("Failed to load dashboard data. Check API connectivity.");
    } finally {
      setInitialLoading(false);
      setRefreshing(false);
    }
  }, [apiFetch, data]);

  /* Initial load */
  useEffect(() => { fetchData(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* Auto-refresh every 60s */
  useEffect(() => {
    autoRefreshRef.current = setInterval(() => fetchData(true), AUTO_REFRESH_MS);
    return () => clearInterval(autoRefreshRef.current);
  }, [fetchData]);

  /* ── Dynamic filter options ── */
  const siteList = useMemo(() => {
    if (!data?.activity_logs) return ["All Sites"];
    const s = new Set(data.activity_logs.map(l => getSiteFromHostname(l.device_name)));
    return ["All Sites", ...Array.from(s).sort()];
  }, [data]);

  const vendorList = useMemo(() => {
    if (!data?.vendors) return ["All Vendors"];
    return ["All Vendors", ...data.vendors.map(v => v.name).sort()];
  }, [data]);

  const groupList = useMemo(() => {
    if (!data?.groups) return ["All Groups"];
    return ["All Groups", ...data.groups.map(g => g.name).sort()];
  }, [data]);

  /* ── Limit helpers ── */
  const logLimitN = useMemo(() => {
    const v = filters.logLimit;
    return v === "All" ? 999 : parseInt(v.replace("Top ", ""));
  }, [filters.logLimit]);

  /* ── Filtered data ── */
  const filteredLogs = useMemo(() => {
    if (!data?.activity_logs) return [];
    return data.activity_logs.filter(l => {
      if (filters.status !== "All Status" && l.status !== filters.status) return false;
      if (filters.type   !== "All Types"  && l.collection_type !== filters.type) return false;
      if (filters.site   !== "All Sites"  && getSiteFromHostname(l.device_name) !== filters.site) return false;
      if (filters.vendor !== "All Vendors" && detectVendor(l.device_name) !== filters.vendor) return false;
      if (filters.group  !== "All Groups") {
        if ((deviceMap[l.device_name] || "unknown").toLowerCase() !== filters.group.toLowerCase()) return false;
      }
      return true;
    });
  }, [data, filters, deviceMap]);

  const filteredBackupsSummary = useMemo(() => {
    return backupsSummary.filter(d => {
      if (filters.site   !== "All Sites"   && getSiteFromHostname(d.hostname) !== filters.site) return false;
      if (filters.vendor !== "All Vendors" && detectVendor(d.hostname, d.vendor) !== filters.vendor) return false;
      if (filters.group  !== "All Groups"  && (d.group_file || "unknown").toLowerCase() !== filters.group.toLowerCase()) return false;
      if (filters.status !== "All Status") {
        const st = d.backup_summary?.last_backup?.status;
        if (filters.status === "success" && st !== "success") return false;
        if (filters.status === "failed"  && st !== "failed" && st !== "error") return false;
      }
      return true;
    });
  }, [backupsSummary, filters]);

  const filteredHealthchecksSummary = useMemo(() => {
    return healthchecksSummary.filter(d => {
      if (filters.site   !== "All Sites"   && getSiteFromHostname(d.hostname) !== filters.site) return false;
      if (filters.vendor !== "All Vendors" && detectVendor(d.hostname, d.vendor) !== filters.vendor) return false;
      if (filters.group  !== "All Groups"  && (d.group_file || "unknown").toLowerCase() !== filters.group.toLowerCase()) return false;
      if (filters.status !== "All Status") {
        const st = d.healthcheck_summary?.last_healthcheck?.status;
        if (filters.status === "success" && st !== "success") return false;
        if (filters.status === "failed"  && st !== "failed" && st !== "error") return false;
      }
      return true;
    });
  }, [healthchecksSummary, filters]);

  /* ── Chart layout override ── */
  const getActiveMode = (localMode) =>
    filters.chartLayout !== "Default Layout" ? filters.chartLayout : localMode;

  /* ── BI cross-filter click handler ── */
  const handleChartClick = useCallback((chartType, clickedName) => {
    if (!clickedName) return;
    setFilters(f => {
      const next = { ...f };
      if (chartType === "backup") {
        next.type = "backup";
        if (clickedName.includes("SUCCESS")) next.status = "success";
        else if (clickedName.includes("FAILED")) next.status = "failed";
        else next.status = "All Status";
      } else if (chartType === "health") {
        next.type = "healthcheck";
        if (clickedName.includes("SUCCESS")) next.status = "success";
        else if (clickedName.includes("FAILED")) next.status = "failed";
        else next.status = "All Status";
      } else if (chartType === "automation") {
        if (clickedName.toLowerCase().includes("success")) next.status = "success";
        else if (clickedName.toLowerCase().includes("fail")) next.status = "failed";
      } else if (chartType === "vendor") {
        next.vendor = clickedName;
      } else if (chartType === "group") {
        next.group = clickedName;
      } else if (chartType === "attribute") {
        if (barBy === "vendor") next.vendor = clickedName;
        else next.group = clickedName;
      }
      return next;
    });
  }, [barBy]);

  /* ── Metrics ── */
  const backupsMetrics = useMemo(() => {
    let success = 0, fail = 0, never = 0;
    filteredBackupsSummary.forEach(d => {
      const st = d.backup_summary?.last_backup?.status;
      if (!st) never++;
      else if (st === "success") success++;
      else fail++;
    });
    return { success, fail, never };
  }, [filteredBackupsSummary]);

  const healthchecksMetrics = useMemo(() => {
    let success = 0, fail = 0, never = 0;
    filteredHealthchecksSummary.forEach(d => {
      const st = d.healthcheck_summary?.last_healthcheck?.status;
      if (!st) never++;
      else if (st === "success") success++;
      else fail++;
    });
    return { success, fail, never };
  }, [filteredHealthchecksSummary]);

  const automationStats = useMemo(() => {
    let success = 0, failed = 0, running = 0;
    executions.forEach(r => {
      if (r.status === "success") success++;
      else if (r.status === "failed" || r.status === "error") failed++;
      else if (r.status === "running") running++;
    });
    return { success, failed, running };
  }, [executions]);

  /* ── Chart data ── */
  const [hiddenBackupToggle,     toggleHiddenBackup]     = [hiddenBackup,     k => setHiddenBackup(s => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; })];
  const [hiddenHealthToggle,     toggleHiddenHealth]     = [hiddenHealth,     k => setHiddenHealth(s => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; })];
  const [hiddenAutomationToggle, toggleHiddenAutomation] = [hiddenAutomation, k => setHiddenAutomation(s => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; })];

  const backupData = useMemo(() => [
    { name: "BACKUP SUCCESS",   value: backupsMetrics.success, color: colors.success },
    { name: "BACKUP FAILED",    value: backupsMetrics.fail,    color: colors.danger  },
    { name: "NEVER BACKED UP",  value: backupsMetrics.never,   color: colors.gray    },
  ].filter(d => !hiddenBackup.has(d.name)), [backupsMetrics, colors, hiddenBackup]);

  const healthData = useMemo(() => [
    { name: "DIAGNOSTIC SUCCESS",    value: healthchecksMetrics.success, color: colors.info    },
    { name: "DIAGNOSTIC FAILED",     value: healthchecksMetrics.fail,    color: colors.warning },
    { name: "NEVER DIAGNOSTIC UP",   value: healthchecksMetrics.never,   color: colors.gray    },
  ].filter(d => !hiddenHealth.has(d.name)), [healthchecksMetrics, colors, hiddenHealth]);

  const automationChartData = useMemo(() => [
    { name: "Success", value: automationStats.success, color: colors.success },
    { name: "Fail",    value: automationStats.failed,  color: colors.danger  },
    { name: "Running", value: automationStats.running, color: colors.warning },
  ].filter(d => !hiddenAutomation.has(d.name)), [automationStats, colors, hiddenAutomation]);

  /* Charts show ALL entries — only log rows are capped by logLimitN */
  const vendorData = useMemo(() => {
    const counts = {};
    filteredBackupsSummary.forEach(d => {
      const v = detectVendor(d.hostname, d.vendor);
      counts[v] = (counts[v] || 0) + 1;
    });
    return Object.entries(counts).map(([name, count]) => ({ name, value: count, count }));
  }, [filteredBackupsSummary]);

  const groupData = useMemo(() => {
    const counts = {};
    filteredBackupsSummary.forEach(d => {
      const g = d.group_file || "unknown";
      counts[g] = (counts[g] || 0) + 1;
    });
    return Object.entries(counts).map(([name, count]) => ({ name, value: count, count }));
  }, [filteredBackupsSummary]);

  const barData = useMemo(() => (barBy === "vendor" ? vendorData : groupData), [barBy, vendorData, groupData]);

  const failedLogs = useMemo(() => filteredLogs.filter(l => l.status === "failed"), [filteredLogs]);

  /* ── KPI numbers ── */
  const backupPct = useMemo(() => {
    const total = filteredBackupsSummary.length;
    return total ? Math.round((backupsMetrics.success / total) * 100) : 0;
  }, [filteredBackupsSummary, backupsMetrics]);

  const healthPct = useMemo(() => {
    const total = filteredHealthchecksSummary.length;
    return total ? Math.round((healthchecksMetrics.success / total) * 100) : 0;
  }, [filteredHealthchecksSummary, healthchecksMetrics]);

  const totalFail = backupsMetrics.fail + healthchecksMetrics.fail;

  /* ── Build maximized chart props ── */
  const maximizedProps = useMemo(() => {
    if (!maximizedChartKey) return null;
    const map = {
      attribute: {
        title: "Counts by attribute",
        subtitle: `Grouped by ${barBy}`,
        data: barData, mode: getActiveMode("bar-v"), dataKey: "count", nameKey: "name",
        onChartClick: n => handleChartClick("attribute", n),
      },
      backup: {
        title: "Backup distribution", subtitle: "Current collection cycle",
        data: backupData, mode: getActiveMode(backupMode), dataKey: "value", nameKey: "name",
        legendData: [
          { name: "BACKUP SUCCESS",  value: backupsMetrics.success, color: colors.success },
          { name: "BACKUP FAILED",   value: backupsMetrics.fail,    color: colors.danger  },
          { name: "NEVER BACKED UP", value: backupsMetrics.never,   color: colors.gray    },
        ],
        hiddenKeys: hiddenBackup, onToggle: toggleHiddenBackup,
        onChartClick: n => handleChartClick("backup", n),
      },
      health: {
        title: "Healthcheck status", subtitle: "Current check cycle",
        data: healthData, mode: getActiveMode(healthMode), dataKey: "value", nameKey: "name",
        legendData: [
          { name: "DIAGNOSTIC SUCCESS",  value: healthchecksMetrics.success, color: colors.info    },
          { name: "DIAGNOSTIC FAILED",   value: healthchecksMetrics.fail,    color: colors.warning },
          { name: "NEVER DIAGNOSTIC UP", value: healthchecksMetrics.never,   color: colors.gray    },
        ],
        hiddenKeys: hiddenHealth, onToggle: toggleHiddenHealth,
        onChartClick: n => handleChartClick("health", n),
      },
      automation: {
        title: "Automation runs", subtitle: "Workflow executions history",
        data: automationChartData, mode: getActiveMode(automationMode), dataKey: "value", nameKey: "name",
        legendData: [
          { name: "Success", value: automationStats.success, color: colors.success },
          { name: "Fail",    value: automationStats.failed,  color: colors.danger  },
          { name: "Running", value: automationStats.running, color: colors.warning },
        ],
        hiddenKeys: hiddenAutomation, onToggle: toggleHiddenAutomation,
        onChartClick: n => handleChartClick("automation", n),
      },
      vendor: {
        title: "Vendor breakdown", subtitle: "Devices by manufacturer",
        data: vendorData, mode: getActiveMode(vendorMode), dataKey: "count", nameKey: "name",
        legendData: vendorData,
        onChartClick: n => handleChartClick("vendor", n),
      },
      group: {
        title: "Group breakdown", subtitle: "Devices by network group",
        data: groupData, mode: getActiveMode(groupMode), dataKey: "count", nameKey: "name",
        legendData: groupData,
        onChartClick: n => handleChartClick("group", n),
      },
    };
    return map[maximizedChartKey] || null;
  }, [maximizedChartKey, barBy, barData, backupData, healthData, automationChartData,
      vendorData, groupData, backupMode, healthMode, automationMode, vendorMode, groupMode,
      backupsMetrics, healthchecksMetrics, automationStats, colors,
      hiddenBackup, hiddenHealth, hiddenAutomation,
      toggleHiddenBackup, toggleHiddenHealth, toggleHiddenAutomation,
      handleChartClick, filters.chartLayout]);

  /* ── Status badges ── */
  const statusBadges = [
    { key: "git_manager", label: "Git Storage",  ok: health?.git_manager },
    { key: "jump_pool",   label: "Jump Server",   ok: health?.jump_pool   },
    { key: "api",         label: "Backend API",   ok: true                },
  ];

  /* ── Render: initial load spinner ── */
  if (initialLoading) {
    return (
      <div style={{ ...styles.loadingState, display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
        <div style={{ fontSize: 28, animation: "spin 2s linear infinite" }}>⟳</div>
        <div>Loading Operations Center Dashboard...</div>
        <style>{`@keyframes spin { 0%{transform:rotate(0deg)} 100%{transform:rotate(360deg)} }`}</style>
      </div>
    );
  }

  return (
    <div className="modern-dashboard">

      {/* ── Status bar ── */}
      <div className="connection-bar">
        {statusBadges.map(b => (
          <div key={b.key} className={`connection-badge ${b.ok ? "pulsing" : ""}`}
            style={!b.ok ? { color: "var(--status-danger)", background: "rgba(239,68,68,0.08)", borderColor: "rgba(239,68,68,0.25)" } : {}}>
            <span className="dot" style={!b.ok ? { backgroundColor: "var(--status-danger)", boxShadow: "0 0 8px var(--status-danger)" } : {}} />
            {b.label}: {b.ok ? "Connected" : "Disconnected"}
          </div>
        ))}

        {/* Last updated + auto-refresh indicator */}
        {lastUpdated && (
          <div style={{ fontSize: 11, color: "var(--text-inactive)", display: "flex", alignItems: "center", gap: 5 }}>
            {refreshing
              ? <><span style={{ animation: "spin 1s linear infinite", display: "inline-block" }}>⟳</span> Refreshing…</>
              : <>⏱ {lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</>
            }
          </div>
        )}

        {/* Error banner */}
        {error && (
          <div style={{ fontSize: 11, color: "var(--status-danger)", background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)", borderRadius: 6, padding: "4px 10px" }}>
            ⚠ {error}
          </div>
        )}

        <button onClick={() => fetchData(false)} className="btn-toggle"
          style={{ marginLeft: "auto", border: "1px solid var(--border-whisper)", borderRadius: 6, display: "flex", alignItems: "center", gap: 6, padding: "6px 14px", color: "var(--text-high-contrast)" }}>
          <span className="material-symbols-outlined" style={{ fontSize: 14 }}>refresh</span>
          Refresh
        </button>
      </div>

      {/* ── Filter bar ── */}
      <FilterBar filters={filters} setFilters={setFilters} onReset={() => setFilters(DEFAULT_FILTERS)}
        sites={siteList} vendors={vendorList} groups={groupList} />

      {/* ── KPI cards ── */}
      <div className="metrics-grid">
        <KpiCard label="All Devices"    value={fmt(data?.total_devices)} color="var(--status-info)"    barPct={100}         sub="Total inventory"                                                         icon="devices"         onClick={() => setFilters(DEFAULT_FILTERS)} />
        <KpiCard label="Backup Success" value={backupPct + "%"}          color="var(--status-success)" barPct={backupPct}   sub={`${fmt(backupsMetrics.success)} of ${fmt(filteredBackupsSummary.length)}`} icon="cloud_upload"    onClick={() => setFilters(f => ({ ...f, type: "backup",      status: "success" }))} />
        <KpiCard label="Health Success" value={healthPct + "%"}          color="var(--status-info)"    barPct={healthPct}   sub={`${fmt(healthchecksMetrics.success)} of ${fmt(filteredHealthchecksSummary.length)}`} icon="health_and_safety" onClick={() => setFilters(f => ({ ...f, type: "healthcheck", status: "success" }))} />
        <KpiCard label="Active Issues"  value={fmt(totalFail)}           color={totalFail > 0 ? "var(--status-danger)" : "var(--status-success)"} barPct={Math.min(100, totalFail * 3)} sub={`${fmt(backupsMetrics.fail)} backup · ${fmt(healthchecksMetrics.fail)} health`} icon="report_problem" onClick={() => setFilters(f => ({ ...f, status: "failed", type: "All Types" }))} />
      </div>

      {/* ── Charts toolbar: auto-scale + admin reorder hint/reset ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 10, flexWrap: "wrap" }}>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-muted)", cursor: "pointer", userSelect: "none" }}>
          <input type="checkbox" checked={autoScale} onChange={toggleAutoScale} style={{ cursor: "pointer" }} />
          Auto-scale charts to fill panel height
        </label>
        {isAdmin && (
          <>
            <span style={{ fontSize: 11, color: "var(--text-inactive)", display: "flex", alignItems: "center", gap: 4 }}>
              <span className="material-symbols-outlined" style={{ fontSize: 14 }}>drag_indicator</span>
              Drag a panel's grip to reorder
            </span>
            {JSON.stringify(chartOrder) !== JSON.stringify(DEFAULT_CHART_ORDER) && (
              <button
                onClick={() => { setChartOrder(DEFAULT_CHART_ORDER); localStorage.removeItem(CHART_ORDER_KEY); }}
                className="btn-toggle"
                style={{ border: "1px solid var(--border-whisper)", borderRadius: 6, padding: "3px 10px", fontSize: 11 }}
              >
                ↺ Reset layout
              </button>
            )}
          </>
        )}
      </div>

      {/* ── Charts Grid ── */}
      <div className={`charts-grid ${autoScale ? "auto-scale" : ""}`.trim()}>
        {chartOrder.map(key => {
          const chartHeight = autoScale ? "100%" : 230;
          switch (key) {
            case "attribute":
              return (
                <Panel key={key} className="col-12" dragProps={makeDragProps("attribute")}
                  title="Counts by attribute"
                  subtitle={`Grouped by ${barBy}`}
                  onMaximize={() => setMaximizedChartKey("attribute")}
                  controls={
                    <select value={barBy} onChange={e => setBarBy(e.target.value)} style={{
                      fontSize: 11, padding: "4px 8px", borderRadius: 6,
                      border: "1px solid var(--border-whisper)", background: "var(--surface)",
                      color: "var(--text-high-contrast)", fontFamily: "inherit"
                    }}>
                      <option value="vendor">Vendor</option>
                      <option value="group">Group</option>
                    </select>
                  }
                >
                  <UnifiedChart data={barData} mode={getActiveMode("bar-v")} dataKey="count" nameKey="name" height={autoScale ? "100%" : 220} onChartClick={n => handleChartClick("attribute", n)} />
                </Panel>
              );
            case "backup":
              return (
                <Panel key={key} className="col-4" dragProps={makeDragProps("backup")}
                  title="Backup distribution" subtitle="Current collection cycle"
                  onMaximize={() => setMaximizedChartKey("backup")}
                  controls={<ModeToggle modes={PIE_MODES} current={backupMode} onChange={setBackupMode} />}
                >
                  <LegendStrip data={[
                    { name: "BACKUP SUCCESS",  value: backupsMetrics.success, color: "var(--status-success)" },
                    { name: "BACKUP FAILED",   value: backupsMetrics.fail,    color: "var(--status-danger)"  },
                    { name: "NEVER BACKED UP", value: backupsMetrics.never,   color: "var(--text-inactive)"  },
                  ]} hiddenKeys={hiddenBackup} onToggle={toggleHiddenBackup} />
                  <UnifiedChart data={backupData} mode={getActiveMode(backupMode)} dataKey="value" nameKey="name" height={chartHeight} onChartClick={n => handleChartClick("backup", n)} />
                </Panel>
              );
            case "health":
              return (
                <Panel key={key} className="col-4" dragProps={makeDragProps("health")}
                  title="Healthcheck status" subtitle="Current check cycle"
                  onMaximize={() => setMaximizedChartKey("health")}
                  controls={<ModeToggle modes={PIE_MODES} current={healthMode} onChange={setHealthMode} />}
                >
                  <LegendStrip data={[
                    { name: "DIAGNOSTIC SUCCESS",  value: healthchecksMetrics.success, color: "var(--status-info)"     },
                    { name: "DIAGNOSTIC FAILED",   value: healthchecksMetrics.fail,    color: "var(--status-warning)"  },
                    { name: "NEVER DIAGNOSTIC UP", value: healthchecksMetrics.never,   color: "var(--text-inactive)"   },
                  ]} hiddenKeys={hiddenHealth} onToggle={toggleHiddenHealth} />
                  <UnifiedChart data={healthData} mode={getActiveMode(healthMode)} dataKey="value" nameKey="name" height={chartHeight} onChartClick={n => handleChartClick("health", n)} />
                </Panel>
              );
            case "automation":
              return (
                <Panel key={key} className="col-4" dragProps={makeDragProps("automation")}
                  title="Automation runs" subtitle="Workflow template runs status"
                  onMaximize={() => setMaximizedChartKey("automation")}
                  controls={<ModeToggle modes={PIE_MODES} current={automationMode} onChange={setAutomationMode} />}
                >
                  <LegendStrip data={[
                    { name: "Success", value: automationStats.success, color: "var(--status-success)" },
                    { name: "Fail",    value: automationStats.failed,  color: "var(--status-danger)"  },
                    { name: "Running", value: automationStats.running, color: "var(--status-warning)"  },
                  ]} hiddenKeys={hiddenAutomation} onToggle={toggleHiddenAutomation} />
                  <UnifiedChart data={automationChartData} mode={getActiveMode(automationMode)} dataKey="value" nameKey="name" height={chartHeight} onChartClick={n => handleChartClick("automation", n)} />
                </Panel>
              );
            case "vendor":
              return (
                <Panel key={key} className="col-6" dragProps={makeDragProps("vendor")}
                  title="Vendor breakdown" subtitle="Devices by manufacturer"
                  onMaximize={() => setMaximizedChartKey("vendor")}
                  controls={<ModeToggle modes={BAR_MODES} current={vendorMode} onChange={setVendorMode} />}
                >
                  <LegendStrip data={vendorData} dataKey="count" nameKey="name" />
                  <UnifiedChart data={vendorData} mode={getActiveMode(vendorMode)} dataKey="count" nameKey="name" height={chartHeight} onChartClick={n => handleChartClick("vendor", n)} />
                </Panel>
              );
            case "group":
              return (
                <Panel key={key} className="col-6" dragProps={makeDragProps("group")}
                  title="Group breakdown" subtitle="Devices by network group"
                  onMaximize={() => setMaximizedChartKey("group")}
                  controls={<ModeToggle modes={BAR_MODES} current={groupMode} onChange={setGroupMode} />}
                >
                  <LegendStrip data={groupData} dataKey="count" nameKey="name" />
                  <UnifiedChart data={groupData} mode={getActiveMode(groupMode)} dataKey="count" nameKey="name" height={chartHeight} onChartClick={n => handleChartClick("group", n)} />
                </Panel>
              );
            default:
              return null;
          }
        })}
      </div>

      {/* ── Activity + Failures ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(400px, 1fr))", gap: 16 }}>

        {/* Recent activity */}
        <Panel title="🕒 Recent activity" subtitle={`${filteredLogs.length} operations`}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 420, overflowY: "auto", paddingRight: 4 }}>
            {filteredLogs.slice(0, logLimitN).map((log, i) => {
              const t = new Date(log.timestamp);
              return (
                <div key={i} style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  padding: "10px 13px", background: "var(--surface)",
                  borderRadius: 8, border: "1px solid var(--border-whisper)", gap: 8
                }}>
                  <div>
                    <div style={{ fontWeight: 700, color: "var(--text-high-contrast)", fontSize: 13 }}>{log.device_name}</div>
                    <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", marginTop: 2, letterSpacing: ".04em" }}>{log.collection_type}</div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                    <span style={{
                      display: "inline-flex", padding: "3px 8px", borderRadius: 4,
                      fontSize: 10, fontWeight: 700, textTransform: "uppercase",
                      backgroundColor: log.status === "success" ? "rgba(16,185,129,0.15)" : "rgba(239,68,68,0.15)",
                      color: log.status === "success" ? "var(--status-success)" : "var(--status-danger)"
                    }}>{log.status}</span>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 11, color: "var(--text-high-contrast)" }}>{t.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
                      <div style={{ fontSize: 10, color: "var(--text-muted)" }}>{t.toLocaleDateString([], { month: "short", day: "numeric" })}</div>
                    </div>
                  </div>
                </div>
              );
            })}
            {filteredLogs.length === 0 && (
              <div style={{ border: "1px dashed var(--border-whisper)", borderRadius: 8, padding: "32px 24px", textAlign: "center", background: "var(--surface)", color: "var(--text-muted)", fontSize: 14 }}>
                No activity matches current filters.
              </div>
            )}
          </div>
        </Panel>

        {/* Attention required */}
        <Panel title="🚨 Attention required" subtitle={`${failedLogs.length} failed operation${failedLogs.length !== 1 ? "s" : ""}`}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 420, overflowY: "auto", paddingRight: 4 }}>
            {failedLogs.slice(0, logLimitN).map((log, i) => (
              <div key={i} style={{
                padding: "10px 13px", background: "rgba(239,68,68,0.05)",
                borderRadius: 8, border: "1px solid rgba(239,68,68,0.2)"
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                  <span style={{ fontWeight: 700, color: "var(--text-high-contrast)", fontSize: 13 }}>{log.device_name}</span>
                  <span style={{ fontSize: 10, color: "var(--status-danger)", fontWeight: 700, background: "rgba(239,68,68,0.15)", padding: "2px 8px", borderRadius: 4 }}>FAILED</span>
                </div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", fontStyle: "italic" }}>{log.error_msg || "Unknown error during collection"}</div>
                <div style={{ fontSize: 10, color: "var(--text-inactive)", marginTop: 4 }}>{log.collection_type} · {new Date(log.timestamp).toLocaleString()}</div>
              </div>
            ))}
            {failedLogs.length === 0 && (
              <div style={{ border: "1px dashed rgba(16,185,129,0.2)", background: "rgba(16,185,129,0.03)", color: "var(--status-success)", borderRadius: 8, padding: 32, textAlign: "center", fontSize: 14 }}>
                ✅ All recent operations successful!
              </div>
            )}
          </div>
          <Link to="/inventory" style={{
            display: "block", textAlign: "center", marginTop: 12, textDecoration: "none",
            padding: "8px 14px", border: "1px solid var(--border-whisper)", borderRadius: 6,
            background: "var(--surface)", color: "var(--text-high-contrast)", fontSize: 12, fontWeight: 600
          }}>
            View all devices →
          </Link>
        </Panel>
      </div>

      {/* ── Maximized chart modal ── */}
      <MaximizedChartModal
        chartKey={maximizedChartKey}
        chartProps={maximizedProps}
        onClose={() => setMaximizedChartKey(null)}
      />

    </div>
  );
}
