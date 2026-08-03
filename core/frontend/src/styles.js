export const themes = {
  dark: {
    name: 'dark',
    colors: {
      primary: "#F4F4F4",
      success: "#4edea3",
      danger: "#ef4444",
      warning: "#f59e0b",
      info: "#3b82f6",
      dark: "#343434",
      darker: "#1A1A1A",
      light: "#F4F4F4",
      gray: "#828282",
      border: "#313131"
    }
  },
  light: {
    name: 'light',
    colors: {
      primary: "#4f46e5",
      success: "#059669",
      danger: "#dc2626",
      warning: "#d97706",
      info: "#2563eb",
      dark: "#f1f5f9",
      darker: "#ffffff",
      light: "#0f172a",
      gray: "#475569",
      border: "#cbd5e1"
    }
  },
  high_contrast: {
    name: 'high_contrast',
    colors: {
      primary: "#ffff00",
      success: "#00ff00",
      danger: "#ff0000",
      warning: "#ffff00",
      info: "#00ffff",
      dark: "#000000",
      darker: "#000000",
      light: "#ffffff",
      gray: "#ffffff",
      border: "#ffffff"
    }
  },
  sepia: {
    name: 'sepia',
    colors: {
      primary: "#704214",
      success: "#3a5a40",
      danger: "#bc4749",
      warning: "#a47148",
      info: "#2a6f97",
      dark: "#e3d5ca",
      darker: "#f5ebe0",
      light: "#432818",
      gray: "#7f5539",
      border: "#d5bdaf"
    }
  },
  warm: {
    name: 'warm',
    colors: {
      primary: "#f97316",
      success: "#84cc16",
      danger: "#ef4444",
      warning: "#eab308",
      info: "#06b6d4",
      dark: "#1c1917",
      darker: "#0c0a09",
      light: "#fafaf9",
      gray: "#a8a29e",
      border: "#44403c"
    }
  },
  custom: {
    name: 'custom',
    colors: {
      primary: "#F4F4F4", // This will be overwritten by the context
      success: "#4edea3",
      danger: "#ef4444",
      warning: "#f59e0b",
      info: "#3b82f6",
      dark: "#343434",
      darker: "#1A1A1A",
      light: "#F4F4F4",
      gray: "#828282",
      border: "#313131"
    }
  }
};

export const getBadgeStyle = (status, colorsList = themes.dark.colors) => {
  let color = colorsList.danger;
  if (status === "success") {
    color = colorsList.success;
  } else if (status === "warning" || status === "pending") {
    color = colorsList.warning;
  } else if (status === "info") {
    color = colorsList.info;
  }
  
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "5px 12px",
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: 0.2,
    textTransform: "capitalize",
    background: `${color}20`,
    color: color,
    border: `1px solid ${color}40`,
  };
};

export const getStyles = (theme) => {
  const { colors } = theme;
  const isDark = theme.name !== 'light' && theme.name !== 'sepia';
  
  return {
    page: {
      minHeight: "100vh",
      background: theme.name === 'dark' 
        ? `radial-gradient(circle at top, ${colors.dark} 0%, ${colors.darker} 100%)`
        : colors.darker,
      fontFamily: 'var(--font-body), Satoshi, sans-serif',
      color: colors.light,
      padding: "32px 40px",
      transition: "background 0.3s, color 0.3s"
    },
    container: { maxWidth: 1400, margin: "0 auto" },
    header: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 16,
      marginBottom: 24,
      padding: "16px 24px",
      borderRadius: 12,
      background: isDark ? 'var(--surface)' : colors.dark,
      border: `1px solid var(--border-whisper)`,
      boxShadow: "none",
      backdropFilter: "none",
    },
    headerLeft: { display: "flex", alignItems: "center", gap: 14 },
    logoBox: {
      width: 48, height: 48, borderRadius: 8,
      background: "none",
      display: "flex", alignItems: "center", justifyContent: "center",
      flexShrink: 0,
    },
    title: { margin: 0, fontSize: 24, fontWeight: 700, letterSpacing: -0.5, color: colors.light, fontFamily: 'var(--font-headline), Geist, sans-serif' },
    subtitle: { margin: "4px 0 0", fontSize: 12, color: colors.gray, fontFamily: 'var(--font-body), Satoshi, sans-serif' },
    statPill: { padding: "8px 14px", borderRadius: 8, background: 'var(--surface-container)', border: `1px solid var(--border-whisper)`, fontSize: 12, fontWeight: 700, color: colors.light, whiteSpace: "nowrap", fontFamily: 'var(--font-mono), monospace' },
    panel: { 
      background: isDark ? 'var(--surface)' : colors.dark, 
      border: `1px solid var(--border-whisper)`, 
      borderRadius: 12, 
      padding: 24, 
      boxShadow: "none", 
      backdropFilter: "none" 
    },
    sectionTitleRow: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 20, flexWrap: "wrap" },
    sectionTitle: { margin: 0, fontSize: 18, fontWeight: 700, color: colors.light, fontFamily: 'var(--font-headline), Geist, sans-serif' },
    toolbarRow: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" },
    formGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 16, alignItems: "end" },
    fieldWrap: { display: "flex", flexDirection: "column", gap: 6 },
    label: { fontSize: 11, fontWeight: 600, color: colors.gray, fontFamily: 'var(--font-headline), Geist, sans-serif', textTransform: 'uppercase', letterSpacing: '0.05em' },
    input: { width: "100%", boxSizing: "border-box", padding: "10px 12px", border: `1px solid var(--border-whisper)`, borderRadius: 8, fontSize: 14, background: 'var(--surface)', color: colors.light, outline: "none", transition: "border-color 0.2s" },
    buttonPrimary: { height: 42, padding: "0 20px", border: "none", borderRadius: 8, background: `linear-gradient(135deg, var(--primary-accent) 0%, var(--primary-accent)dd 100%)`, color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer", boxShadow: "none", transition: "transform 0.15s ease" },
    buttonSecondary: { padding: "8px 14px", border: `1px solid var(--border-whisper)`, borderRadius: 6, background: 'var(--surface)', color: colors.light, fontSize: 12, fontWeight: 600, cursor: "pointer" },
    buttonDanger: { padding: "8px 14px", border: `1px solid var(--status-danger)40`, borderRadius: 6, background: `rgba(239, 68, 68, 0.08)`, color: 'var(--status-danger)', fontSize: 12, fontWeight: 700, cursor: "pointer" },
    buttonSuccess: { padding: "8px 14px", border: `1px solid var(--status-success)40`, borderRadius: 6, background: `rgba(16, 185, 129, 0.08)`, color: 'var(--status-success)', fontSize: 12, fontWeight: 700, cursor: "pointer" },
    buttonInfo: { padding: "8px 14px", border: `1px solid var(--status-info)40`, borderRadius: 6, background: `rgba(59, 85, 246, 0.08)`, color: 'var(--status-info)', fontSize: 12, fontWeight: 700, cursor: "pointer" },
    buttonSmall: { padding: "6px 12px", border: "none", borderRadius: 6, color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" },
    topStatsGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 16, marginBottom: 24 },
    statCard: { background: isDark ? 'var(--surface)' : colors.dark, border: `1px solid var(--border-whisper)`, borderRadius: 12, padding: 18, boxShadow: "none" },
    statLabel: { fontSize: 11, color: colors.gray, marginBottom: 8, fontFamily: 'var(--font-headline), Geist, sans-serif', textTransform: 'uppercase', letterSpacing: '0.05em' },
    statValue: { fontSize: 28, fontWeight: 800, color: colors.light, fontFamily: 'var(--font-mono), monospace' },
    mainGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(400px, 1fr))", gap: 24, marginTop: 4 },
    list: { display: "flex", flexDirection: "column", gap: 12 },
    deviceCard: { padding: 18, borderRadius: 8, border: `1px solid var(--border-whisper)`, background: 'var(--surface)', cursor: "pointer", transition: "all 0.2s" },
    selectedDeviceCard: { border: `1px solid var(--primary-accent)`, background: `rgba(99, 102, 241, 0.08)`, boxShadow: "none" },
    deviceName: { margin: 0, fontSize: 16, fontWeight: 700, color: colors.light, fontFamily: 'var(--font-headline), Geist, sans-serif' },
    deviceIp: { marginTop: 4, fontSize: 13, color: colors.gray, fontFamily: 'var(--font-mono), monospace' },
    metaRow: { marginTop: 12, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" },
    metaChip: { display: "inline-flex", alignItems: "center", padding: "4px 10px", borderRadius: 4, background: 'var(--surface-container)', border: `1px solid var(--border-whisper)`, fontSize: 11, fontWeight: 600, color: colors.light },
    actionRow: { display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" },
    backupCard: { padding: 18, borderRadius: 8, border: `1px solid var(--border-whisper)`, background: 'var(--surface)' },
    cardTop: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 12, flexWrap: "wrap" },
    timestamp: { fontSize: 12, color: colors.gray, whiteSpace: "nowrap", fontFamily: 'var(--font-mono), monospace' },
    codeBlock: { margin: 0, padding: 14, borderRadius: 6, background: 'var(--background-deep)', color: isDark ? "#c0c1ff" : colors.primary, fontSize: 12, lineHeight: 1.55, overflowX: "auto", maxHeight: 180, border: `1px solid var(--border-whisper)`, fontFamily: 'var(--font-mono), monospace' },
    diffBlock: { margin: 0, padding: 14, borderRadius: 6, background: 'var(--background-deep)', fontSize: 12, lineHeight: 1.55, overflowX: "auto", maxHeight: 550, border: `1px solid var(--border-whisper)`, fontFamily: 'var(--font-mono), monospace' },
    emptyState: { border: `1px dashed var(--border-whisper)`, borderRadius: 12, padding: "32px 24px", textAlign: "center", background: 'var(--surface)', color: colors.gray, fontSize: 14 },
    loadingState: { padding: "24px 20px", borderRadius: 12, background: 'var(--surface)', border: `1px solid var(--border-whisper)`, color: colors.gray, fontSize: 14, textAlign: "center" },
    errorState: { padding: "24px 20px", borderRadius: 12, background: `rgba(239, 68, 68, 0.08)`, border: `1px solid var(--status-danger)`, color: 'var(--status-danger)', fontSize: 14, textAlign: "center" },
    modalBackdrop: { position: "fixed", inset: 0, background: "rgba(2, 6, 23, 0.85)", backdropFilter: "blur(8px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, zIndex: 1000 },
    modalCard: { width: "min(1200px, 92vw)", maxHeight: "85vh", overflow: "hidden", borderRadius: 12, background: 'var(--surface)', border: `1px solid var(--border-whisper)`, boxShadow: "none", display: "flex", flexDirection: "column" },
    modalHeader: { display: "flex", alignItems: "center", justifycontent: "space-between", gap: 12, padding: "18px 24px", borderBottom: `1px solid var(--border-whisper)`, background: 'var(--background-deep)' },
    modalTitle: { margin: 0, fontSize: 16, fontWeight: 700, color: colors.light, fontFamily: 'var(--font-headline), Geist, sans-serif' },
    closeButton: { width: 34, height: 34, borderRadius: 6, border: `1px solid var(--border-whisper)`, background: 'var(--surface)', fontSize: 18, cursor: "pointer", color: colors.light },
    modalBody: { padding: 24, overflowY: "auto", flex: 1 },
    sidebar: {
      width: 260,
      background: 'var(--background)',
      borderRight: `1px solid var(--border-whisper)`,
      display: 'flex',
      flexDirection: 'column',
      padding: '24px 16px',
      height: '100vh',
      position: 'sticky',
      top: 0
    },
    navItem: {
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      padding: '12px 16px',
      borderRadius: 8,
      color: colors.gray,
      textDecoration: 'none',
      fontSize: 14,
      fontWeight: 600,
      transition: 'all 0.15s ease',
      marginBottom: 4
    },
    navItemActive: {
      background: `rgba(192, 193, 255, 0.15)`,
      color: 'var(--text-high-contrast)',
    }
  };
};

export const colors = themes.dark.colors; // Fallback
export const styles = getStyles(themes.dark); // Fallback
