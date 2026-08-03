import React, { useState } from "react";
import { styles, colors } from "../styles";

const API = "/api";

// Add this helper function
const apiFetch = async (url, options = {}) => {
  const headers = {
    ...options.headers,
    'x-api-key': sessionStorage.getItem('app_password') || ''
  };
  const res = await fetch(url, { ...options, headers });
  if (res.status === 401) {
    sessionStorage.removeItem('app_password');
    window.location.reload();
  }
  return res;
};

export default function RollbackModal({ backupId, deviceName, deviceId, collectionType = "backup", onClose, onRollbackComplete }) {
  const [confirming, setConfirming] = useState(false);

  async function confirmRollback() {
    setConfirming(true);
    try {
      const res = await apiFetch(`${API}/backups/${deviceId}/rollback?target_backup_id=${backupId}&collection_type=${collectionType}`, {
        method: "POST"
      });
      const data = await res.json();
      if (data.status === "rollback_ready") {
        const typeLabel = collectionType === "backup" ? "backup" : "healthcheck";
        alert(`Successfully rolled back ${typeLabel} to version ${backupId}`);
        onRollbackComplete();
        onClose();
      } else if (data.error) {
        alert(`Rollback failed: ${data.error}`);
      }
    } catch (error) {
      alert("Rollback failed: " + error.message);
    } finally {
      setConfirming(false);
    }
  }

  const typeLabel = collectionType === "backup" ? "backup" : "healthcheck";
  const titleText = collectionType === "backup" ? "Rollback Configuration" : "Rollback Healthcheck";
  const warningText = collectionType === "backup"
    ? "This will restore the configuration to version {backupId}. Make sure you have a current backup before proceeding."
    : "This will restore the healthcheck history to version {backupId}. Make sure you have a current healthcheck before proceeding.";

  return (
    <div style={styles.modalBackdrop} onClick={onClose}>
      <div style={styles.modalCard} onClick={e => e.stopPropagation()}>
        <div style={styles.modalHeader}>
          <h3 style={styles.modalTitle}>{titleText}</h3>
          <button onClick={onClose} style={styles.closeButton}>✕</button>
        </div>
        <div style={styles.modalBody}>
          <div style={styles.warningBox}>
            <strong>⚠️ Warning:</strong> {warningText.replace('{backupId}', backupId)}
          </div>
          <div style={{ marginTop: 20, display: "flex", gap: 12, justifyContent: "flex-end" }}>
            <button onClick={onClose} style={styles.buttonSecondary}>Cancel</button>
            <button
              onClick={confirmRollback}
              style={{ ...styles.buttonDanger, background: colors.danger }}
              disabled={confirming}
            >
              {confirming ? `Rolling back ${typeLabel}...` : `Confirm ${typeLabel} Rollback`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}