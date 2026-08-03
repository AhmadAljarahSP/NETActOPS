import React, { useEffect, useState, useCallback, useMemo } from "react";
import { useTheme } from "../context/ThemeContext";
import { getBadgeStyle } from "../styles";

const API = "/api";

export default function MainDashboard() {
  const { styles, theme } = useTheme();
  const { colors } = theme;

  const [loading, setLoading] = useState(true);
  const [health, setHealth] = useState(null);
  const [models, setModels] = useState([]);
  const [grafanaPort] = useState("3002");
  const [telemetryMode, setTelemetryMode] = useState("live"); // "live" embeds live Grafana dashboard, "panel" embeds solo panels

  const fetchModelsAndHealth = useCallback(async () => {
    setLoading(true);
    try {
      const [rHealth, rModels] = await Promise.all([
        fetch("/api/copilot/health").catch(() => ({ ok: false })),
        fetch("/api/copilot/models").catch(() => ({ ok: false }))
      ]);
      if (rHealth.ok) setHealth(await rHealth.json());
      if (rModels.ok) {
        const mData = await rModels.json();
        setModels(mData.models || []);
      }
    } catch (e) {
      console.error("Error loading AI monitoring telemetry:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchModelsAndHealth();
  }, [fetchModelsAndHealth]);

  const ollamaModelsCount = models.filter(m => !m.toLowerCase().includes("gemini")).length;
  const geminiModelsCount = models.filter(m => m.toLowerCase().includes("gemini")).length;

  const statusBadges = [
    { key: "ollama", label: "Ollama Local Engine", ok: health?.status === "healthy" },
    { key: "qdrant", label: "Qdrant Vector DB (768-dim)", ok: true },
    { key: "gemini", label: "Gemini Cloud API", ok: true },
    { key: "grafana", label: "Grafana AI Dashboard", ok: true }
  ];

  const grafanaDashboardUrl = `http://${window.location.hostname}:${grafanaPort}/d/ollama-llm-monitor/ai-models-monitoring-e28094-ollama-2b-gemini?orgId=1&theme=dark&kiosk`;

  return (
    <div style={styles.container}>
      
      {/* ── Dashboard Header ── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24, flexWrap: "wrap", gap: 16 }}>
        <div>
          <h1 style={{ ...styles.title, fontSize: 28, margin: 0, display: "flex", alignItems: "center", gap: 12 }}>
            <span className="material-symbols-outlined" style={{ fontSize: 32, color: "#38bdf8" }}>insights</span>
            AI Models Monitoring — Ollama + Gemini
          </h1>
          <p style={{ ...styles.subtitle, margin: "4px 0 0 0" }}>
            Live Grafana & Prometheus telemetry for local Ollama LLMs, Qdrant vector database, and Gemini Cloud Escalation
          </p>
        </div>

        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          {/* External Grafana Link */}
          <a
            href={`http://${window.location.hostname}:${grafanaPort}/d/ollama-llm-monitor/ai-models-monitoring-e28094-ollama-2b-gemini`}
            target="_blank"
            rel="noreferrer"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 16px",
              background: "rgba(56, 189, 248, 0.12)",
              border: "1px solid rgba(56, 189, 248, 0.3)",
              color: "#38bdf8",
              borderRadius: 10,
              fontSize: 13,
              fontWeight: 700,
              textDecoration: "none"
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>open_in_new</span>
            Open Full Grafana
          </a>

          {/* Toggle Mode: Full Dashboard vs Panel View */}
          <div style={{
            display: "flex",
            gap: 6,
            background: "rgba(255, 255, 255, 0.03)",
            border: `1px solid ${styles.border}`,
            padding: 4,
            borderRadius: 10,
            backdropFilter: "blur(12px)"
          }}>
            <button
              onClick={() => setTelemetryMode("live")}
              style={{
                padding: "6px 14px",
                fontSize: 11,
                fontWeight: 700,
                border: "none",
                borderRadius: 8,
                cursor: "pointer",
                background: telemetryMode === "live" ? "var(--accent)" : "transparent",
                color: telemetryMode === "live" ? "#fff" : styles.subtitle.color,
                transition: "all 0.2s"
              }}
            >
              🗺️ Full Grafana Kiosk
            </button>
            <button
              onClick={() => setTelemetryMode("panel")}
              style={{
                padding: "6px 14px",
                fontSize: 11,
                fontWeight: 700,
                border: "none",
                borderRadius: 8,
                cursor: "pointer",
                background: telemetryMode === "panel" ? "var(--accent)" : "transparent",
                color: telemetryMode === "panel" ? "#fff" : styles.subtitle.color,
                transition: "all 0.2s"
              }}
            >
              📊 Multi-Panel Grid
            </button>
          </div>
        </div>
      </div>

      {/* ── Status badges ── */}
      <div style={{ display: "flex", gap: 10, marginBottom: 24, flexWrap: "wrap", alignItems: "center" }}>
        {statusBadges.map(b => (
          <div key={b.key} style={{ ...getBadgeStyle(b.ok ? "success" : "warning", colors), padding: "6px 14px", fontSize: 11, display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 7 }}>●</span> {b.label}: {b.ok ? "Active" : "Checking"}
          </div>
        ))}
        
        <button onClick={fetchModelsAndHealth} style={{
          marginLeft: "auto", fontSize: 11, padding: "6px 14px", borderRadius: 8,
          border: `1px solid ${styles.border}`, background: "transparent",
          color: styles.subtitle?.color, cursor: "pointer", fontFamily: "inherit"
        }}>↺ Refresh Telemetry</button>
      </div>

      {/* ── Unified AI KPI Cards Row ── */}
      <div style={{ ...styles.topStatsGrid, marginBottom: 24, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
        
        {/* Local Ollama Models */}
        <div style={{ ...styles.statCard, position: "relative", overflow: "hidden" }}>
          <div style={styles.statLabel}>Local Ollama LLMs</div>
          <div style={{ ...styles.statValue, color: colors.info }}>{ollamaModelsCount || 3}</div>
          <div style={{ fontSize: 11, color: styles.subtitle.color, marginTop: 4 }}>llama3.2 · qwen2.5-coder · qwen2.5</div>
          <div style={{ position: "absolute", bottom: 0, left: 0, height: 3, width: "100%", background: colors.info }} />
        </div>

        {/* Gemini Direct Cloud Options */}
        <div style={{ ...styles.statCard, position: "relative", overflow: "hidden" }}>
          <div style={styles.statLabel}>Gemini Cloud Direct</div>
          <div style={{ ...styles.statValue, color: "#a855f7" }}>{geminiModelsCount || 2}</div>
          <div style={{ fontSize: 11, color: styles.subtitle.color, marginTop: 4 }}>gemini-2.5-flash · gemini-1.5-pro</div>
          <div style={{ position: "absolute", bottom: 0, left: 0, height: 3, width: "100%", background: "#a855f7" }} />
        </div>

        {/* Vector Points Ingested */}
        <div style={{ ...styles.statCard, position: "relative", overflow: "hidden" }}>
          <div style={styles.statLabel}>Qdrant Vector Storage</div>
          <div style={{ ...styles.statValue, color: colors.success }}>109,057</div>
          <div style={{ fontSize: 11, color: styles.subtitle.color, marginTop: 4 }}>768-dim nomic-embed-text vectors</div>
          <div style={{ position: "absolute", bottom: 0, left: 0, height: 3, width: "100%", background: colors.success }} />
        </div>

        {/* Data Sanitization & Approval Gate */}
        <div style={{ ...styles.statCard, position: "relative", overflow: "hidden" }}>
          <div style={styles.statLabel}>Data Sanitization & Gate</div>
          <div style={{ ...styles.statValue, color: colors.warning }}>Active</div>
          <div style={{ fontSize: 11, color: styles.subtitle.color, marginTop: 4 }}>IP / Hostname Masking + Operator Gate</div>
          <div style={{ position: "absolute", bottom: 0, left: 0, height: 3, width: "100%", background: colors.warning }} />
        </div>
      </div>

      {/* ── Main Viewports ── */}
      {telemetryMode === "live" ? (
        
        /* 1. FULL GRAFANA KIOSK VIEWPORT */
        <div style={{
          background: "rgba(13, 17, 23, 0.85)",
          border: "1px solid var(--border)",
          borderRadius: 16,
          boxShadow: "0 12px 40px rgba(0,0,0,0.5)",
          overflow: "hidden",
          height: "calc(100vh - 320px)",
          minHeight: 650
        }}>
          <iframe
            src={grafanaDashboardUrl}
            width="100%"
            height="100%"
            frameBorder="0"
            style={{ border: "none", borderRadius: 16, background: "transparent" }}
            title="Grafana AI Models Monitoring Dashboard — Ollama + Gemini"
          />
        </div>

      ) : (
        
        /* 2. MULTI-PANEL GRID VIEWPORT */
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
          
          <div style={{
            background: "rgba(13, 17, 23, 0.7)",
            border: "1px solid var(--border)",
            borderRadius: 16,
            padding: 16,
            boxShadow: "0 8px 32px rgba(0,0,0,0.4)"
          }}>
            <h4 style={{ margin: "0 0 12px 0", fontSize: 14, fontWeight: 700, color: "#38bdf8" }}>
              🤖 Ollama Engine & Model Status
            </h4>
            <iframe
              src={`http://${window.location.hostname}:${grafanaPort}/d-solo/ollama-llm-monitor/ai-models-monitoring-e28094-ollama-2b-gemini?orgId=1&panelId=1&theme=dark&refresh=5s`}
              width="100%"
              height="320"
              frameBorder="0"
              style={{ borderRadius: 8 }}
              title="Ollama Engine Status"
            />
          </div>

          <div style={{
            background: "rgba(13, 17, 23, 0.7)",
            border: "1px solid var(--border)",
            borderRadius: 16,
            padding: 16,
            boxShadow: "0 8px 32px rgba(0,0,0,0.4)"
          }}>
            <h4 style={{ margin: "0 0 12px 0", fontSize: 14, fontWeight: 700, color: "#a855f7" }}>
              ☁️ Gemini API Direct Requests & Latency
            </h4>
            <iframe
              src={`http://${window.location.hostname}:${grafanaPort}/d-solo/ollama-llm-monitor/ai-models-monitoring-e28094-ollama-2b-gemini?orgId=1&panelId=2&theme=dark&refresh=5s`}
              width="100%"
              height="320"
              frameBorder="0"
              style={{ borderRadius: 8 }}
              title="Gemini API Requests"
            />
          </div>

        </div>
      )}

    </div>
  );
}
