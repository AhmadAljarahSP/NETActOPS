import React, { useState, useEffect, useMemo } from 'react';
import { useTheme } from '../context/ThemeContext';

const API = "/api";

export default function EolEos() {
  const { config, styles, theme } = useTheme();
  const { colors } = theme;

  const [complianceData, setComplianceData] = useState([]);
  const [loading, setLoading] = useState(false);
  
  // Search and Excel-like Column Dropdown Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [filterHostname, setFilterHostname] = useState("");
  const [filterIp, setFilterIp] = useState("");
  const [filterGroup, setFilterGroup] = useState("");
  const [filterVendor, setFilterVendor] = useState("");
  const [filterPlatform, setFilterPlatform] = useState("");
  const [filterVersion, setFilterVersion] = useState("");
  const [filterSwEos, setFilterSwEos] = useState("");
  const [filterHwEos, setFilterHwEos] = useState("");
  const [filterRecommended, setFilterRecommended] = useState("");
  const [filterStatus, setFilterStatus] = useState("All");

  useEffect(() => {
    fetchCompliance();
  }, []);

  const fetchCompliance = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/eoleos-compliance`, {
        headers: { 'x-api-key': sessionStorage.getItem('app_password') || '' }
      });
      if (res.ok) {
        setComplianceData(await res.json());
      }
    } catch (e) {
      console.error("Error fetching EOL/EOS compliance:", e);
    } finally {
      setLoading(false);
    }
  };

  // Memoized lists of unique options for the Excel-like dropdown filters to prevent typing lag
  const uniqueOptions = useMemo(() => {
    const getOptions = (key) => {
      const values = complianceData.map(d => d[key]).filter(val => val !== undefined && val !== null && val !== "");
      return Array.from(new Set(values)).sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' }));
    };
    return {
      group: getOptions('group'),
      vendor: getOptions('vendor'),
      platform: getOptions('platform'),
      current_version: getOptions('current_version'),
      software_eos: getOptions('software_eos'),
      hardware_eos: getOptions('hardware_eos'),
      recommended_version: getOptions('recommended_version'),
    };
  }, [complianceData]);

  // Backward compatibility wrapper for JSX dropdown elements
  const getUniqueOptions = (key) => {
    return uniqueOptions[key] || [];
  };

  const filteredData = complianceData.filter(d => {
    // 1. Global search
    const query = searchQuery.toLowerCase();
    if (query) {
      const matchGlobal = (
        d.hostname.toLowerCase().includes(query) ||
        d.ip_address.toLowerCase().includes(query) ||
        d.group.toLowerCase().includes(query) ||
        d.vendor.toLowerCase().includes(query) ||
        d.platform.toLowerCase().includes(query) ||
        d.current_version.toLowerCase().includes(query) ||
        d.status.toLowerCase().includes(query)
      );
      if (!matchGlobal) return false;
    }

    // 2. Excel-Style Dropdown & Search Filters
    if (filterHostname && !d.hostname.toLowerCase().includes(filterHostname.toLowerCase())) return false;
    if (filterIp && !d.ip_address.toLowerCase().includes(filterIp.toLowerCase())) return false;
    
    // Exact match dropdown filters
    if (filterGroup && d.group !== filterGroup) return false;
    if (filterVendor && d.vendor !== filterVendor) return false;
    if (filterPlatform && d.platform !== filterPlatform) return false;
    if (filterVersion && d.current_version !== filterVersion) return false;
    if (filterSwEos && d.software_eos !== filterSwEos) return false;
    if (filterHwEos && d.hardware_eos !== filterHwEos) return false;
    if (filterRecommended && d.recommended_version !== filterRecommended) return false;
    
    // Status select filter
    if (filterStatus !== "All") {
      if (filterStatus === "PENDING_OR_UNMATCHED" && (d.has_healthcheck && d.matched)) return false;
      if (filterStatus === "PENDING" && d.has_healthcheck) return false;
      if (filterStatus === "UNMATCHED" && (d.has_healthcheck && d.matched)) return false;
      if (filterStatus === "SW_EXPIRED" && !d.is_software_expired) return false;
      if (filterStatus === "HW_EXPIRED" && !d.is_hardware_expired) return false;
      if (filterStatus === "WARNING" && d.status !== "warning") return false;
      if (filterStatus === "SUPPORTED" && d.status !== "safe") return false;
    }

    return true;
  });

  // Calculate dynamic stats
  const totalDevices = complianceData.length;
  const eosExpiredCount = complianceData.filter(d => d.is_software_expired).length;
  const eolExpiredCount = complianceData.filter(d => d.is_hardware_expired).length;
  const supportedCount = complianceData.filter(d => d.status === "safe").length;
  const pendingCount = complianceData.filter(d => !d.has_healthcheck || !d.matched).length;

  const getStatusBadge = (dev) => {
    if (!dev.has_healthcheck) {
      return (
        <span style={{
          padding: '4px 10px',
          borderRadius: '20px',
          fontSize: '11px',
          fontWeight: 700,
          background: `${colors.primary}15`,
          color: colors.primary,
          border: `1px solid ${colors.primary}40`,
          textTransform: 'uppercase'
        }}>
          ❓ PENDING HEALTHCHECK
        </span>
      );
    }
    if (!dev.matched) {
      return (
        <span style={{
          padding: '4px 10px',
          borderRadius: '20px',
          fontSize: '11px',
          fontWeight: 700,
          background: `${colors.gray}15`,
          color: colors.gray,
          border: `1px solid ${colors.gray}40`,
          textTransform: 'uppercase'
        }}>
          ❓ NO LIFECYCLE MATCH
        </span>
      );
    }
    if (dev.status === "danger") {
      let label = "🚨 EOS/EOL EXPIRED";
      if (dev.is_software_expired && dev.is_hardware_expired) label = "🚨 FULL EOL & EOS EXPIRED";
      else if (dev.is_software_expired) label = "🚨 SOFTWARE EOS EXPIRED";
      else if (dev.is_hardware_expired) label = "🚨 HARDWARE EOL EXPIRED";

      return (
        <span style={{
          padding: '4px 10px',
          borderRadius: '20px',
          fontSize: '11px',
          fontWeight: 700,
          background: `${colors.danger}15`,
          color: colors.danger,
          border: `1px solid ${colors.danger}40`,
          textTransform: 'uppercase',
          boxShadow: `0 0 8px ${colors.danger}20`
        }}>
          {label}
        </span>
      );
    }
    if (dev.status === "warning") {
      let label = "⚠️ EOS WARNING";
      if (dev.is_software_warning && dev.is_hardware_warning) label = "⚠️ EOL & EOS WARNING";
      else if (dev.is_software_warning) label = "⚠️ SOFTWARE EOS WARNING";
      else if (dev.is_hardware_warning) label = "⚠️ HARDWARE EOL WARNING";

      return (
        <span style={{
          padding: '4px 10px',
          borderRadius: '20px',
          fontSize: '11px',
          fontWeight: 700,
          background: `rgba(245, 158, 11, 0.15)`,
          color: '#f59e0b',
          border: `1px solid rgba(245, 158, 11, 0.40)`,
          textTransform: 'uppercase'
        }}>
          {label}
        </span>
      );
    }
    return (
      <span style={{
        padding: '4px 10px',
        borderRadius: '20px',
        fontSize: '11px',
        fontWeight: 700,
        background: `${colors.success}15`,
        color: colors.success,
        border: `1px solid ${colors.success}40`,
        textTransform: 'uppercase',
        boxShadow: `0 0 8px ${colors.success}20`
      }}>
        ✅ SUPPORTED
      </span>
    );
  };

  const filterInputStyle = {
    width: '100%',
    padding: '6px 10px',
    fontSize: '11px',
    background: 'var(--surface-solid)',
    border: '1px solid var(--border-whisper)',
    borderRadius: '8px',
    color: 'var(--text-high-contrast)',
    outline: 'none',
    boxSizing: 'border-box',
    minWidth: '70px',
    appearance: 'none',
    cursor: 'pointer'
  };

  {/* Metrics helper card style resolver */}
  const cardStyle = (color, isActive) => ({
    ...styles.panel,
    padding: '20px 24px',
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    borderLeft: color ? `4px solid ${color}` : undefined,
    cursor: 'pointer',
    transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.3s cubic-bezier(0.4, 0, 0.2, 1), border-color 0.3s',
    boxShadow: isActive ? `0 8px 30px ${(color || colors.primary)}30` : `0 4px 12px rgba(0,0,0,${config.mode === 'dark' ? 0.2 : 0.04})`,
    transform: isActive ? 'translateY(-4px)' : 'none'
  });

  return (
    <div style={styles.container}>
      {/* Header section */}
      <div style={{ marginBottom: 32, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16 }}>
        <div>
          <h1 style={styles.title}>📅 EOL & EOS Center</h1>
          <p style={styles.subtitle}>
            Live comparison between active imported configuration sheets and latest Git healthcheck display version commands.
          </p>
        </div>
        <button
          onClick={fetchCompliance}
          disabled={loading}
          style={{ ...styles.buttonSecondary, padding: '10px 18px', display: 'flex', alignItems: 'center', gap: 8 }}
        >
          {loading ? 'Comparing...' : '🔄 Refresh Comparison'}
        </button>
      </div>

      {/* Metrics Row (5 Cards - separating EOL and EOS) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 20, marginBottom: 32 }}>
        <div 
          onClick={() => setFilterStatus("All")}
          style={cardStyle(colors.gray, filterStatus === "All")}
          onMouseEnter={e => {
            e.currentTarget.style.transform = "translateY(-4px)";
            e.currentTarget.style.boxShadow = `0 12px 28px ${colors.gray}20`;
          }}
          onMouseLeave={e => {
            const isActive = filterStatus === "All";
            e.currentTarget.style.transform = isActive ? "translateY(-4px)" : "none";
            e.currentTarget.style.boxShadow = isActive ? `0 8px 30px ${colors.gray}30` : `0 4px 12px rgba(0,0,0,${config.mode === 'dark' ? 0.2 : 0.04})`;
          }}
        >
          <div style={{ fontSize: 12, color: colors.gray, fontWeight: 600, textTransform: 'uppercase' }}>Network Devices</div>
          <div style={{ fontSize: 32, fontWeight: 800, color: colors.light }}>{totalDevices}</div>
        </div>
        <div 
          onClick={() => setFilterStatus("SW_EXPIRED")}
          style={cardStyle(colors.danger, filterStatus === "SW_EXPIRED")}
          onMouseEnter={e => {
            e.currentTarget.style.transform = "translateY(-4px)";
            e.currentTarget.style.boxShadow = `0 12px 28px ${colors.danger}20`;
          }}
          onMouseLeave={e => {
            const isActive = filterStatus === "SW_EXPIRED";
            e.currentTarget.style.transform = isActive ? "translateY(-4px)" : "none";
            e.currentTarget.style.boxShadow = isActive ? `0 8px 30px ${colors.danger}30` : `0 4px 12px rgba(0,0,0,${config.mode === 'dark' ? 0.2 : 0.04})`;
          }}
        >
          <div style={{ fontSize: 12, color: colors.danger, fontWeight: 700, textTransform: 'uppercase' }}>EOS Expired (Software)</div>
          <div style={{ fontSize: 32, fontWeight: 800, color: colors.danger }}>{eosExpiredCount}</div>
        </div>
        <div 
          onClick={() => setFilterStatus("HW_EXPIRED")}
          style={cardStyle("#ec4899", filterStatus === "HW_EXPIRED")}
          onMouseEnter={e => {
            e.currentTarget.style.transform = "translateY(-4px)";
            e.currentTarget.style.boxShadow = `0 12px 28px #ec489920`;
          }}
          onMouseLeave={e => {
            const isActive = filterStatus === "HW_EXPIRED";
            e.currentTarget.style.transform = isActive ? "translateY(-4px)" : "none";
            e.currentTarget.style.boxShadow = isActive ? `0 8px 30px #ec489930` : `0 4px 12px rgba(0,0,0,${config.mode === 'dark' ? 0.2 : 0.04})`;
          }}
        >
          <div style={{ fontSize: 12, color: '#ec4899', fontWeight: 700, textTransform: 'uppercase' }}>EOL Expired (Hardware)</div>
          <div style={{ fontSize: 32, fontWeight: 800, color: '#ec4899' }}>{eolExpiredCount}</div>
        </div>
        <div 
          onClick={() => setFilterStatus("SUPPORTED")}
          style={cardStyle(colors.success, filterStatus === "SUPPORTED")}
          onMouseEnter={e => {
            e.currentTarget.style.transform = "translateY(-4px)";
            e.currentTarget.style.boxShadow = `0 12px 28px ${colors.success}20`;
          }}
          onMouseLeave={e => {
            const isActive = filterStatus === "SUPPORTED";
            e.currentTarget.style.transform = isActive ? "translateY(-4px)" : "none";
            e.currentTarget.style.boxShadow = isActive ? `0 8px 30px ${colors.success}30` : `0 4px 12px rgba(0,0,0,${config.mode === 'dark' ? 0.2 : 0.04})`;
          }}
        >
          <div style={{ fontSize: 12, color: colors.success, fontWeight: 700, textTransform: 'uppercase' }}>Supported Systems</div>
          <div style={{ fontSize: 32, fontWeight: 800, color: colors.success }}>{supportedCount}</div>
        </div>
        <div 
          onClick={() => setFilterStatus("PENDING_OR_UNMATCHED")}
          style={cardStyle(colors.primary, filterStatus === "PENDING_OR_UNMATCHED")}
          onMouseEnter={e => {
            e.currentTarget.style.transform = "translateY(-4px)";
            e.currentTarget.style.boxShadow = `0 12px 28px ${colors.primary}20`;
          }}
          onMouseLeave={e => {
            const isActive = filterStatus === "PENDING_OR_UNMATCHED";
            e.currentTarget.style.transform = isActive ? "translateY(-4px)" : "none";
            e.currentTarget.style.boxShadow = isActive ? `0 8px 30px ${colors.primary}30` : `0 4px 12px rgba(0,0,0,${config.mode === 'dark' ? 0.2 : 0.04})`;
          }}
        >
          <div style={{ fontSize: 12, color: colors.primary, fontWeight: 700, textTransform: 'uppercase' }}>Pending / No Match</div>
          <div style={{ fontSize: 32, fontWeight: 800, color: colors.primary }}>{pendingCount}</div>
        </div>
      </div>

      {/* Comparison Compliance Table */}
      <div style={styles.panel}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, flexWrap: 'wrap', gap: 16 }}>
          <div>
            <h3 style={{ ...styles.sectionTitle, margin: 0 }}>Device Compliance & Lifecycle Directory</h3>
            <p style={{ ...styles.label, margin: '4px 0 0 0', fontSize: 12, textTransform: 'none' }}>
              Excel-like dropdown filters select from options currently present. Select "All" to remove filter.
            </p>
          </div>
          <div>
            <input
              type="text"
              placeholder="Global Search..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ ...styles.input, width: 260, padding: '10px 16px', fontSize: 13 }}
            />
          </div>
        </div>

        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '240px', color: colors.gray, gap: 12 }}>
            <div className="spinner" style={{
              width: 24,
              height: 24,
              border: `3px solid ${colors.primary}30`,
              borderTopColor: colors.primary,
              borderRadius: '50%',
              animation: 'spin 1s linear infinite'
            }} />
            <span>Parsing healthcheck outputs and matching platform models...</span>
          </div>
        ) : filteredData.length === 0 ? (
          <div style={{ color: colors.gray, fontSize: 14, fontStyle: 'italic', textAlign: 'center', padding: '48px' }}>
            No compliance records match the active filters.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${styles.border}`, textAlign: 'left' }}>
                  <th style={{ padding: '12px 8px', color: colors.gray }}>Hostname</th>
                  <th style={{ padding: '12px 8px', color: colors.gray }}>IP Address</th>
                  <th style={{ padding: '12px 8px', color: colors.gray }}>Group</th>
                  <th style={{ padding: '12px 8px', color: colors.gray }}>Vendor</th>
                  <th style={{ padding: '12px 8px', color: colors.gray }}>Active Platform</th>
                  <th style={{ padding: '12px 8px', color: colors.gray }}>Running Firmware</th>
                  <th style={{ padding: '12px 8px', color: colors.gray }}>Software EOS</th>
                  <th style={{ padding: '12px 8px', color: colors.gray }}>Hardware EOS</th>
                  <th style={{ padding: '12px 8px', color: colors.gray }}>Recommended SW</th>
                  <th style={{ padding: '12px 8px', color: colors.gray, textAlign: 'right' }}>Compliance</th>
                </tr>
                {/* Excel-style Filter Row */}
                <tr style={{ background: `${colors.primary}05`, borderBottom: "1px solid var(--border-whisper)" }}>
                  {/* Hostname: Search input */}
                  <td style={{ padding: '6px 4px' }}>
                    <input
                      type="text"
                      placeholder="Search..."
                      value={filterHostname}
                      onChange={(e) => setFilterHostname(e.target.value)}
                      style={{ ...filterInputStyle, appearance: 'auto', cursor: 'text' }}
                    />
                  </td>
                  {/* IP Address: Search input */}
                  <td style={{ padding: '6px 4px' }}>
                    <input
                      type="text"
                      placeholder="Search..."
                      value={filterIp}
                      onChange={(e) => setFilterIp(e.target.value)}
                      style={{ ...filterInputStyle, appearance: 'auto', cursor: 'text' }}
                    />
                  </td>
                  {/* Group: Excel Dropdown */}
                  <td style={{ padding: '6px 4px' }}>
                    <select
                      value={filterGroup}
                      onChange={(e) => setFilterGroup(e.target.value)}
                      style={filterInputStyle}
                    >
                      <option value="">All</option>
                      {getUniqueOptions('group').map(opt => <option key={opt} value={opt}>{opt}</option>)}
                    </select>
                  </td>
                  {/* Vendor: Excel Dropdown */}
                  <td style={{ padding: '6px 4px' }}>
                    <select
                      value={filterVendor}
                      onChange={(e) => setFilterVendor(e.target.value)}
                      style={filterInputStyle}
                    >
                      <option value="">All</option>
                      {getUniqueOptions('vendor').map(opt => <option key={opt} value={opt}>{opt}</option>)}
                    </select>
                  </td>
                  {/* Active Platform: Excel Dropdown */}
                  <td style={{ padding: '6px 4px' }}>
                    <select
                      value={filterPlatform}
                      onChange={(e) => setFilterPlatform(e.target.value)}
                      style={filterInputStyle}
                    >
                      <option value="">All</option>
                      {getUniqueOptions('platform').map(opt => <option key={opt} value={opt}>{opt}</option>)}
                    </select>
                  </td>
                  {/* Running Firmware: Excel Dropdown */}
                  <td style={{ padding: '6px 4px' }}>
                    <select
                      value={filterVersion}
                      onChange={(e) => setFilterVersion(e.target.value)}
                      style={filterInputStyle}
                    >
                      <option value="">All</option>
                      {getUniqueOptions('current_version').map(opt => <option key={opt} value={opt}>{opt}</option>)}
                    </select>
                  </td>
                  {/* Software EOS: Excel Dropdown */}
                  <td style={{ padding: '6px 4px' }}>
                    <select
                      value={filterSwEos}
                      onChange={(e) => setFilterSwEos(e.target.value)}
                      style={filterInputStyle}
                    >
                      <option value="">All</option>
                      {getUniqueOptions('software_eos').map(opt => <option key={opt} value={opt}>{opt}</option>)}
                    </select>
                  </td>
                  {/* Hardware EOS: Excel Dropdown */}
                  <td style={{ padding: '6px 4px' }}>
                    <select
                      value={filterHwEos}
                      onChange={(e) => setFilterHwEos(e.target.value)}
                      style={filterInputStyle}
                    >
                      <option value="">All</option>
                      {getUniqueOptions('hardware_eos').map(opt => <option key={opt} value={opt}>{opt}</option>)}
                    </select>
                  </td>
                  {/* Recommended SW: Excel Dropdown */}
                  <td style={{ padding: '6px 4px' }}>
                    <select
                      value={filterRecommended}
                      onChange={(e) => setFilterRecommended(e.target.value)}
                      style={filterInputStyle}
                    >
                      <option value="">All</option>
                      {getUniqueOptions('recommended_version').map(opt => <option key={opt} value={opt}>{opt}</option>)}
                    </select>
                  </td>
                  {/* Compliance Status: Dropdown */}
                  <td style={{ padding: '6px 4px', textAlign: 'right' }}>
                    <select
                      value={filterStatus}
                      onChange={(e) => setFilterStatus(e.target.value)}
                      style={{
                        ...filterInputStyle,
                        width: '100%',
                        fontWeight: 600,
                        background: 'var(--surface-solid)',
                        color: colors.primary
                      }}
                    >
                      <option value="All">⚡ All</option>
                      <option value="SUPPORTED">✅ Supported</option>
                      <option value="SW_EXPIRED">🚨 Software EOS Expired</option>
                      <option value="HW_EXPIRED">🚨 Hardware EOL Expired</option>
                      <option value="WARNING">⚠️ Warning</option>
                      <option value="PENDING">❓ Pending</option>
                      <option value="UNMATCHED">❓ Unmatched</option>
                      {filterStatus === "PENDING_OR_UNMATCHED" && (
                        <option value="PENDING_OR_UNMATCHED">❓ Pending / No Match</option>
                      )}
                    </select>
                  </td>
                </tr>
              </thead>
              <tbody>
                {filteredData.map(dev => {
                  return (
                    <tr key={dev.device_id} style={{
                      borderBottom: "1px solid var(--border-whisper)",
                      background: dev.status === "danger" ? `${colors.danger}05` : 'transparent',
                      transition: 'all 0.2s'
                    }}>
                      <td style={{ padding: '16px 8px', fontWeight: 700, color: colors.light }}>
                        {dev.hostname}
                      </td>
                      <td style={{ padding: '16px 8px', color: colors.light, fontFamily: 'monospace' }}>
                        {dev.ip_address}
                      </td>
                      <td style={{ padding: '16px 8px', color: colors.light }}>
                        <span style={{
                          padding: '3px 8px',
                          borderRadius: '6px',
                          background: 'var(--surface-solid)',
                          fontSize: '11px',
                          fontWeight: 600
                        }}>
                          {dev.group}
                        </span>
                      </td>
                      <td style={{ padding: '16px 8px', color: colors.light, textTransform: 'capitalize', fontWeight: 600 }}>
                        {dev.vendor}
                      </td>
                      <td style={{ padding: '16px 8px', color: dev.matched ? colors.light : colors.gray, fontWeight: dev.matched ? 600 : 400 }}>
                        {dev.platform}
                      </td>
                      <td style={{ padding: '16px 8px', color: dev.matched ? colors.light : colors.gray, fontFamily: 'monospace' }}>
                        {dev.current_version}
                      </td>
                      <td style={{ padding: '16px 8px', color: dev.is_software_expired ? colors.danger : colors.gray, fontWeight: dev.is_software_expired ? 600 : 400 }}>
                        {dev.software_eos}
                      </td>
                      <td style={{ padding: '16px 8px', color: dev.is_hardware_expired ? colors.danger : colors.gray, fontWeight: dev.is_hardware_expired ? 600 : 400 }}>
                        {dev.hardware_eos}
                      </td>
                      <td style={{ padding: '16px 8px', color: dev.matched ? colors.info : colors.gray, fontWeight: dev.matched ? 600 : 400 }}>
                        {dev.recommended_version}
                      </td>
                      <td style={{ padding: '16px 8px', textAlign: 'right' }}>
                        {getStatusBadge(dev)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      ` }} />
    </div>
  );
}
