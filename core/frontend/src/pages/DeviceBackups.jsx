import React, { useEffect, useMemo, useState, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { useTheme } from "../context/ThemeContext";
import { getBadgeStyle } from "../styles";
import CompareModal from "../components/CompareModal";
import RollbackModal from "../components/RollbackModal";
import RatioCircle from "../components/RatioCircle";
import { useAuth } from "../context/AuthContext";

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

export default function DeviceBackups() {
  const { id } = useParams();
  const { config, styles, theme } = useTheme();
  const { isViewer } = useAuth();
  const { colors } = theme;

  const [device, setDevice] = useState(null);
  const [backups, setBackups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [backingUp, setBackingUp] = useState(false);

  const [fullConfig, setFullConfig] = useState(null);
  const [compareData, setCompareData] = useState(null);
  const [rollbackTarget, setRollbackTarget] = useState(null);

  // Modal search states
  const [modalSearchTerm, setModalSearchTerm] = useState("");
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState("");
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
  const [totalMatches, setTotalMatches] = useState(0);
  const [tooManyMatches, setTooManyMatches] = useState(false);
  const [modalFullScreen, setModalFullScreen] = useState(false);

  useEffect(() => {
    loadDevice();
  }, [id]);

  const loadDevice = async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API}/devices/backups-summary`, {
        headers: { 'x-api-key': sessionStorage.getItem('app_password') || '' }
      });
      if (res.ok) {
        const summaryList = await res.json();
        const found = summaryList.find(d => d.id === parseInt(id));
        setDevice(found);
        if (found) {
          await fetchBackups(found.id, found.hostname);
        }
      }
    } catch (err) {
      console.error("Failed to load device:", err);
    } finally {
      setLoading(false);
    }
  };

  const fetchBackups = async (deviceId, hostname) => {
    try {
      const res = await fetch(`${API}/collections/${deviceId}?collection_type=backup`, {
        headers: { 'x-api-key': sessionStorage.getItem('app_password') || '' }
      });
      if (res.ok) {
        setBackups(await res.json());
      }
    } catch (err) {
      console.error("Failed to fetch backups timeline:", err);
    }
  };

  const triggerBackup = async () => {
    if (!device) return;
    setBackingUp(true);
    try {
      const res = await fetch(`${API}/backup/${device.id}`, {
        method: "POST",
        headers: { 'x-api-key': sessionStorage.getItem('app_password') || '' }
      });
      const data = await res.json();
      if (data.status === "success") {
        await fetchBackups(device.id, device.hostname);
        await loadDevice(); // Reload summary to update baseline compliance status
      } else {
        alert(`Backup failed: ${data.error || "Unknown error"}`);
      }
    } catch (err) {
      console.error("Backup collection failed:", err);
    } finally {
      setBackingUp(false);
    }
  };

  const viewFull = useCallback(async (backupId) => {
    try {
      const res = await fetch(`${API}/collections/${backupId}/full?collection_type=backup&device_id=${device?.id}`, {
        headers: { 'x-api-key': sessionStorage.getItem('app_password') || '' }
      });
      if (res.ok) {
        setFullConfig(await res.json());
      }
    } catch (err) {
      console.error(err);
    }
  }, [device]);

  const downloadConfig = useCallback(async (backupId, hostname = "device-config") => {
    try {
      const res = await fetch(`${API}/backups/${backupId}/full?device_id=${device?.id}`, {
        headers: { 'x-api-key': sessionStorage.getItem('app_password') || '' }
      });
      if (res.ok) {
        const data = await res.json();
        const blob = new Blob([data?.config_text || ""], { type: "text/plain;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${hostname.replace(/[^\w.-]+/g, "_")}-backup-${backupId}.txt`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      console.error(err);
    }
  }, [device]);

  const successCount = useMemo(() => backups.filter(b => b.status === "success").length, [backups]);
  const failCount = useMemo(() => backups.filter(b => b.status !== "success").length, [backups]);
  const latestBackup = useMemo(() => {
    if (!backups.length) return "N/A";
    return new Date(backups[0].collected_at).toLocaleString();
  }, [backups]);

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

  const isDark = config.mode === 'dark';
  const customStyles = {
    backBtn: {
      display: "inline-flex",
      alignItems: "center",
      gap: 8,
      fontSize: 13,
      fontWeight: 700,
      color: colors.primary,
      textDecoration: "none",
      marginBottom: 20,
      transition: "transform 0.2s"
    },
    headerCard: {
      background: isDark ? "rgba(15, 23, 42, 0.85)" : "rgba(255, 255, 255, 0.95)",
      border: `1px solid ${colors.border}`,
      borderRadius: 22,
      padding: "24px 32px",
      boxShadow: `0 12px 32px rgba(0,0,0,${isDark ? 0.3 : 0.05})`,
      backdropFilter: "blur(12px)",
      marginBottom: 24,
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      flexWrap: "wrap",
      gap: 16
    },
    title: {
      margin: 0,
      fontSize: 22,
      fontWeight: 800,
      color: colors.light,
      letterSpacing: "-0.5px"
    },
    subtitle: {
      margin: "4px 0 0 0",
      fontSize: 13,
      color: colors.gray
    },
    analyticsGrid: {
      display: "grid",
      gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
      gap: 20,
      marginBottom: 28
    },
    analyticsBox: {
      background: isDark ? "rgba(15, 23, 42, 0.8)" : "rgba(255, 255, 255, 0.9)",
      border: `1px solid ${colors.border}`,
      borderRadius: 18,
      padding: 20,
      boxShadow: `0 8px 20px rgba(0,0,0,${isDark ? 0.2 : 0.04})`,
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between"
    },
    statValue: {
      fontSize: 28,
      fontWeight: 800,
      color: colors.light,
      marginTop: 4
    },
    timeline: {
      display: "flex",
      flexDirection: "column",
      gap: 18
    },
    card: {
      background: isDark ? "rgba(15, 23, 42, 0.85)" : "rgba(255, 255, 255, 0.95)",
      border: `1px solid ${colors.border}`,
      borderRadius: 20,
      padding: 20,
      boxShadow: `0 8px 24px rgba(0,0,0,${isDark ? 0.2 : 0.04})`
    },
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
    iconBtn: {
      width: 32,
      height: 32,
      borderRadius: 8,
      border: `1px solid ${colors.border}`,
      background: isDark ? "rgba(2, 6, 23, 0.5)" : "#fff",
      color: colors.light,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      cursor: "pointer",
      position: "relative",
      transition: "all 0.2s"
    }
  };

  if (!device && !loading) {
    return (
      <div style={{ ...styles.page, display: "flex", alignItems: "center", justifyContent: "center", minHeight: "80vh" }}>
        <div style={styles.errorState}>Device not found in registry.</div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      {/* Navigation Header Link */}
      <Link 
        to="/backup" 
        style={customStyles.backBtn}
        onMouseEnter={e => e.currentTarget.style.transform = "translateX(-4px)"}
        onMouseLeave={e => e.currentTarget.style.transform = "none"}
      >
        ← Back to Device List
      </Link>

      {device && (
        <>
          {/* Main Device Header Card */}
          <div style={customStyles.headerCard}>
            <div>
              <h2 style={customStyles.title}>{device.hostname}</h2>
              <div style={customStyles.subtitle}>
                IP Address: <strong style={{ color: colors.light }}>{device.ip_address}</strong> • Group: <span style={customStyles.badgeGroup(device.group)}>{device.group}</span>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              {device.backup_summary?.gold_standard && (
                <span style={{
                  padding: "6px 14px",
                  borderRadius: 10,
                  fontSize: 12,
                  fontWeight: 700,
                  background: device.backup_summary.is_compliant ? `${colors.success}15` : `${colors.danger}15`,
                  color: device.backup_summary.is_compliant ? colors.success : colors.danger,
                  border: `1.5px solid ${device.backup_summary.is_compliant ? colors.success : colors.danger}30`
                }}>
                  {device.backup_summary.is_compliant ? "🎖️ Compliant Baseline" : "⚠️ Drift Detected"}
                </span>
              )}
              <button 
                onClick={triggerBackup} 
                style={styles.buttonPrimary} 
                disabled={backingUp}
              >
                {backingUp ? (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ animation: "spin 1s linear infinite" }}>🔄</span> Collecting...
                  </span>
                ) : (
                  "Collect New Backup"
                )}
              </button>
            </div>
          </div>

          {/* Historical Statistics Grid */}
          <div style={customStyles.analyticsGrid}>
            <div style={customStyles.analyticsBox}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: colors.gray, textTransform: "uppercase" }}>Success Ratio</div>
                <div style={{ fontSize: 11, color: colors.gray, marginTop: 2 }}>Completion rating</div>
              </div>
              <RatioCircle success={successCount} fail={failCount} colors={colors} />
            </div>
            <div style={customStyles.analyticsBox}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: colors.gray, textTransform: "uppercase" }}>Total Collected</div>
                <div style={customStyles.statValue}>{backups.length}</div>
              </div>
            </div>
            <div style={customStyles.analyticsBox}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: colors.gray, textTransform: "uppercase" }}>Last Run Result</div>
                <div style={{ ...customStyles.statValue, fontSize: 15, textTransform: "capitalize", color: backups[0]?.status === "success" ? colors.success : colors.danger }}>
                  {backups[0] ? `${backups[0].status} (${latestBackup})` : "Never"}
                </div>
              </div>
            </div>
          </div>

          {/* Backups Timeline Cards */}
          <div style={customStyles.timeline}>
            {loading ? (
              <div style={styles.loadingState}>Loading configuration history...</div>
            ) : backups.length === 0 ? (
              <div style={styles.emptyState}>No backups found in Git repo for this node yet. Click "Collect New Backup" to begin.</div>
            ) : (
              backups.map(b => {
                const isBaseline = device.backup_summary?.gold_standard?.id === b.id;
                
                return (
                  <div key={b.id} style={customStyles.card}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span style={getBadgeStyle(b.status, colors)}>{b.status}</span>
                        {isBaseline && (
                          <span style={{ fontSize: 11, fontWeight: 700, color: colors.warning, background: `${colors.warning}15`, padding: "2px 8px", borderRadius: 6, border: `1px solid ${colors.warning}30` }}>
                            🎖️ Active Gold Standard Baseline
                          </span>
                        )}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        {b.lines_added > 0 || b.lines_deleted > 0 ? (
                          <div style={{ display: "inline-flex", gap: 8, fontSize: 12, fontWeight: 700 }}>
                            <span style={{ color: colors.success }}>+{b.lines_added}</span>
                            <span style={{ color: colors.danger }}>-{b.lines_deleted}</span>
                          </div>
                        ) : (
                          b.status === "success" && <span style={{ fontSize: 11, color: colors.gray }}>No changes from previous</span>
                        )}
                        <span style={styles.timestamp}>{new Date(b.collected_at).toLocaleString()}</span>
                      </div>
                    </div>
                    <pre style={{ ...styles.codeBlock, maxHeight: 180, overflow: "auto", marginBottom: 16 }}>{b.preview}</pre>
                    <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                      <button 
                        onClick={() => viewFull(b.id)} 
                        style={customStyles.iconBtn} 
                        title="View Full Config"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                      </button>
                      <button 
                        onClick={() => downloadConfig(b.id, device.hostname)} 
                        style={customStyles.iconBtn} 
                        title="Download Config"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
                      </button>
                      <button 
                        onClick={() => setCompareData({ backup1: b.id, backup2: backups.find(bb => bb.id !== b.id)?.id })} 
                        style={customStyles.iconBtn} 
                        title="Compare Versions"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M16 3h5v5M4 20L20 4M21 16v5h-5M4 4l16 16"/></svg>
                      </button>
                      <button 
                        onClick={() => setRollbackTarget(b.id)} 
                        style={customStyles.iconBtn} 
                        disabled={isViewer}
                        title="Rollback Device Config"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8M3 3v5h5"/></svg>
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </>
      )}

      {/* FULL CONFIG VIEW MODAL */}
      {fullConfig && device && (
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
                <h3 style={styles.modalTitle}>Full Config — {device.hostname} (#{fullConfig.id})</h3>
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

      {/* COMPARE HISTORY MODAL */}
      {compareData && (
        <CompareModal
          collectionType="backup"
          initialId1={compareData.backup1}
          initialId2={compareData.backup2}
          deviceName={device?.hostname}
          deviceId={device?.id}
          onClose={() => setCompareData(null)}
        />
      )}

      {/* ROLLBACK MODAL */}
      {rollbackTarget && device && (
        <RollbackModal
          backupId={rollbackTarget}
          deviceName={device.hostname}
          deviceId={device.id}
          onClose={() => setRollbackTarget(null)}
          onRollbackComplete={() => fetchBackups(device.id, device.hostname)}
        />
      )}
    </div>
  );
}