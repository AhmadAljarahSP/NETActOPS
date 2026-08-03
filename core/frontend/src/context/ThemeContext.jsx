import React, { createContext, useContext, useState, useEffect } from 'react';
import defaultTheme from '../theme.json';

const ThemeContext = createContext();

export const getDefaultsForMode = (mode, primary, secondary) => {
  const isDark = mode === 'dark';
  const p = primary || (isDark ? '#00B8FF' : '#0078FF');
  const s = secondary || '#00D4AA';
  
  if (isDark) {
    return {
      primaryBg: '#1A1A1A',
      secondaryBg: '#242424',
      sidebarBg: '#161616',
      sidebarHoverBg: 'rgba(255, 255, 255, 0.05)',
      sidebarActiveBgStart: '#313131',
      sidebarActiveBgEnd: '#404040',
      sidebarActiveIndicator: p,
      sidebarActiveText: '#FFFFFF',
      sidebarInactiveText: '#A0A0A0',
      cardBg: '#232323',
      cardHoverBg: '#2B2B2B',
      textActive: '#F4F4F4',
      textMuted: '#A0A0A0',
      textInactive: '#707070',
      border: '#333333',
      success: '#00C853',
      warning: '#FFB300',
      danger: '#FF5252',
      iconColor: '#A0A0A0',
      iconActiveColor: p
    };
  } else {
    return {
      primaryBg: '#f8fafc',
      secondaryBg: '#f1f5f9',
      sidebarBg: '#ffffff',
      sidebarHoverBg: 'rgba(0, 0, 0, 0.05)',
      sidebarActiveBgStart: '#cbd5e1',
      sidebarActiveBgEnd: '#e2e8f0',
      sidebarActiveIndicator: p,
      sidebarActiveText: '#0f172a',
      sidebarInactiveText: '#475569',
      cardBg: '#ffffff',
      cardHoverBg: '#f8fafc',
      textActive: '#0f172a',
      textMuted: '#475569',
      textInactive: '#94a3b8',
      border: '#cbd5e1',
      success: '#00C853',
      warning: '#FFB300',
      danger: '#FF5252',
      iconColor: '#475569',
      iconActiveColor: p
    };
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Full Theme Presets — one-click complete palette swap
// ─────────────────────────────────────────────────────────────────────────────
export const THEME_PRESETS = [
  {
    key: 'netvault',
    name: 'NetVault Blue',
    emoji: '🔵',
    description: 'Default NOC blue',
    preview: ['#00B8FF', '#00D4AA', '#1A1A1A'],
    config: {
      mode: 'dark', primary: '#00B8FF', secondary: '#00D4AA',
      primaryBg: '#0d1117', secondaryBg: '#161b22', sidebarBg: '#0a0e14',
      cardBg: '#161b22', cardHoverBg: '#1c2128', border: '#30363d',
      textActive: '#f0f6fc', textMuted: '#8b949e', textInactive: '#6e7681',
      success: '#3fb950', warning: '#d29922', danger: '#f85149',
      sidebarActiveBgStart: '#0d2137', sidebarActiveBgEnd: '#0a3050',
      sidebarActiveIndicator: '#00B8FF', sidebarActiveText: '#ffffff',
      sidebarInactiveText: '#8b949e', iconColor: '#8b949e', iconActiveColor: '#00B8FF',
    },
  },
  {
    key: 'neon_tokyo',
    name: 'Neon Tokyo',
    emoji: '🌆',
    description: 'Cyberpunk hot pink + cyan',
    preview: ['#ff006e', '#00f5ff', '#0d0021'],
    config: {
      mode: 'dark', primary: '#ff006e', secondary: '#00f5ff',
      primaryBg: '#0d0021', secondaryBg: '#140030', sidebarBg: '#080018',
      cardBg: '#14002a', cardHoverBg: '#1c003a', border: '#3d0060',
      textActive: '#ffffff', textMuted: '#c084fc', textInactive: '#7c3aed',
      success: '#00f5a0', warning: '#ffd60a', danger: '#ff006e',
      sidebarActiveBgStart: '#2d003f', sidebarActiveBgEnd: '#1a0050',
      sidebarActiveIndicator: '#ff006e', sidebarActiveText: '#ffffff',
      sidebarInactiveText: '#a78bfa', iconColor: '#a78bfa', iconActiveColor: '#ff006e',
    },
  },
  {
    key: 'matrix',
    name: 'Matrix',
    emoji: '💚',
    description: 'Green rain on black',
    preview: ['#00e676', '#76ff03', '#001500'],
    config: {
      mode: 'dark', primary: '#00e676', secondary: '#76ff03',
      primaryBg: '#000800', secondaryBg: '#001000', sidebarBg: '#000500',
      cardBg: '#001200', cardHoverBg: '#001a00', border: '#003300',
      textActive: '#ccffcc', textMuted: '#66bb6a', textInactive: '#2e7d32',
      success: '#00e676', warning: '#ffee58', danger: '#ff1744',
      sidebarActiveBgStart: '#002200', sidebarActiveBgEnd: '#003300',
      sidebarActiveIndicator: '#00e676', sidebarActiveText: '#ccffcc',
      sidebarInactiveText: '#66bb6a', iconColor: '#388e3c', iconActiveColor: '#00e676',
    },
  },
  {
    key: 'midnight_gold',
    name: 'Midnight Gold',
    emoji: '✨',
    description: 'Obsidian with gold accents',
    preview: ['#ffd600', '#ff6f00', '#050400'],
    config: {
      mode: 'dark', primary: '#ffd600', secondary: '#ff6f00',
      primaryBg: '#050400', secondaryBg: '#0a0800', sidebarBg: '#030300',
      cardBg: '#0f0d00', cardHoverBg: '#181500', border: '#2a2400',
      textActive: '#fff8e1', textMuted: '#ffd54f', textInactive: '#f9a825',
      success: '#69f0ae', warning: '#ffd600', danger: '#ff5252',
      sidebarActiveBgStart: '#1a1400', sidebarActiveBgEnd: '#251c00',
      sidebarActiveIndicator: '#ffd600', sidebarActiveText: '#fff8e1',
      sidebarInactiveText: '#ffc107', iconColor: '#f9a825', iconActiveColor: '#ffd600',
    },
  },
  {
    key: 'arctic_ops',
    name: 'Arctic Ops',
    emoji: '❄️',
    description: 'Ice blue on deep navy',
    preview: ['#80d8ff', '#e0f7fa', '#001428'],
    config: {
      mode: 'dark', primary: '#80d8ff', secondary: '#00bcd4',
      primaryBg: '#001428', secondaryBg: '#001f38', sidebarBg: '#000e1a',
      cardBg: '#001a30', cardHoverBg: '#00253f', border: '#003d5c',
      textActive: '#e0f7fa', textMuted: '#80deea', textInactive: '#4dd0e1',
      success: '#69f0ae', warning: '#ffe57f', danger: '#ff5252',
      sidebarActiveBgStart: '#00243d', sidebarActiveBgEnd: '#002f50',
      sidebarActiveIndicator: '#80d8ff', sidebarActiveText: '#e0f7fa',
      sidebarInactiveText: '#80deea', iconColor: '#4dd0e1', iconActiveColor: '#80d8ff',
    },
  },
  {
    key: 'blood_ops',
    name: 'Blood Ops',
    emoji: '🔴',
    description: 'Emergency red alert mode',
    preview: ['#ff1744', '#ff6d00', '#130000'],
    config: {
      mode: 'dark', primary: '#ff1744', secondary: '#ff6d00',
      primaryBg: '#130000', secondaryBg: '#1a0005', sidebarBg: '#0a0000',
      cardBg: '#1f0005', cardHoverBg: '#2a0008', border: '#4a0010',
      textActive: '#ffcdd2', textMuted: '#ef9a9a', textInactive: '#e57373',
      success: '#69f0ae', warning: '#ffb300', danger: '#ff1744',
      sidebarActiveBgStart: '#2d0008', sidebarActiveBgEnd: '#3d0010',
      sidebarActiveIndicator: '#ff1744', sidebarActiveText: '#ffcdd2',
      sidebarInactiveText: '#ef9a9a', iconColor: '#e57373', iconActiveColor: '#ff1744',
    },
  },
  {
    key: 'violet_storm',
    name: 'Violet Storm',
    emoji: '⚡',
    description: 'Deep purple electric energy',
    preview: ['#d500f9', '#651fff', '#0e0018'],
    config: {
      mode: 'dark', primary: '#d500f9', secondary: '#651fff',
      primaryBg: '#0e0018', secondaryBg: '#160022', sidebarBg: '#08000f',
      cardBg: '#190028', cardHoverBg: '#220035', border: '#4a0060',
      textActive: '#f3e5f5', textMuted: '#ce93d8', textInactive: '#ab47bc',
      success: '#69f0ae', warning: '#ffd740', danger: '#ff5252',
      sidebarActiveBgStart: '#250030', sidebarActiveBgEnd: '#300040',
      sidebarActiveIndicator: '#d500f9', sidebarActiveText: '#f3e5f5',
      sidebarInactiveText: '#ce93d8', iconColor: '#ab47bc', iconActiveColor: '#d500f9',
    },
  },
  {
    key: 'solar_flare',
    name: 'Solar Flare',
    emoji: '☀️',
    description: 'Amber gold heat wave',
    preview: ['#ffca28', '#ff6f00', '#1a0e00'],
    config: {
      mode: 'dark', primary: '#ffca28', secondary: '#ff9800',
      primaryBg: '#1a0e00', secondaryBg: '#241500', sidebarBg: '#120900',
      cardBg: '#1f1200', cardHoverBg: '#2a1800', border: '#3d2800',
      textActive: '#fff8e1', textMuted: '#ffcc80', textInactive: '#ffa726',
      success: '#69f0ae', warning: '#ffca28', danger: '#ff5252',
      sidebarActiveBgStart: '#2d1e00', sidebarActiveBgEnd: '#3d2800',
      sidebarActiveIndicator: '#ffca28', sidebarActiveText: '#fff8e1',
      sidebarInactiveText: '#ffcc80', iconColor: '#ffa726', iconActiveColor: '#ffca28',
    },
  },
  {
    key: 'phantom',
    name: 'Phantom Glass',
    emoji: '👻',
    description: 'Minimal silver monochrome',
    preview: ['#b0bec5', '#eceff1', '#090910'],
    config: {
      mode: 'dark', primary: '#b0bec5', secondary: '#78909c',
      primaryBg: '#090910', secondaryBg: '#0f0f18', sidebarBg: '#060610',
      cardBg: '#111120', cardHoverBg: '#181828', border: '#2a2a3a',
      textActive: '#eceff1', textMuted: '#90a4ae', textInactive: '#607d8b',
      success: '#69f0ae', warning: '#ffe57f', danger: '#ff5252',
      sidebarActiveBgStart: '#1a1a2a', sidebarActiveBgEnd: '#222232',
      sidebarActiveIndicator: '#b0bec5', sidebarActiveText: '#eceff1',
      sidebarInactiveText: '#90a4ae', iconColor: '#607d8b', iconActiveColor: '#b0bec5',
    },
  },
  {
    key: 'galactic_mint',
    name: 'Galactic Mint',
    emoji: '🌿',
    description: 'Emerald teal bioluminescence',
    preview: ['#1de9b6', '#00bcd4', '#001510'],
    config: {
      mode: 'dark', primary: '#1de9b6', secondary: '#00bcd4',
      primaryBg: '#001510', secondaryBg: '#001f18', sidebarBg: '#000d0a',
      cardBg: '#001a14', cardHoverBg: '#00261c', border: '#004d3a',
      textActive: '#e0f2f1', textMuted: '#80cbc4', textInactive: '#4db6ac',
      success: '#1de9b6', warning: '#ffe57f', danger: '#ff5252',
      sidebarActiveBgStart: '#00251c', sidebarActiveBgEnd: '#003028',
      sidebarActiveIndicator: '#1de9b6', sidebarActiveText: '#e0f2f1',
      sidebarInactiveText: '#80cbc4', iconColor: '#4db6ac', iconActiveColor: '#1de9b6',
    },
  },
  {
    key: 'obsidian_fire',
    name: 'Obsidian Fire',
    emoji: '🌋',
    description: 'Volcanic lava on jet black',
    preview: ['#ff3d00', '#ff9100', '#0f0800'],
    config: {
      mode: 'dark', primary: '#ff3d00', secondary: '#ff9100',
      primaryBg: '#0f0800', secondaryBg: '#180c00', sidebarBg: '#0a0500',
      cardBg: '#1a0e00', cardHoverBg: '#241400', border: '#3d1a00',
      textActive: '#fbe9e7', textMuted: '#ff8a65', textInactive: '#e64a19',
      success: '#69f0ae', warning: '#ffca28', danger: '#ff3d00',
      sidebarActiveBgStart: '#2d1200', sidebarActiveBgEnd: '#3d1800',
      sidebarActiveIndicator: '#ff3d00', sidebarActiveText: '#fbe9e7',
      sidebarInactiveText: '#ff8a65', iconColor: '#e64a19', iconActiveColor: '#ff3d00',
    },
  },
  {
    key: 'noc_light',
    name: 'NOC Dayshift',
    emoji: '🌤️',
    description: 'Clean light mode for daylight',
    preview: ['#0078FF', '#00C9A7', '#f8fafc'],
    config: {
      mode: 'light', primary: '#0078FF', secondary: '#00C9A7',
      primaryBg: '#f8fafc', secondaryBg: '#f1f5f9', sidebarBg: '#ffffff',
      cardBg: '#ffffff', cardHoverBg: '#f8fafc', border: '#e2e8f0',
      textActive: '#0f172a', textMuted: '#475569', textInactive: '#94a3b8',
      success: '#059669', warning: '#d97706', danger: '#dc2626',
      sidebarActiveBgStart: '#dbeafe', sidebarActiveBgEnd: '#eff6ff',
      sidebarActiveIndicator: '#0078FF', sidebarActiveText: '#1e40af',
      sidebarInactiveText: '#64748b', iconColor: '#64748b', iconActiveColor: '#0078FF',
    },
  },
];

export const ThemeProvider = ({ children }) => {
  const [config, setConfig] = useState(() => {
    const saved = localStorage.getItem('netact_theme_config');
    if (saved) {
      try {
        return { ...defaultTheme, ...JSON.parse(saved) };
      } catch (e) {
        return defaultTheme;
      }
    }
    return defaultTheme;
  });

  const updateConfig = (newKeys) => {
    setConfig(prev => {
      let next = { ...prev, ...newKeys };
      
      // If mode changed, update the individual colors to match the mode's defaults
      if (newKeys.mode && newKeys.mode !== prev.mode) {
        const defaults = getDefaultsForMode(newKeys.mode, next.primary, next.secondary);
        next = { ...next, ...defaults };
      }
      
      // If primary accent color changed, update active indicator and active icon color
      if (newKeys.primary && newKeys.primary !== prev.primary) {
        next.sidebarActiveIndicator = newKeys.primary;
        next.iconActiveColor = newKeys.primary;
      }
      
      localStorage.setItem('netact_theme_config', JSON.stringify(next));
      return next;
    });
  };

  useEffect(() => {
    const isDark = config.mode === 'dark';
    const defaults = getDefaultsForMode(config.mode, config.primary, config.secondary);
    
    // Resolve theme colors based on config or defaults
    const colors = {
      backgroundDeep: config.primaryBg || defaults.primaryBg,
      background: config.sidebarBg || defaults.sidebarBg,
      surface: config.glassEffect 
        ? `${config.cardBg || defaults.cardBg}cc`
        : (config.cardBg || defaults.cardBg),
      surfaceSolid: config.cardBg || defaults.cardBg,
      surfaceContainer: config.secondaryBg || defaults.secondaryBg,
      surfaceContainerHigh: config.cardHoverBg || defaults.cardHoverBg,
      surfaceContainerHighest: config.cardHoverBg || defaults.cardHoverBg,
      surfaceContainerLowest: config.sidebarBg || defaults.sidebarBg,
      borderWhisper: config.border || defaults.border,
      borderMuted: config.border || defaults.border,
      primary: config.primary || defaults.sidebarActiveIndicator,
      secondary: config.secondary || defaults.secondary,
      textHighContrast: config.textActive || defaults.textActive,
      textMuted: config.textMuted || defaults.textMuted,
      textInactive: config.textInactive || defaults.textInactive,
      statusSuccess: config.success || defaults.success,
      statusWarning: config.warning || defaults.warning,
      statusDanger: config.danger || defaults.danger,
      statusInfo: config.primary || defaults.sidebarActiveIndicator,
    };

    // Apply document properties
    document.body.style.background = colors.backgroundDeep;
    document.body.style.color = colors.textMuted;
    
    // Inject CSS variables
    const root = document.documentElement;
    root.style.setProperty('--background-deep', colors.backgroundDeep);
    root.style.setProperty('--background', colors.background);
    root.style.setProperty('--surface', colors.surface);
    root.style.setProperty('--surface-solid', colors.surfaceSolid);
    root.style.setProperty('--surface-container', colors.surfaceContainer);
    root.style.setProperty('--surface-container-high', colors.surfaceContainerHigh);
    root.style.setProperty('--surface-container-highest', colors.surfaceContainerHighest);
    root.style.setProperty('--surface-container-lowest', colors.surfaceContainerLowest);
    root.style.setProperty('--border-whisper', colors.borderWhisper);
    root.style.setProperty('--border-muted', colors.borderMuted);
    root.style.setProperty('--primary', colors.primary);
    root.style.setProperty('--primary-accent', colors.primary);
    root.style.setProperty('--primary-glow', `${colors.primary}35`);
    root.style.setProperty('--text-high-contrast', colors.textHighContrast);
    root.style.setProperty('--text-muted', colors.textMuted);
    root.style.setProperty('--text-inactive', colors.textInactive);
    root.style.setProperty('--status-success', colors.statusSuccess);
    root.style.setProperty('--status-warning', colors.statusWarning);
    root.style.setProperty('--status-danger', colors.statusDanger);
    root.style.setProperty('--status-info', colors.statusInfo);

    // Sidebar dimensions
    root.style.setProperty('--sidebar-width', `${config.sidebarWidth || 280}px`);

    // Border Radius mapping
    const r = config.borderRadius !== undefined ? config.borderRadius : 12;
    root.style.setProperty('--border-radius-base', `${r}px`);
    root.style.setProperty('--border-radius-lg', `${r}px`);
    root.style.setProperty('--border-radius-md', `${Math.round(r * 0.75)}px`);
    root.style.setProperty('--border-radius-sm', `${Math.round(r * 0.5)}px`);

    // Font mapping
    let fontFamilyValue = 'Geist, -apple-system, sans-serif';
    if (config.fontFamily === 'Satoshi') {
      fontFamilyValue = 'Satoshi, -apple-system, sans-serif';
    } else if (config.fontFamily === 'JetBrains Mono') {
      fontFamilyValue = '"JetBrains Mono", monospace';
    } else if (config.fontFamily === 'Inter') {
      fontFamilyValue = 'Inter, -apple-system, sans-serif';
    }
    root.style.setProperty('--font-headline', fontFamilyValue);
    root.style.setProperty('--font-body', fontFamilyValue);

    // Spacing (Compact mode)
    if (config.compact) {
      root.style.setProperty('--spacing-gutter', '8px');
      root.style.setProperty('--spacing-margin', '12px');
      root.style.setProperty('--spacing-stack-default', '8px');
      root.style.setProperty('--spacing-stack-compact', '4px');
    } else {
      root.style.setProperty('--spacing-gutter', '16px');
      root.style.setProperty('--spacing-margin', '24px');
      root.style.setProperty('--spacing-stack-default', '16px');
      root.style.setProperty('--spacing-stack-compact', '8px');
    }

    // Animation speeds
    let duration = '0.25s';
    if (config.animationSpeed === 'fast') duration = '0.1s';
    if (config.animationSpeed === 'slow') duration = '0.5s';
    root.style.setProperty('--transition-duration', duration);
    root.style.setProperty('--transition-smooth', `all ${duration} cubic-bezier(0.16, 1, 0.3, 1)`);

    // Font size scaling
    let sizeScale = '14px';
    if (config.fontSize === 'small') sizeScale = '12px';
    if (config.fontSize === 'large') sizeScale = '16px';
    root.style.setProperty('--font-size-base', sizeScale);

    // Sidebar & Icon specific color variables injection
    root.style.setProperty('--sidebar-active-bg-start', config.sidebarActiveBgStart || defaults.sidebarActiveBgStart);
    root.style.setProperty('--sidebar-active-bg-end', config.sidebarActiveBgEnd || defaults.sidebarActiveBgEnd);
    root.style.setProperty('--sidebar-hover-bg', config.sidebarHoverBg || defaults.sidebarHoverBg);
    root.style.setProperty('--sidebar-active-indicator', config.sidebarActiveIndicator || defaults.sidebarActiveIndicator);
    root.style.setProperty('--sidebar-active-text', config.sidebarActiveText || defaults.sidebarActiveText);
    root.style.setProperty('--sidebar-inactive-text', config.sidebarInactiveText || defaults.sidebarInactiveText);
    root.style.setProperty('--icon-color', config.iconColor || defaults.iconColor);
    root.style.setProperty('--icon-active-color', config.iconActiveColor || defaults.iconActiveColor);
  }, [config]);

  const styles = React.useMemo(() => {
    return {
      page: {
        minHeight: "100vh",
        background: 'var(--background-deep)',
        fontFamily: 'var(--font-body), Geist, sans-serif',
        color: 'var(--text-muted)',
        padding: config.compact ? "12px 16px" : "32px 40px",
        transition: "background var(--transition-duration), color var(--transition-duration)"
      },
      container: { maxWidth: 1400, margin: "0 auto" },
      header: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
        marginBottom: config.compact ? 12 : 24,
        padding: config.compact ? "8px 16px" : "16px 24px",
        borderRadius: "var(--border-radius-md)",
        background: 'var(--surface)',
        border: `1px solid var(--border-whisper)`
      },
      title: { margin: 0, fontSize: config.fontSize === 'large' ? 28 : 24, fontWeight: 700, letterSpacing: -0.5, color: 'var(--text-high-contrast)', fontFamily: 'var(--font-headline), Geist, sans-serif' },
      subtitle: { margin: "4px 0 0", fontSize: config.fontSize === 'large' ? 14 : 12, color: 'var(--text-muted)', fontFamily: 'var(--font-body), Satoshi, sans-serif' },
      panel: { 
        background: 'var(--surface)', 
        border: `1px solid var(--border-whisper)`, 
        borderRadius: "var(--border-radius-lg)", 
        padding: config.compact ? 16 : 24,
        backdropFilter: config.glassEffect ? "blur(12px)" : "none",
        WebkitBackdropFilter: config.glassEffect ? "blur(12px)" : "none"
      },
      label: { fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', fontFamily: 'var(--font-headline), Geist, sans-serif', textTransform: 'uppercase', letterSpacing: '0.05em' },
      input: { width: "100%", boxSizing: "border-box", padding: "10px 12px", border: `1px solid var(--border-whisper)`, borderRadius: "var(--border-radius-sm)", fontSize: 14, background: 'var(--surface-solid)', color: 'var(--text-high-contrast)', outline: "none" },
      buttonPrimary: { height: 42, padding: "0 20px", border: "none", borderRadius: "var(--border-radius-sm)", background: `linear-gradient(135deg, var(--primary) 0%, var(--primary)dd 100%)`, color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer" },
      buttonSecondary: { padding: "8px 14px", border: `1px solid var(--border-whisper)`, borderRadius: "var(--border-radius-sm)", background: 'var(--surface)', color: 'var(--text-high-contrast)', fontSize: 12, fontWeight: 600, cursor: "pointer" },
      buttonDanger: { padding: "8px 14px", border: `1px solid var(--status-danger)40`, borderRadius: "var(--border-radius-sm)", background: `rgba(255, 82, 82, 0.08)`, color: 'var(--status-danger)', fontSize: 12, fontWeight: 700, cursor: "pointer" },
      buttonSuccess: { padding: "8px 14px", border: `1px solid var(--status-success)40`, borderRadius: "var(--border-radius-sm)", background: `rgba(0, 200, 83, 0.08)`, color: 'var(--status-success)', fontSize: 12, fontWeight: 700, cursor: "pointer" },
      sidebar: {
        width: config.sidebarWidth || 280,
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
        borderRadius: "var(--border-radius-md)",
        color: 'var(--sidebar-inactive-text)',
        textDecoration: 'none',
        fontSize: 14,
        fontWeight: 600,
        transition: 'var(--transition-smooth)',
        marginBottom: 4
      },
      navItemActive: {
        background: `linear-gradient(90deg, var(--sidebar-active-bg-start) 0%, var(--sidebar-active-bg-end) 100%)`,
        color: 'var(--sidebar-active-text)',
        borderLeft: `4px solid var(--sidebar-active-indicator)`,
        borderRadius: "var(--border-radius-md)"
      },
      modalBackdrop: {
        position: "fixed",
        inset: 0,
        background: "rgba(2, 6, 23, 0.85)",
        backdropFilter: "blur(8px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        zIndex: 1000
      },
      modalCard: {
        width: "min(1200px, 92vw)",
        maxHeight: "85vh",
        overflow: "hidden",
        borderRadius: "var(--border-radius-lg)",
        background: 'var(--surface-solid)',
        border: `1px solid var(--border-whisper)`,
        boxShadow: "0 20px 25px -5px rgba(0,0,0,0.3), 0 10px 10px -5px rgba(0,0,0,0.3)",
        display: "flex",
        flexDirection: "column"
      },
      modalHeader: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        padding: "18px 24px",
        borderBottom: `1px solid var(--border-whisper)`,
        background: 'var(--background-deep)'
      },
      modalTitle: {
        margin: 0,
        fontSize: 16,
        fontWeight: 700,
        color: 'var(--text-high-contrast)',
        fontFamily: 'var(--font-headline), Geist, sans-serif'
      },
      closeButton: {
        width: 34,
        height: 34,
        borderRadius: "var(--border-radius-sm)",
        border: `1px solid var(--border-whisper)`,
        background: 'var(--surface)',
        fontSize: 18,
        cursor: "pointer",
        color: 'var(--text-high-contrast)',
        display: "flex",
        alignItems: "center",
        justifyContent: "center"
      },
      modalBody: {
        padding: 24,
        overflowY: "auto",
        flex: 1
      },
      codeBlock: {
        margin: 0,
        padding: 14,
        borderRadius: "var(--border-radius-sm)",
        background: 'var(--background-deep)',
        color: 'var(--primary-accent)',
        fontSize: 12,
        lineHeight: 1.55,
        overflowX: "auto",
        maxHeight: 180,
        border: `1px solid var(--border-whisper)`,
        fontFamily: 'var(--font-mono), monospace'
      },
      diffBlock: {
        margin: 0,
        padding: 14,
        borderRadius: "var(--border-radius-sm)",
        background: 'var(--background-deep)',
        fontSize: 12,
        lineHeight: 1.55,
        overflowX: "auto",
        maxHeight: 550,
        border: `1px solid var(--border-whisper)`,
        fontFamily: 'var(--font-mono), monospace'
      },
      deviceCard: { padding: 18, borderRadius: "var(--border-radius-md)", border: `1px solid var(--border-whisper)`, background: 'var(--surface)', cursor: "pointer", transition: "all 0.2s" },
      selectedDeviceCard: { border: `1px solid var(--primary-accent)`, background: `var(--primary-glow)`, boxShadow: "none" },
      deviceName: { margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--text-high-contrast)', fontFamily: 'var(--font-headline), Geist, sans-serif' },
      deviceIp: { marginTop: 4, fontSize: 13, color: 'var(--text-muted)', fontFamily: 'var(--font-mono), monospace' },
      metaRow: { marginTop: 12, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" },
      metaChip: { display: "inline-flex", alignItems: "center", padding: "4px 10px", borderRadius: "var(--border-radius-sm)", background: 'var(--surface-container)', border: `1px solid var(--border-whisper)`, fontSize: 11, fontWeight: 600, color: 'var(--text-high-contrast)' },
      actionRow: { display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" },
      backupCard: { padding: 18, borderRadius: "var(--border-radius-md)", border: `1px solid var(--border-whisper)`, background: 'var(--surface)' },
      cardTop: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 12, flexWrap: "wrap" },
      timestamp: { fontSize: 12, color: 'var(--text-muted)', whiteSpace: "nowrap", fontFamily: 'var(--font-mono), monospace' },
      emptyState: { border: `1px dashed var(--border-whisper)`, borderRadius: "var(--border-radius-lg)", padding: "32px 24px", textAlign: "center", background: 'var(--surface)', color: 'var(--text-muted)', fontSize: 14 },
      loadingState: { padding: "24px 20px", borderRadius: "var(--border-radius-lg)", background: 'var(--surface)', border: `1px solid var(--border-whisper)`, color: 'var(--text-muted)', fontSize: 14, textAlign: "center" },
      errorState: { padding: "24px 20px", borderRadius: "var(--border-radius-lg)", background: `rgba(255, 82, 82, 0.08)`, border: `1px solid var(--status-danger)`, color: 'var(--status-danger)', fontSize: 14, textAlign: "center" },
      topStatsGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 16, marginBottom: 24 },
      statCard: { background: 'var(--surface)', border: `1px solid var(--border-whisper)`, borderRadius: "var(--border-radius-lg)", padding: 18, boxShadow: "none" },
      statLabel: { fontSize: 11, color: 'var(--text-muted)', marginBottom: 8, fontFamily: 'var(--font-headline), Geist, sans-serif', textTransform: 'uppercase', letterSpacing: '0.05em' },
      statValue: { fontSize: 28, fontWeight: 800, color: 'var(--text-high-contrast)', fontFamily: 'var(--font-mono), monospace' },
      mainGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(400px, 1fr))", gap: 24, marginTop: 4 },
      list: { display: "flex", flexDirection: "column", gap: 12 },
      sectionTitleRow: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 20, flexWrap: "wrap" },
      sectionTitle: { margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--text-high-contrast)', fontFamily: 'var(--font-headline), Geist, sans-serif' },
      toolbarRow: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" },
      formGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 16, alignItems: "end" },
      fieldWrap: { display: "flex", flexDirection: "column", gap: 6 },
      statPill: { padding: "8px 14px", borderRadius: "var(--border-radius-sm)", background: 'var(--surface-container)', border: `1px solid var(--border-whisper)`, fontSize: 12, fontWeight: 700, color: 'var(--text-high-contrast)', whiteSpace: "nowrap", fontFamily: 'var(--font-mono), monospace' },
      logoBox: {
        width: 48, height: 48, borderRadius: "var(--border-radius-sm)",
        background: "none",
        display: "flex", alignItems: "center", justifyContent: "center",
        flexShrink: 0,
      },
      headerLeft: { display: "flex", alignItems: "center", gap: 14 }
    };
  }, [config]);

  const theme = React.useMemo(() => {
    const defaults = getDefaultsForMode(config.mode, config.primary, config.secondary);
    return {
      colors: {
        primary: config.primary || defaults.sidebarActiveIndicator,
        secondary: config.secondary || defaults.secondary,
        info: config.primary || defaults.sidebarActiveIndicator,
        success: config.success || defaults.success,
        warning: config.warning || defaults.warning,
        danger: config.danger || defaults.danger,
        gray: config.textMuted || defaults.textMuted,
        light: config.textActive || defaults.textActive,
        // dark/darker/border don't have a corresponding *ThemeContext*
        // config field of their own — several pages (Automation.jsx,
        // Header.jsx, Layout.jsx, Backups.jsx, Healthcheck.jsx, and more)
        // have referenced colors.dark/darker/border for a long time
        // assuming they existed. They didn't: theme.colors never had
        // these keys, so every one of those style objects silently
        // evaluated background/border to `undefined` and fell back to
        // whatever the surrounding element already had — usually fine,
        // but for elements explicitly styled "light text on colors.dark"
        // (e.g. Automation.jsx's inactive tab buttons), a light-mode /
        // custom-accent theme can turn that into invisible light-on-light
        // text. These three mirror the exact same config/defaults fields
        // already used for the CSS custom properties above (backgroundDeep,
        // surfaceContainer, borderWhisper) so they stay real theme values,
        // not hardcoded hex, and respond to Settings changes correctly.
        dark: config.secondaryBg || defaults.secondaryBg,
        darker: config.primaryBg || defaults.primaryBg,
        border: config.border || defaults.border
      }
    };
  }, [config]);

  return (
    <ThemeContext.Provider value={{ config, updateConfig, styles, theme }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used within a ThemeProvider');
  return context;
};

