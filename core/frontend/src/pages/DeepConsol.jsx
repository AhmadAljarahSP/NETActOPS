import React, { useState, useEffect } from "react";
import { useTheme } from "../context/ThemeContext";

export default function DeepConsol() {
  const { theme } = useTheme();
  const [isFullscreen, setIsFullscreen] = useState(false);
  const colors = theme?.colors || { primary: "#00adb5", gray: "#393e46" };

  // Dynamically resolve hostname
  const targetUrl = `https://${window.location.hostname}:3500/`;

  // Bind Escape key to exit fullscreen
  useEffect(() => {
    if (!isFullscreen) return;
    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        setIsFullscreen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isFullscreen]);

  // Adjust container styling based on fullscreen state
  const containerStyle = isFullscreen
    ? {
        position: "fixed",
        top: 0,
        left: 0,
        width: "100vw",
        height: "100vh",
        zIndex: 9999,
        display: "flex",
        flexDirection: "column",
        background: "#090d16", // Deep ink background matching the theme
        padding: "16px",
      }
    : {
        width: "100%",
        height: "calc(100vh - 120px)",
        display: "flex",
        flexDirection: "column",
      };

  return (
    <div style={containerStyle}>
      <div style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: "12px",
        padding: "0 4px",
      }}>
        <h3 style={{
          margin: 0,
          fontSize: "15px",
          fontWeight: 600,
          color: colors.primary,
          display: "flex",
          alignItems: "center",
          gap: "8px",
          letterSpacing: "0.2px",
        }}>
          🛡️ DeepConsol Secure Console
        </h3>
        <button
          onClick={() => setIsFullscreen(!isFullscreen)}
          style={{
            background: colors.primary,
            color: "#ffffff",
            border: "none",
            borderRadius: "6px",
            padding: "6px 12px",
            fontSize: "12px",
            fontWeight: 600,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: "6px",
            boxShadow: "0 2px 8px rgba(0, 173, 181, 0.3)",
            transition: "opacity 0.2s, transform 0.1s",
          }}
          onMouseOver={(e) => (e.currentTarget.style.opacity = "0.9")}
          onMouseOut={(e) => (e.currentTarget.style.opacity = "1")}
        >
          <span>🖥️</span> {isFullscreen ? "Restore Down" : "Maximize Page"}
        </button>
      </div>

      <iframe
        src={targetUrl}
        title="DeepConsol AI Workspace"
        style={{
          width: "100%",
          flex: 1,
          border: "none",
          borderRadius: "12px",
          background: "#0b0f19",
          boxShadow: "0 4px 24px rgba(0, 0, 0, 0.4)",
        }}
        allow="clipboard-write; clipboard-read"
      />
    </div>
  );
}
