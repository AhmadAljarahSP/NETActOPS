import React from "react";
import { useTheme } from "../context/ThemeContext";

export default function AiAssistant() {
  const { styles } = useTheme();

  const targetUrl = "/copilot/";

  return (
    <div style={{ width: "100%", height: "calc(100vh - 120px)", display: "flex", flexDirection: "column" }}>
      <iframe
        src={targetUrl}
        title="AI Assistant Copilot"
        style={{
          width: "100%",
          flex: 1,
          border: "none",
          borderRadius: "12px",
          background: "var(--bg)",
          boxShadow: "0 4px 24px rgba(0, 0, 0, 0.25)",
        }}
        allow="clipboard-write; clipboard-read"
      />
    </div>
  );
}
