import React from "react";
import { Link, useLocation } from "react-router-dom";
import logo from "../logo.png";
import { styles, colors } from "../styles";

export default function Header({ devicesCount }) {
  const location = useLocation();

  const navLinkStyle = (path) => ({
    textDecoration: "none",
    color: location.pathname === path ? colors.primary : colors.gray,
    fontWeight: location.pathname === path ? 700 : 600,
    fontSize: 15,
    padding: "8px 16px",
    borderRadius: 12,
    background: location.pathname === path ? `${colors.primary}15` : "transparent",
    transition: "all 0.2s"
  });

  return (
    <div style={styles.header}>
      <div style={styles.headerLeft}>
        <Link to="/" style={styles.logoBox}>
          <img src={logo} alt="logo" style={{ width: 52, height: 52, objectFit: "contain" }} />
        </Link>
        <div>
          <h1 style={styles.title}>Network Config Backup</h1>
          <p style={styles.subtitle}>Enterprise-grade configuration management</p>
        </div>
      </div>
      
      <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
        <nav style={{ display: "flex", gap: 8, marginRight: 24, paddingRight: 24, borderRight: `1px solid ${colors.border}` }}>
          <Link to="/" style={navLinkStyle("/")}>Dashboard</Link>
          <Link to="/devices" style={navLinkStyle("/devices")}>Devices</Link>
        </nav>
        {devicesCount !== undefined && (
          <div style={styles.statPill}>{devicesCount} {devicesCount === 1 ? "device" : "devices"}</div>
        )}
      </div>
    </div>
  );
}
