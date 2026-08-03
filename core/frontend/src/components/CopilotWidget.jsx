import React, { useState, useEffect, useRef } from "react";
import { useTheme } from "../context/ThemeContext";
import { useAuth } from "../context/AuthContext";
import copilotAgentImg from "../copilot_agent.jpg";

export default function CopilotWidget() {
  const { theme } = useTheme();
  const { user } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [hasBadge, setHasBadge] = useState(false);
  const iframeRef = useRef(null);

  const colors = theme?.colors || { primary: "#00adb5", gray: "#393e46" };

  // Automatically open the widget and show a notification badge on login
  useEffect(() => {
    if (user) {
      // Auto-open after a short delay so the user sees it slide up
      const t = setTimeout(() => {
        setIsOpen(true);
        setHasBadge(true);
      }, 1500);
      return () => clearTimeout(t);
    }
  }, [user]);

  // Send welcome message once the iframe loads
  const handleIframeLoad = () => {
    if (iframeRef.current && user) {
      iframeRef.current.contentWindow.postMessage(
        { type: "trigger_welcome", username: user.username },
        "*"
      );
    }
  };

  if (!user) return null;

  return (
    <div style={{ position: "fixed", bottom: 24, right: 24, zIndex: 10000, fontFamily: "sans-serif" }}>
      {/* Chat Window Popup Container */}
      <div style={{
        position: "absolute",
        bottom: 72,
        right: 0,
        width: 380,
        height: 520,
        background: "#090d16",
        borderRadius: 16,
        border: "1px solid rgba(255, 255, 255, 0.08)",
        boxShadow: "0 12px 36px rgba(0, 0, 0, 0.6)",
        overflow: "hidden",
        display: isOpen ? "flex" : "none",
        flexDirection: "column",
        transition: "all 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
        transform: isOpen ? "translateY(0) scale(1)" : "translateY(20px) scale(0.95)",
        transformOrigin: "bottom right",
      }}>
        {/* Iframe to Standalone Chat */}
        <iframe
          ref={iframeRef}
          src={`https://${window.location.hostname}:3500/chat-standalone?widget=true`}
          title="AI Assistant Copilot"
          onLoad={handleIframeLoad}
          style={{ width: "100%", height: "100%", border: "none", background: "#090d16" }}
          allow="clipboard-write; clipboard-read"
        />
      </div>

      {/* Floating Action Button */}
      <button
        onClick={() => {
          setIsOpen(!isOpen);
          setHasBadge(false);
        }}
        style={{
          width: 56,
          height: 56,
          borderRadius: "50%",
          background: colors.primary,
          color: "#ffffff",
          border: "none",
          cursor: "pointer",
          display: "grid",
          placeItems: "center",
          boxShadow: "0 4px 16px rgba(0, 0, 0, 0.3)",
          transition: "transform 0.2s ease, background 0.2s ease",
          position: "relative",
          overflow: "hidden",
        }}
        onMouseOver={(e) => {
          e.currentTarget.style.transform = "scale(1.05)";
        }}
        onMouseOut={(e) => {
          e.currentTarget.style.transform = "scale(1)";
        }}
      >
        {isOpen ? (
          // Close Icon
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        ) : (
          // Chat Agent Icon
          <img
            src={copilotAgentImg}
            alt="Copilot Agent"
            style={{
              width: "100%",
              height: "100%",
              borderRadius: "50%",
              objectFit: "cover",
            }}
          />
        )}

        {/* Welcome Notification Badge */}
        {hasBadge && !isOpen && (
          <span style={{
            position: "absolute",
            top: -2,
            right: -2,
            width: 14,
            height: 14,
            background: "#ff3b30",
            borderRadius: "50%",
            border: "2px solid #090d16",
            boxShadow: "0 0 8px rgba(255, 59, 48, 0.6)",
          }} />
        )}
      </button>
    </div>
  );
}
