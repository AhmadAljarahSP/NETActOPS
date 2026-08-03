import React from "react";
import { styles, colors } from "../styles";

export default function RatioCircle({ success, fail }) {
  const total = success + fail;
  const safeTotal = total || 1;
  const successPct = Math.round((success / safeTotal) * 100);

  const radius = 52;
  const stroke = 10;
  const normalizedRadius = radius - stroke / 2;
  const circumference = 2 * Math.PI * normalizedRadius;
  const successOffset = circumference - (successPct / 100) * circumference;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
      <div style={{ position: "relative", width: 120, height: 120 }}>
        <svg width="120" height="120" viewBox="0 0 120 120">
          <circle cx="60" cy="60" r={normalizedRadius} fill="transparent" stroke={colors.border} strokeWidth={stroke} />
          <circle cx="60" cy="60" r={normalizedRadius} fill="transparent" stroke={colors.success} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${circumference} ${circumference}`} strokeDashoffset={successOffset} transform="rotate(-90 60 60)" style={{ transition: "stroke-dashoffset 0.35s ease" }} />
        </svg>
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
          <div style={{ fontSize: 24, fontWeight: 800, color: colors.light, lineHeight: 1 }}>{total === 0 ? "0%" : `${successPct}%`}</div>
          <div style={{ fontSize: 11, color: colors.gray, marginTop: 4 }}>success rate</div>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={styles.legendRow}><span style={{ ...styles.legendDot, background: colors.success }} /><span style={styles.legendText}>Success</span><b style={styles.legendValue}>{success}</b></div>
        <div style={styles.legendRow}><span style={{ ...styles.legendDot, background: colors.danger }} /><span style={styles.legendText}>Fail</span><b style={styles.legendValue}>{fail}</b></div>
        <div style={styles.legendRow}><span style={{ ...styles.legendDot, background: colors.gray }} /><span style={styles.legendText}>Total</span><b style={styles.legendValue}>{total}</b></div>
      </div>
    </div>
  );
}
