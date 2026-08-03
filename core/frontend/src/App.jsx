import React, { useState, useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from "react-router-dom";
import Sidebar from "./components/Sidebar";
import CopilotWidget from "./components/CopilotWidget";
import { ThemeProvider, useTheme } from "./context/ThemeContext";
import { AuthProvider, useAuth } from "./context/AuthContext";
import logo from "./logo.png";

// Lazy-loaded page components for bundle optimization
const Dashboard = React.lazy(() => import("./pages/Dashboard"));
const MainDashboard = React.lazy(() => import("./pages/MainDashboard"));
const Devices = React.lazy(() => import("./pages/Devices"));
const Healthcheck = React.lazy(() => import("./pages/Healthcheck"));
const Backups = React.lazy(() => import("./pages/Backups"));
const DeviceBackups = React.lazy(() => import("./pages/DeviceBackups"));
const DeviceHealthchecks = React.lazy(() => import("./pages/DeviceHealthchecks"));
const Settings = React.lazy(() => import("./pages/Settings"));
const Imports = React.lazy(() => import("./pages/Imports"));
const EolEos = React.lazy(() => import("./pages/EolEos"));
const Topology = React.lazy(() => import("./pages/Topology"));
const AiAssistant = React.lazy(() => import("./pages/AiAssistant"));
const Automation = React.lazy(() => import("./pages/Automation"));
const McpSettings = React.lazy(() => import("./pages/McpSettings"));

import HelpModal from "./components/HelpModal";

function PageLoader() {
  const { theme } = useTheme();
  const colors = theme?.colors || { primary: "#00adb5", gray: "#393e46" };
  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      justifyContent: "center",
      alignItems: "center",
      height: "calc(100vh - 100px)",
      color: colors.gray,
      gap: 16
    }}>
      <div style={{
        width: 36,
        height: 36,
        border: `3px solid ${colors.primary}20`,
        borderTopColor: colors.primary,
        borderRadius: "50%",
        animation: "spin 1s linear infinite"
      }} />
      <span style={{ fontSize: 13, fontWeight: 500, letterSpacing: "0.5px" }}>Loading page...</span>
    </div>
  );
}

function AppContent() {
  const { styles, theme } = useTheme();
  const colors = theme?.colors || { primary: "#00adb5", gray: "#393e46", success: "#10b981", danger: "#ef4444" };
  const { user, login, users } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const isFirstRun = users.length === 0;
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState([]);
  const [isHelpOpen, setIsHelpOpen] = useState(false);

  useEffect(() => {
    const handleOpenHelp = () => setIsHelpOpen(true);
    window.addEventListener('netact-open-help', handleOpenHelp);
    return () => window.removeEventListener('netact-open-help', handleOpenHelp);
  }, []);

  useEffect(() => {
    const handleNotification = (e) => {
      const enabled = localStorage.getItem('netact_notifications_enabled') !== 'false';
      if (!enabled) return;

      const { id, type, status, title, message, targetUrl } = e.detail;
      const newNotification = {
        id: id || Date.now() + Math.random(),
        type,
        status,
        title,
        message,
        targetUrl
      };

      setNotifications(prev => [...prev, newNotification]);

      setTimeout(() => {
        setNotifications(prev => prev.filter(n => n.id !== newNotification.id));
      }, 8000);
    };

    window.addEventListener('netact-notification', handleNotification);
    return () => window.removeEventListener('netact-notification', handleNotification);
  }, []);

  const handleLogin = (e) => {
    e.preventDefault();
    const result = login(username, password);
    if (!result.success) {
      setError(result.message);
    }
  };

  if (!user) {
    return (
      <div style={styles.page}>
        <div style={{ ...styles.modalCard, width: 400, margin: "100px auto", padding: 32 }}>
          <div style={{ textAlign: 'center', marginBottom: 24 }}>
            <img src={logo} alt="NETAct Logo" style={{ width: 120, height: 'auto', marginBottom: 16 }} />
            <h2 style={styles.title}>NETAct Login</h2>
            <p style={styles.subtitle}>{isFirstRun ? "Create your admin account" : "Please enter your credentials"}</p>
          </div>
          <form onSubmit={handleLogin} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={styles.fieldWrap}>
              <label style={styles.label}>{isFirstRun ? "Choose a username" : "Username"}</label>
              <input
                type="text"
                placeholder="Username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                style={styles.input}
              />
            </div>
            <div style={styles.fieldWrap}>
              <label style={styles.label}>{isFirstRun ? "Choose a password" : "Password"}</label>
              <input
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={styles.input}
              />
            </div>
            {error && <div style={styles.errorState}>{error}</div>}
            <button type="submit" style={{ ...styles.buttonPrimary, marginTop: 12 }}>
              {isFirstRun ? "Create Account & Sign In" : "Sign In"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div style={{ ...styles.page, padding: 0, display: "flex", position: "relative" }}>
      <Sidebar />
      <div style={{ flex: 1, height: "100vh", overflowY: "auto", padding: "32px 40px" }}>
        <React.Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/main-dashboard" element={<MainDashboard />} />
            <Route path="/inventory" element={<Devices />} />
            <Route path="/healthcheck" element={<Healthcheck />} />
            <Route path="/automation" element={<Automation />} />
            <Route path="/topology" element={<Topology />} />
            <Route path="/ai-assistant" element={<AiAssistant />} />
            <Route path="/backup" element={<Backups />} />
            <Route path="/settings/mcp" element={<McpSettings />} />
            <Route path="/admin" element={<Settings />} />
            <Route path="/import" element={<Imports />} />
            <Route path="/eoleos" element={<EolEos />} />
            <Route path="/backup/device/:id" element={<DeviceBackups />} />
            <Route path="/healthcheck/device/:id" element={<DeviceHealthchecks />} />
            <Route path="*" element={<Navigate to="/" />} />
          </Routes>
        </React.Suspense>
      </div>
      <CopilotWidget />

      {/* Floating Notifications Container */}
      <div style={{
        position: 'fixed',
        right: 24,
        bottom: 24,
        zIndex: 99999,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        maxWidth: 360,
        width: '100%',
        pointerEvents: 'none'
      }}>
        {notifications.map(n => (
          <div 
            key={n.id} 
            onClick={() => {
              if (n.targetUrl) {
                navigate(n.targetUrl);
              }
              setNotifications(prev => prev.filter(item => item.id !== n.id));
            }}
            style={{
              pointerEvents: 'auto',
              background: styles.panel?.background || '#0f172a',
              border: `1.5px solid ${n.status === 'success' ? (colors.success || '#10b981') : (colors.danger || '#ef4444')}`,
              borderRadius: 12,
              padding: '16px',
              boxShadow: '0 10px 25px rgba(0,0,0,0.3)',
              cursor: n.targetUrl ? 'pointer' : 'default',
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              position: 'relative',
              animation: 'slideIn 0.3s ease-out'
            }}
          >
            <button 
              onClick={(e) => {
                e.stopPropagation();
                setNotifications(prev => prev.filter(item => item.id !== n.id));
              }}
              style={{
                position: 'absolute',
                top: 8,
                right: 8,
                background: 'none',
                border: 'none',
                color: colors.gray || '#94a3b8',
                fontSize: 18,
                cursor: 'pointer',
                padding: '4px',
                lineHeight: 1
              }}
            >
              ×
            </button>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, color: colors.light || '#f8fafc', fontSize: 14 }}>
              <span>{n.type === 'backup' ? '💾' : n.type === 'healthcheck' ? '🩺' : '🤖'}</span>
              <span>{n.title}</span>
              <span style={{ 
                fontSize: 10, 
                padding: '2px 6px', 
                borderRadius: 4, 
                background: n.status === 'success' ? `${colors.success || '#10b981'}20` : `${colors.danger || '#ef4444'}20`,
                color: n.status === 'success' ? (colors.success || '#10b981') : (colors.danger || '#ef4444'),
                marginLeft: 'auto',
                marginRight: 16,
                textTransform: 'uppercase',
                fontWeight: 800
              }}>
                {n.status}
              </span>
            </div>
            <div style={{ fontSize: 12, color: colors.gray || '#94a3b8', lineHeight: 1.4, paddingRight: 16, marginTop: 4 }}>
              {n.message}
            </div>
            {n.targetUrl && (
              <div style={{ fontSize: 10, color: colors.primary || '#00adb5', fontWeight: 600, marginTop: 4, textDecoration: 'underline' }}>
                Click to view details
              </div>
            )}
          </div>
        ))}
      </div>

      <HelpModal isOpen={isHelpOpen} onClose={() => setIsHelpOpen(false)} />
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ThemeProvider>
          <AppContent />
        </ThemeProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}