import React from 'react';
import { NavLink } from 'react-router-dom';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import logo from '../logo.png';


export default function Sidebar() {
  const { styles, config } = useTheme();
  const { user, logout, isAdmin, isViewer } = useAuth();
  const [isCollapsed, setIsCollapsed] = React.useState(() => {
    return localStorage.getItem('netact_sidebar_collapsed') === 'true';
  });

  const toggleSidebar = () => {
    setIsCollapsed(prev => {
      const next = !prev;
      localStorage.setItem('netact_sidebar_collapsed', String(next));
      return next;
    });
  };

  const navItem = ({ isActive }) => ({
    ...styles.navItem,
    justifyContent: isCollapsed ? 'center' : 'flex-start',
    padding: isCollapsed ? '12px 0' : '12px 16px',
    ...(isActive ? styles.navItemActive : {})
  });

  const sidebarStyle = {
    ...styles.sidebar,
    width: isCollapsed ? 78 : (config.sidebarWidth || 280),
    transition: 'width 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
    position: 'relative',
    padding: isCollapsed ? '24px 8px' : '24px 16px',
  };

  return (
    <div style={sidebarStyle}>
      {/* Toggle Button */}
      <button 
        onClick={toggleSidebar} 
        style={{
          position: 'absolute',
          top: 24,
          right: -12,
          width: 24,
          height: 24,
          borderRadius: '50%',
          border: '1px solid var(--border-whisper)',
          background: 'var(--background)',
          color: 'var(--text-high-contrast)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          zIndex: 100,
          boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
          fontSize: 10,
          outline: 'none',
          transition: 'all 0.2s ease'
        }}
        title={isCollapsed ? "Expand Sidebar" : "Collapse Sidebar"}
      >
        {isCollapsed ? '❯' : '❮'}
      </button>

      {/* Header / Logo */}
      <div style={{ marginBottom: 32, padding: '0 8px', textAlign: 'center', overflow: 'hidden' }}>
        {isCollapsed ? (
          <div>
            <h2 style={{ ...styles.title, fontSize: 22, letterSpacing: -1, margin: 0 }}>
              <span style={{ color: 'var(--sidebar-active-indicator)' }}>N</span>
            </h2>
            <p style={{ ...styles.subtitle, fontSize: 8, margin: '2px 0 0' }}>Act</p>
          </div>
        ) : (
          <div>
            <h2 style={{ ...styles.title, fontSize: 28, letterSpacing: -1 }}>
              NET<span style={{ color: 'var(--sidebar-active-indicator)' }}>Act</span>
            </h2>
            <p style={styles.subtitle}>Network Operations</p>
            <img src={logo} alt="NETAct Logo" style={{ width: 80, height: 'auto', marginTop: 12, opacity: 0.8 }} />
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <NavLink to="/" className="sidebar-nav-link" style={navItem} title={isCollapsed ? "Dashboard" : undefined}>
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>dashboard</span>
          {!isCollapsed && <span style={{ marginLeft: 12 }}>Dashboard</span>}
        </NavLink>
        <NavLink to="/main-dashboard" className="sidebar-nav-link" style={navItem} title={isCollapsed ? "AI Models Monitoring — Ollama + Gemini" : undefined}>
          <span className="material-symbols-outlined" style={{ fontSize: 18, color: '#38bdf8' }}>insights</span>
          {!isCollapsed && <span style={{ marginLeft: 12 }}>AI Models Monitoring</span>}
        </NavLink>
        <NavLink to="/inventory" className="sidebar-nav-link" style={navItem} title={isCollapsed ? "Inventory" : undefined}>
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>inventory_2</span>
          {!isCollapsed && <span style={{ marginLeft: 12 }}>Inventory</span>}
        </NavLink>
        <NavLink to="/healthcheck" className="sidebar-nav-link" style={navItem} title={isCollapsed ? "Healthcheck" : undefined}>
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>health_metrics</span>
          {!isCollapsed && <span style={{ marginLeft: 12 }}>Healthcheck</span>}
        </NavLink>
        <NavLink to="/automation" className="sidebar-nav-link" style={navItem} title={isCollapsed ? "Automation" : undefined}>
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>bolt</span>
          {!isCollapsed && <span style={{ marginLeft: 12 }}>Automation</span>}
        </NavLink>
        <NavLink to="/topology" className="sidebar-nav-link" style={navItem} title={isCollapsed ? "Topology" : undefined}>
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>hub</span>
          {!isCollapsed && <span style={{ marginLeft: 12 }}>Topology</span>}
        </NavLink>
        <NavLink to="/ai-assistant" className="sidebar-nav-link" style={navItem} title={isCollapsed ? "AI Assistant Copilot" : undefined}>
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>smart_toy</span>
          {!isCollapsed && <span style={{ marginLeft: 12 }}>AI Assistant Copilot</span>}
        </NavLink>
        <NavLink to="/backup" className="sidebar-nav-link" style={navItem} title={isCollapsed ? "Backups" : undefined}>
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>backup</span>
          {!isCollapsed && <span style={{ marginLeft: 12 }}>Backups</span>}
        </NavLink>
        
        {!isViewer && !isCollapsed && (
          <div style={{ textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: 10, color: styles.subtitle.color, fontWeight: 700, paddingLeft: 16, marginTop: 12, marginBottom: 4 }}>System</div>
        )}
        
        {!isViewer && (
          <>
            <NavLink to="/import" className="sidebar-nav-link" style={navItem} title={isCollapsed ? "Imports" : undefined}>
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>download</span>
              {!isCollapsed && <span style={{ marginLeft: 12 }}>Imports</span>}
            </NavLink>
            <NavLink to="/eoleos" className="sidebar-nav-link" style={navItem} title={isCollapsed ? "EOL & EOS" : undefined}>
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>calendar_month</span>
              {!isCollapsed && <span style={{ marginLeft: 12 }}>EOL & EOS</span>}
            </NavLink>
          </>
        )}
        
        {isAdmin && (
          <>
            <NavLink to="/settings/mcp" className="sidebar-nav-link" style={navItem} title={isCollapsed ? "MCP Manager" : undefined}>
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>settings_input_component</span>
              {!isCollapsed && <span style={{ marginLeft: 12 }}>MCP Manager</span>}
            </NavLink>
            <NavLink to="/admin" className="sidebar-nav-link" style={navItem} title={isCollapsed ? "Settings" : undefined}>
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>settings</span>
              {!isCollapsed && <span style={{ marginLeft: 12 }}>Settings</span>}
            </NavLink>
            <NavLink to="/notifications" className="sidebar-nav-link" style={navItem} title={isCollapsed ? "Notification Gateways" : undefined}>
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>notifications_active</span>
              {!isCollapsed && <span style={{ marginLeft: 12 }}>Notifications</span>}
            </NavLink>
          </>
        )}

        <button 
          onClick={() => window.dispatchEvent(new CustomEvent('netact-open-help'))}
          className="sidebar-nav-link" 
          style={{ ...navItem({ isActive: false }), border: 'none', background: 'transparent', cursor: 'pointer', width: '100%', textAlign: 'left' }} 
          title={isCollapsed ? "Help & Documentation" : undefined}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 18, color: 'var(--sidebar-active-indicator, #00adb5)' }}>help_outline</span>
          {!isCollapsed && <span style={{ marginLeft: 12, color: 'var(--sidebar-active-indicator, #00adb5)', fontWeight: 600 }}>Help & Docs</span>}
        </button>
      </nav>

      {/* Footer / Logout */}
      <div style={{ marginTop: 'auto', paddingTop: 20, borderTop: `1px solid ${styles.navItem.color}20` }}>
        {!isCollapsed && (
          <div style={{ padding: '0 8px', marginBottom: 16 }}>
            <div style={{ fontSize: 10, color: styles.subtitle.color, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Logged in as</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: styles.title.color, whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>{user?.username}</div>
            <div style={{ fontSize: 10, color: styles.navItemActive.color, textTransform: 'uppercase', fontWeight: 800, marginTop: 2 }}>{user?.role}</div>
          </div>
        )}
        <button 
          onClick={logout}
          style={{ 
            ...styles.buttonSecondary, 
            width: '100%', 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center', 
            gap: isCollapsed ? 0 : 8,
            padding: '10px 0',
            border: isCollapsed ? 'none' : `1px solid var(--border-whisper)`
          }}
          title={isCollapsed ? "Logout" : undefined}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>logout</span> {!isCollapsed && "Logout"}
        </button>
      </div>
    </div>
  );
}
