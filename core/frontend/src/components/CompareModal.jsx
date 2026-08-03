import React, { useEffect, useState, useRef } from "react";
import { styles, colors } from "../styles";
import * as Diff from "diff";

const API = "/api";

const apiFetch = async (url, options = {}) => {
    const headers = {
        ...options.headers,
        "x-api-key": sessionStorage.getItem("app_password") || "",
    };

    const res = await fetch(url, { ...options, headers });
    if (res.status === 401) {
        sessionStorage.removeItem("app_password");
        window.location.reload();
    }
    return res;
};

export default function CompareModal({
    deviceId,
    deviceName,
    collectionType = "backup",
    initialId1 = null,
    initialId2 = null,
    onClose,
}) {
    const [collections, setCollections] = useState([]);
    const [selected1, setSelected1] = useState(null);
    const [selected2, setSelected2] = useState(null);

    const [loadingList, setLoadingList] = useState(false);
    const [loading, setLoading] = useState(false);

    const [leftContent, setLeftContent] = useState("");
    const [rightContent, setRightContent] = useState("");

    const [viewMode, setViewMode] = useState("split");
    const [syncScroll, setSyncScroll] = useState(true);

    // Stats for the diff
    const [diffStats, setDiffStats] = useState({ added: 0, removed: 0, total: 0 });
    const [modalFullScreen, setModalFullScreen] = useState(false);

    const leftPanelRef = useRef(null);
    const rightPanelRef = useRef(null);

    const title = collectionType === "backup" ? "Backups" : "Healthchecks";

    useEffect(() => {
        loadCollections();
    }, [deviceId, collectionType]);

    async function loadCollections() {
        try {
            setLoadingList(true);
            const url = `${API}/collections/${deviceId}?collection_type=${collectionType}`;
            const res = await apiFetch(url);
            const data = await res.json();

            const sorted = (data || []).sort(
                (a, b) => new Date(b.collected_at) - new Date(a.collected_at)
            );

            setCollections(sorted);

            if (initialId1 && initialId2) {
                setSelected1(sorted.find(c => c.id === initialId1) || sorted[1] || null);
                setSelected2(sorted.find(c => c.id === initialId2) || sorted[0] || null);
            } else if (sorted.length >= 2) {
                setSelected1(sorted[1]);
                setSelected2(sorted[0]);
            } else if (sorted.length === 1) {
                setSelected1(sorted[0]);
            }
        } catch (error) {
            console.error("Failed to load collections:", error);
        } finally {
            setLoadingList(false);
        }
    }

    useEffect(() => {
        if (selected1 && selected2) {
            fetchContents();
        }
    }, [selected1, selected2]);

    async function fetchContents() {
        try {
            setLoading(true);

            const [r1, r2] = await Promise.all([
                apiFetch(`${API}/collections/${selected1.id}/full?collection_type=${collectionType}&device_id=${deviceId}`),
                apiFetch(`${API}/collections/${selected2.id}/full?collection_type=${collectionType}&device_id=${deviceId}`),
            ]);

            const d1 = await r1.json();
            const d2 = await r2.json();

            const content1 = d1?.config_text || "";
            const content2 = d2?.config_text || "";

            setLeftContent(content1);
            setRightContent(content2);

            // Calculate diff stats
            calculateDiffStats(content1, content2);
        } catch (error) {
            console.error("Failed to fetch content:", error);
        } finally {
            setLoading(false);
        }
    }

    // Calculate added/removed lines stats
    function calculateDiffStats(oldText, newText) {
        const diff = Diff.diffLines(oldText || "", newText || "");
        let added = 0;
        let removed = 0;

        for (const part of diff) {
            const lines = part.value.split('\n');
            // Remove last empty line
            if (lines[lines.length - 1] === '') lines.pop();
            const lineCount = lines.length;

            if (part.added) {
                added += lineCount;
            } else if (part.removed) {
                removed += lineCount;
            }
        }

        setDiffStats({
            added,
            removed,
            total: added + removed
        });
    }

    function swap() {
        const tmp = selected1;
        setSelected1(selected2);
        setSelected2(tmp);
        setLeftContent(rightContent);
        setRightContent(leftContent);
        // Recalculate stats with swapped content
        calculateDiffStats(rightContent, leftContent);
    }

    function formatDate(dateString) {
        if (!dateString) return "Unknown";
        return new Date(dateString).toLocaleString();
    }

    function handleLeftScroll(e) {
        if (syncScroll && rightPanelRef.current) {
            rightPanelRef.current.scrollTop = e.target.scrollTop;
        }
    }

    function handleRightScroll(e) {
        if (syncScroll && leftPanelRef.current) {
            leftPanelRef.current.scrollTop = e.target.scrollTop;
        }
    }

    function getUnifiedDiff() {
        return Diff.createTwoFilesPatch(
            selected1 ? formatDate(selected1.collected_at) : "Old",
            selected2 ? formatDate(selected2.collected_at) : "New",
            leftContent || "",
            rightContent || "",
            "",
            ""
        );
    }

    function getDiffLines() {
        return Diff.diffLines(leftContent || "", rightContent || "");
    }

    function renderSplitView() {
        const diffLines = getDiffLines();

        let leftLines = [];
        let rightLines = [];
        let leftLineNum = 1;
        let rightLineNum = 1;

        for (const part of diffLines) {
            const lines = part.value.split('\n');
            if (lines[lines.length - 1] === '') lines.pop();

            if (part.added) {
                for (const line of lines) {
                    rightLines.push({
                        content: line,
                        type: 'added',
                        lineNum: rightLineNum++
                    });
                    leftLines.push({
                        content: '',
                        type: 'empty',
                        lineNum: null
                    });
                }
            } else if (part.removed) {
                for (const line of lines) {
                    leftLines.push({
                        content: line,
                        type: 'removed',
                        lineNum: leftLineNum++
                    });
                    rightLines.push({
                        content: '',
                        type: 'empty',
                        lineNum: null
                    });
                }
            } else {
                for (const line of lines) {
                    leftLines.push({
                        content: line,
                        type: 'context',
                        lineNum: leftLineNum++
                    });
                    rightLines.push({
                        content: line,
                        type: 'context',
                        lineNum: rightLineNum++
                    });
                }
            }
        }

        return (
            <div style={{ display: 'flex', gap: 16, height: modalFullScreen ? '75vh' : '55vh', border: `1px solid ${colors.border}`, borderRadius: 8, overflow: 'hidden' }}>
                {/* Left Panel */}
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                    <div style={{
                        padding: '10px 12px',
                        background: colors.darker,
                        borderBottom: `1px solid ${colors.border}`,
                        fontWeight: 600,
                        fontSize: 13,
                        position: 'sticky',
                        top: 0,
                        zIndex: 1
                    }}>
                        {selected1 ? formatDate(selected1.collected_at) : 'Version 1'}
                    </div>
                    <div
                        ref={leftPanelRef}
                        onScroll={handleLeftScroll}
                        style={{
                            flex: 1,
                            overflowY: 'auto',
                            fontFamily: 'monospace',
                            fontSize: 12,
                            lineHeight: 1.5,
                            background: colors.dark
                        }}
                    >
                        {leftLines.map((line, idx) => {
                            let lineStyle = { padding: '2px 8px', display: 'flex', borderLeft: '3px solid transparent' };
                            let contentColor = colors.light;

                            if (line.type === 'removed') {
                                lineStyle = { ...lineStyle, background: `${colors.danger}20`, borderLeftColor: colors.danger };
                                contentColor = colors.danger;
                            } else if (line.type === 'empty') {
                                contentColor = colors.gray;
                            }

                            return (
                                <div key={idx} style={lineStyle}>
                                    <span style={{ width: 45, color: colors.gray, userSelect: 'none', flexShrink: 0 }}>
                                        {line.lineNum || ' '}
                                    </span>
                                    <span style={{ color: contentColor, whiteSpace: 'pre-wrap', wordBreak: 'break-all', flex: 1 }}>
                                        {line.type === 'removed' && <span style={{ marginRight: 8 }}>-</span>}
                                        {line.content || ' '}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Right Panel */}
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                    <div style={{
                        padding: '10px 12px',
                        background: colors.darker,
                        borderBottom: `1px solid ${colors.border}`,
                        fontWeight: 600,
                        fontSize: 13,
                        position: 'sticky',
                        top: 0,
                        zIndex: 1
                    }}>
                        {selected2 ? formatDate(selected2.collected_at) : 'Version 2'}
                    </div>
                    <div
                        ref={rightPanelRef}
                        onScroll={handleRightScroll}
                        style={{
                            flex: 1,
                            overflowY: 'auto',
                            fontFamily: 'monospace',
                            fontSize: 12,
                            lineHeight: 1.5,
                            background: colors.dark
                        }}
                    >
                        {rightLines.map((line, idx) => {
                            let lineStyle = { padding: '2px 8px', display: 'flex', borderLeft: '3px solid transparent' };
                            let contentColor = colors.light;

                            if (line.type === 'added') {
                                lineStyle = { ...lineStyle, background: `${colors.success}20`, borderLeftColor: colors.success };
                                contentColor = colors.success;
                            } else if (line.type === 'empty') {
                                contentColor = colors.gray;
                            }

                            return (
                                <div key={idx} style={lineStyle}>
                                    <span style={{ width: 45, color: colors.gray, userSelect: 'none', flexShrink: 0 }}>
                                        {line.lineNum || ' '}
                                    </span>
                                    <span style={{ color: contentColor, whiteSpace: 'pre-wrap', wordBreak: 'break-all', flex: 1 }}>
                                        {line.type === 'added' && <span style={{ marginRight: 8 }}>+</span>}
                                        {line.content || ' '}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        );
    }

    function renderUnifiedView() {
        const unifiedDiff = getUnifiedDiff();

        return (
            <pre
                style={{
                    fontFamily: "monospace",
                    fontSize: 12,
                    padding: 12,
                    height: modalFullScreen ? '75vh' : '55vh',
                    overflow: "auto",
                    background: colors.darker,
                    color: colors.light,
                    border: `1px solid ${colors.border}`,
                    borderRadius: 8,
                    lineHeight: 1.5,
                }}
            >
                {unifiedDiff.split('\n').map((line, idx) => {
                    let lineColor = colors.light;
                    if (line.startsWith('+')) lineColor = colors.success;
                    if (line.startsWith('-')) lineColor = colors.danger;
                    if (line.startsWith('@@')) lineColor = colors.info;
                    return (
                        <div key={idx} style={{ color: lineColor, whiteSpace: 'pre-wrap' }}>
                            {line}
                        </div>
                    );
                })}
            </pre>
        );
    }

    return (
        <div style={styles.modalBackdrop} onClick={onClose}>
            <div
                style={{ 
                    ...styles.modalCard, 
                    ...(modalFullScreen ? {
                        position: "fixed",
                        inset: 0,
                        width: "100vw",
                        height: "100vh",
                        maxWidth: "none",
                        maxHeight: "none",
                        borderRadius: 0,
                        margin: 0,
                        zIndex: 9999
                    } : {
                        width: "95vw", 
                        maxHeight: "90vh"
                    })
                }}
                onClick={(e) => e.stopPropagation()}
            >
                <div style={styles.modalHeader}>
                    <h3 style={styles.modalTitle}>
                        Compare {title} — {deviceName}
                    </h3>

                    <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                        <div style={{ display: "flex", gap: 6, background: colors.darker, padding: 4, borderRadius: 8 }}>
                            <button
                                onClick={() => setViewMode("split")}
                                style={{
                                    padding: "6px 12px",
                                    borderRadius: 6,
                                    border: "none",
                                    background: viewMode === "split" ? colors.primary : "transparent",
                                    color: viewMode === "split" ? "#fff" : colors.gray,
                                    cursor: "pointer",
                                    fontSize: 12,
                                }}
                            >
                                Split View
                            </button>
                            <button
                                onClick={() => setViewMode("unified")}
                                style={{
                                    padding: "6px 12px",
                                    borderRadius: 6,
                                    border: "none",
                                    background: viewMode === "unified" ? colors.primary : "transparent",
                                    color: viewMode === "unified" ? "#fff" : colors.gray,
                                    cursor: "pointer",
                                    fontSize: 12,
                                }}
                            >
                                Unified Diff
                            </button>
                        </div>
                        {viewMode === "split" && (
                            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
                                <input
                                    type="checkbox"
                                    checked={syncScroll}
                                    onChange={(e) => setSyncScroll(e.target.checked)}
                                />
                                Sync Scroll
                            </label>
                        )}
                        <button
                            onClick={swap}
                            style={{
                                padding: "6px 12px",
                                borderRadius: 6,
                                border: `1px solid ${colors.border}`,
                                background: colors.dark,
                                color: colors.light,
                                cursor: "pointer",
                                fontSize: 12,
                            }}
                        >
                            ⇄ Swap
                        </button>
                        <button 
                            onClick={() => setModalFullScreen(prev => !prev)} 
                            style={{
                                width: 32,
                                height: 32,
                                borderRadius: 6,
                                border: `1px solid ${colors.border}`,
                                background: colors.dark,
                                color: colors.light,
                                cursor: "pointer",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center"
                            }}
                            title={modalFullScreen ? "Exit Full Screen" : "Full Screen"}
                        >
                            {modalFullScreen ? (
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 14h6v6m10-6h-6v6M4 10h6V4m10 6h-6V4"/></svg>
                            ) : (
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>
                            )}
                        </button>
                        <button
                            onClick={onClose}
                            style={{
                                width: 32,
                                height: 32,
                                borderRadius: 6,
                                border: `1px solid ${colors.border}`,
                                background: colors.dark,
                                color: colors.light,
                                cursor: "pointer",
                                fontSize: 18,
                            }}
                        >
                            ✕
                        </button>
                    </div>
                </div>

                {/* Collection Selectors */}
                <div style={{
                    padding: "16px 20px",
                    display: "flex",
                    gap: 20,
                    background: colors.darker,
                    borderBottom: `1px solid ${colors.border}`
                }}>
                    <div style={{ flex: 1 }}>
                        <label style={{ fontSize: 12, color: colors.gray, marginBottom: 6, display: "block" }}>
                            {title} 1 (Older)
                        </label>
                        <select
                            value={selected1?.id || ""}
                            onChange={(e) =>
                                setSelected1(collections.find((c) => c.id === e.target.value))
                            }
                            style={{ ...styles.input, width: "100%" }}
                            disabled={loadingList}
                        >
                            <option value="">Select {title} 1</option>
                            {collections.map((c) => (
                                <option key={c.id} value={c.id}>
                                    {formatDate(c.collected_at)} - {c.status}
                                </option>
                            ))}
                        </select>
                    </div>

                    <div style={{ flex: 1 }}>
                        <label style={{ fontSize: 12, color: colors.gray, marginBottom: 6, display: "block" }}>
                            {title} 2 (Newer)
                        </label>
                        <select
                            value={selected2?.id || ""}
                            onChange={(e) =>
                                setSelected2(collections.find((c) => c.id === e.target.value))
                            }
                            style={{ ...styles.input, width: "100%" }}
                            disabled={loadingList}
                        >
                            <option value="">Select {title} 2</option>
                            {collections.map((c) => (
                                <option key={c.id} value={c.id}>
                                    {formatDate(c.collected_at)} - {c.status}
                                </option>
                            ))}
                        </select>
                    </div>
                </div>

                {/* Diff Statistics */}
                {!loading && (diffStats.added > 0 || diffStats.removed > 0) && (
                    <div style={{
                        padding: "12px 20px",
                        display: "flex",
                        gap: 20,
                        background: colors.darker,
                        borderBottom: `1px solid ${colors.border}`
                    }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ fontSize: 12, color: colors.gray }}>Lines Added:</span>
                            <span style={{ fontSize: 18, fontWeight: "bold", color: colors.success }}>+{diffStats.added}</span>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ fontSize: 12, color: colors.gray }}>Lines Removed:</span>
                            <span style={{ fontSize: 18, fontWeight: "bold", color: colors.danger }}>-{diffStats.removed}</span>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ fontSize: 12, color: colors.gray }}>Total Changes:</span>
                            <span style={{ fontSize: 18, fontWeight: "bold", color: colors.info }}>{diffStats.total}</span>
                        </div>
                    </div>
                )}

                {/* Content Area */}
                <div style={{ padding: 20 }}>
                    {loadingList && (
                        <div style={styles.loadingState}>Loading available {title.toLowerCase()}...</div>
                    )}

                    {!loadingList && collections.length < 2 && (
                        <div style={styles.emptyState}>
                            Need at least 2 {title.toLowerCase()} to compare.<br />
                            Currently have {collections.length} {title.toLowerCase()} available.
                        </div>
                    )}

                    {loading && (
                        <div style={styles.loadingState}>Loading content...</div>
                    )}

                    {!loading && !loadingList && selected1 && selected2 && (
                        viewMode === "split" ? renderSplitView() : renderUnifiedView()
                    )}
                </div>
            </div>
        </div>
    );
}