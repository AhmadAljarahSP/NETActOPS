import React, { useEffect, useMemo, useState, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { useTheme } from "../context/ThemeContext";
import { getBadgeStyle } from "../styles";
import CompareModal from "../components/CompareModal";
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

export default function DeviceHealthchecks() {
  const { id } = useParams();
  const { config, styles, theme } = useTheme();
  const { isViewer } = useAuth();
  const { colors } = theme;

  const [device, setDevice] = useState(null);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);

  const [fullResult, setFullResult] = useState(null);
  const [compareData, setCompareData] = useState(null);

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
      const res = await fetch(`${API}/devices/healthchecks-summary`, {
        headers: { 'x-api-key': sessionStorage.getItem('app_password') || '' }
      });
      if (res.ok) {
        const summaryList = await res.json();
        const found = summaryList.find(d => d.id === parseInt(id));
        setDevice(found);
        if (found) {
          await fetchResults(found.id);
        }
      }
    } catch (err) {
      console.error("Failed to load device:", err);
    } finally {
      setLoading(false);
    }
  };

  const fetchResults = async (deviceId) => {
    try {
      const res = await fetch(`${API}/collections/${deviceId}?collection_type=healthcheck`, {
        headers: { 'x-api-key': sessionStorage.getItem('app_password') || '' }
      });
      if (res.ok) {
        setResults(await res.json());
      }
    } catch (err) {
      console.error("Failed to fetch health history:", err);
    }
  };

  const triggerHealthcheck = async () => {
    if (!device) return;
    setChecking(true);
    try {
      const res = await fetch(`${API}/healthcheck/${device.id}`, {
        method: "POST",
        headers: { 'x-api-key': sessionStorage.getItem('app_password') || '' }
      });
      const data = await res.json();
      if (data.status === "success") {
        await fetchResults(device.id);
        await loadDevice();
      } else {
        alert(`Healthcheck failed: ${data.error || "Unknown error"}`);
      }
    } catch (err) {
      console.error("Healthcheck trigger failed:", err);
    } finally {
      setChecking(false);
    }
  };

  const viewFull = useCallback(async (collectionId) => {
    try {
      const res = await fetch(`${API}/collections/${collectionId}/full?collection_type=healthcheck&device_id=${device?.id}`, {
        headers: { 'x-api-key': sessionStorage.getItem('app_password') || '' }
      });
      if (res.ok) {
        setFullResult(await res.json());
      }
    } catch (err) {
      console.error(err);
    }
  }, [device]);

  const downloadResult = useCallback(async (collectionId, hostname = "device-healthcheck") => {
    try {
      const res = await fetch(`${API}/collections/${collectionId}/full?collection_type=healthcheck&device_id=${device?.id}`, {
        headers: { 'x-api-key': sessionStorage.getItem('app_password') || '' }
      });
      if (res.ok) {
        const data = await res.json();
        const blob = new Blob([data?.config_text || ""], { type: "text/plain;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${hostname.replace(/[^\w.-]+/g, "_")}-healthcheck-${collectionId}.txt`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      console.error(err);
    }
  }, [device]);

  const successCount = useMemo(() => results.filter(r => r.status === "success").length, [results]);
  const failCount = useMemo(() => results.filter(r => r.status !== "success").length, [results]);
  const latestCheckTime = useMemo(() => {
    if (!results.length) return "N/A";
    return new Date(results[0].collected_at).toLocaleString();
  }, [results]);

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
        <div style={styles.errorState}>Device not found in diagnostics registry.</div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      {/* Navigation Header Link */}
      <Link 
        to="/healthcheck" 
        style={customStyles.backBtn}
        onMouseEnter={e => e.currentTarget.style.transform = "translateX(-4px)"}
        onMouseLeave={e => e.currentTarget.style.transform = "none"}
      >
        ← Back to Diagnostics Dashboard
      </Link>

      {device && (
        <>
          {/* Main Device Header Card */}
          <div style={customStyles.headerCard}>
            <div>
              <h2 style={customStyles.title}>{device.hostname}</h2>
              <div style={customStyles.subtitle}>
                IP Address: <strong style={{ color: colors.light }}>{device.ip_address}</strong> • Group: <span style={customStyles.badgeGroup(device.group)}>{device.group || device.group_file}</span>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <button 
                onClick={triggerHealthcheck} 
                style={styles.buttonPrimary} 
                disabled={checking || isViewer}
              >
                {checking ? (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ animation: "spin 1s linear infinite" }}>🔄</span> Diagnosing...
                  </span>
                ) : (
                  "Run Diagnostics Check"
                )}
              </button>
            </div>
          </div>

          {/* Historical Statistics Grid */}
          <div style={customStyles.analyticsGrid}>
            <div style={customStyles.analyticsBox}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: colors.gray, textTransform: "uppercase" }}>Diagnostic Success Ratio</div>
                <div style={{ fontSize: 11, color: colors.gray, marginTop: 2 }}>Completion rating</div>
              </div>
              <RatioCircle success={successCount} fail={failCount} colors={colors} />
            </div>
            <div style={customStyles.analyticsBox}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: colors.gray, textTransform: "uppercase" }}>Total Run Checks</div>
                <div style={customStyles.statValue}>{results.length}</div>
              </div>
            </div>
            <div style={customStyles.analyticsBox}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: colors.gray, textTransform: "uppercase" }}>Last Diagnostic Result</div>
                <div style={{ ...customStyles.statValue, fontSize: 15, textTransform: "capitalize", color: results[0]?.status === "success" ? colors.success : colors.danger }}>
                  {results[0] ? `${results[0].status} (${latestCheckTime})` : "Never Checked"}
                </div>
              </div>
            </div>
          </div>

          {/* Healthcheck Timeline Cards */}
          <div style={customStyles.timeline}>
            {loading ? (
              <div style={styles.loadingState}>Loading diagnostics history...</div>
            ) : results.length === 0 ? (
              <div style={styles.emptyState}>No healthchecks found for this node yet. Click "Run Diagnostics Check" to begin.</div>
            ) : (
              results.map(r => (
                <div key={r.id} style={customStyles.card}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={getBadgeStyle(r.status, colors)}>{r.status}</span>
                    </div>
                    <span style={styles.timestamp}>{new Date(r.collected_at).toLocaleString()}</span>
                  </div>
                  <pre style={{ ...styles.codeBlock, maxHeight: 180, overflow: "auto", marginBottom: 16 }}>{r.preview}</pre>
                  <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                    <button 
                      onClick={() => viewFull(r.id)} 
                      style={customStyles.iconBtn} 
                      title="View Full Report"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                    </button>
                    <button 
                      onClick={() => downloadResult(r.id, device.hostname)} 
                      style={customStyles.iconBtn} 
                      title="Download Log Report"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
                    </button>
                    <button 
                      onClick={() => setCompareData({ id1: r.id, id2: results.find(bb => bb.id !== r.id)?.id })} 
                      style={customStyles.iconBtn} 
                      title="Compare Versions"
                      disabled={results.length < 2}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M16 3h5v5M4 20L20 4M21 16v5h-5M4 4l16 16"/></svg>
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </>
      )}

      {/* FULL CONFIG VIEW MODAL */}
      {fullResult && device && (
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
                <h3 style={styles.modalTitle}>Full Healthcheck Report — {device.hostname} (#{fullResult.id})</h3>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, maxWidth: 600 }}>
                  <div style={{ position: 'relative', flex: 1 }}>
                    <input 
                      type="text" 
                      placeholder="Search report text... (Press Enter)" 
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

      {/* COMPARE HISTORY MODAL */}
      {compareData && (
        <CompareModal
          collectionType="healthcheck"
          initialId1={compareData.id1}
          initialId2={compareData.id2}
          deviceName={device?.hostname}
          deviceId={device?.id}
          onClose={() => setCompareData(null)}
        />
      )}
    </div>
  );
}
