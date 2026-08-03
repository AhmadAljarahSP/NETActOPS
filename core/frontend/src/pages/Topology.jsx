import React from "react";
import { useTheme } from "../context/ThemeContext";

export default function Topology() {
  const { styles } = useTheme();

  return (
    <div style={{ width: "100%", height: "calc(100vh - 120px)", display: "flex", flexDirection: "column" }}>
      <iframe
        src={`http://${window.location.hostname}:3001/?v=2`}
        title="Network Topology Graph"
        allowFullScreen
        allow="fullscreen"
        style={{
          width: "100%",
          flex: 1,
          border: "none",
          borderRadius: "12px",
          background: "var(--bg)",
          boxShadow: "0 4px 24px rgba(0, 0, 0, 0.25)",
        }}
      />
    </div>
  );
}
