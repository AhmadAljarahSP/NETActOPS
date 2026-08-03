import React, { useState, useEffect, useRef } from "react";
import axios from "axios";

export default function App() {
  const [threads, setThreads] = useState([]);
  const [activeThreadId, setActiveThreadId] = useState("");
  const [inputMessage, setInputMessage] = useState("");
  const [healthStatus, setHealthStatus] = useState("checking");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [chatMode, setChatMode] = useState("ollama_model"); // "copilot_only" or "ollama_model"
  const [availableModels, setAvailableModels] = useState([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [activeSidebarTab, setActiveSidebarTab] = useState("threads"); // "threads", "kb", "sanitization", "itsm", "benchmark"

  // ── Benchmark state ──────────────────────────────────────────────────────
  const [benchmarkGroups, setBenchmarkGroups] = useState([]);
  const [selectedBenchmarkGroups, setSelectedBenchmarkGroups] = useState(new Set());
  const [benchmarkRunning, setBenchmarkRunning] = useState(false);
  const [benchmarkResults, setBenchmarkResults] = useState(null);
  const [expandedBenchmarkGroup, setExpandedBenchmarkGroup] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [disabledDocs, setDisabledDocs] = useState(new Set());
  const [uploading, setUploading] = useState(false);
  const [sanitizationConfig, setSanitizationConfig] = useState({
    rules: {
      mask_ips: true,
      mask_hostnames: true,
      mask_commands: true,
      mask_emails: true
    },
    custom_terms: [],
    custom_regexes: []
  });
  const [newCustomTerm, setNewCustomTerm] = useState("");
  const [newCustomRegex, setNewCustomRegex] = useState("");
  const [tickets, setTickets] = useState([]);
  const [newTicketDevice, setNewTicketDevice] = useState("");
  const [newTicketAction, setNewTicketAction] = useState("run_config_backup");
  const [newTicketDesc, setNewTicketDesc] = useState("");

  const fetchTickets = async () => {
    try {
      const res = await axios.get("/api/copilot/itsm/tickets");
      setTickets(res.data);
    } catch (err) {
      console.error("Error fetching tickets:", err);
    }
  };

  const fetchBenchmarkGroups = async () => {
    try {
      const [casesRes, resultsRes] = await Promise.all([
        axios.get("/api/copilot/benchmark/cases"),
        axios.get("/api/copilot/benchmark/results").catch(() => ({ data: null }))
      ]);
      setBenchmarkGroups(casesRes.data.groups || []);
      setSelectedBenchmarkGroups(new Set((casesRes.data.groups || []).map(g => g.id)));
      if (resultsRes.data) setBenchmarkResults(resultsRes.data);
    } catch (err) {
      console.error("Error fetching benchmark groups:", err);
    }
  };

  const toggleBenchmarkGroup = (gid) => {
    setSelectedBenchmarkGroups(prev => {
      const next = new Set(prev);
      if (next.has(gid)) next.delete(gid);
      else next.add(gid);
      return next;
    });
  };

  const runBenchmark = async (runAll = false) => {
    const groups = runAll ? [] : Array.from(selectedBenchmarkGroups);
    setBenchmarkRunning(true);
    setBenchmarkResults(null);
    setExpandedBenchmarkGroup(null);
    try {
      const res = await axios.post("/api/copilot/benchmark", { groups });
      setBenchmarkResults(res.data);
    } catch (err) {
      console.error("Benchmark failed:", err);
      alert("Benchmark failed: " + (err.response?.data?.detail || err.message));
    } finally {
      setBenchmarkRunning(false);
    }
  };

  useEffect(() => {
    fetchTickets();
  }, []);

  const createTicket = async () => {
    const dev = newTicketDevice.trim();
    const desc = newTicketDesc.trim();
    if (!dev || !desc) {
      alert("Please fill in the Device Hostname/IP and Description.");
      return;
    }
    try {
      setLoading(true);
      await axios.post("/api/copilot/itsm/tickets", {
        device_name: dev,
        action_type: newTicketAction,
        description: desc
      });
      setNewTicketDevice("");
      setNewTicketDesc("");
      await fetchTickets();
      alert("Ticket created successfully! Status is set to 'Pending'.");
    } catch (err) {
      console.error(err);
      alert("Failed to create ticket.");
    } finally {
      setLoading(false);
    }
  };

  const approveTicket = async (ticketId) => {
    try {
      await axios.post(`/api/copilot/itsm/tickets/${ticketId}/approve`);
      await fetchTickets();
    } catch (err) {
      console.error(err);
      alert("Failed to approve ticket.");
    }
  };

  const rejectTicket = async (ticketId) => {
    try {
      await axios.post(`/api/copilot/itsm/tickets/${ticketId}/reject`);
      await fetchTickets();
    } catch (err) {
      console.error(err);
      alert("Failed to reject ticket.");
    }
  };

  const chatFeedRef = useRef(null);

  // 1. Initialize data and load chat history threads from localStorage
  useEffect(() => {
    async function checkHealth() {
      try {
        const healthRes = await axios.get("/api/copilot/health");
        if (healthRes.data.status === "healthy") {
          setHealthStatus("online");
          try {
            const modelsRes = await axios.get("/api/copilot/models");
            if (modelsRes.data && modelsRes.data.models) {
              setAvailableModels(modelsRes.data.models);
              if (modelsRes.data.models.length > 0) {
                const defaultModel = healthRes.data.ollama_model;
                if (defaultModel && modelsRes.data.models.includes(defaultModel)) {
                  setSelectedModel(defaultModel);
                } else {
                  setSelectedModel(modelsRes.data.models[0]);
                }
              }
            }
          } catch (mErr) {
            console.error("Error fetching models:", mErr);
          }
        } else {
          setHealthStatus("offline");
        }
      } catch (err) {
        setHealthStatus("offline");
      }
    }
    checkHealth();
    fetchDocuments();
    fetchBenchmarkGroups();

    // Load saved threads
    const savedThreads = localStorage.getItem("copilot_threads");
    if (savedThreads) {
      try {
        const parsed = JSON.parse(savedThreads);
        setThreads(parsed);
        if (parsed.length > 0) {
          setActiveThreadId(parsed[0].id);
        } else {
          createNewThread();
        }
      } catch (e) {
        console.error("Error parsing saved threads:", e);
        createNewThread();
      }
    } else {
      createNewThread();
    }
  }, []);

  // 2. Persist threads to localStorage on change
  useEffect(() => {
    if (threads.length > 0) {
      try {
        const cleanedThreads = threads.map(t => ({
          ...t,
          messages: t.messages.map(m => ({
            ...m,
            content: m.content && m.content.length > 50000 
              ? m.content.substring(0, 50000) + "\n\n... [Output Truncated in history due to large size] ..." 
              : m.content
          }))
        }));
        localStorage.setItem("copilot_threads", JSON.stringify(cleanedThreads));
      } catch (e) {
        console.warn("Storage quota exceeded, trying to clear older threads to recover...", e);
        try {
          const activeThread = threads.find(t => t.id === activeThreadId);
          if (activeThread) {
            localStorage.setItem("copilot_threads", JSON.stringify([activeThread]));
          }
        } catch (innerErr) {
          console.error("Failed to recover localStorage:", innerErr);
          localStorage.removeItem("copilot_threads");
        }
      }
    }
  }, [threads, activeThreadId]);

  // 3. Scroll to bottom of chat when new message is added
  useEffect(() => {
    if (chatFeedRef.current) {
      chatFeedRef.current.scrollTop = chatFeedRef.current.scrollHeight;
    }
  }, [threads, activeThreadId, loading]);

  const createNewThread = () => {
    const newId = "thread_" + Date.now();
    const newThread = {
      id: newId,
      name: "New Network Chat Thread",
      messages: [
        {
          role: "assistant",
          content: "🤖 **Welcome to NETAct AI Copilot!**\n\nI am your on-premises network operations assistant. I can help you with:\n* **List registered network nodes** (type *'list nodes'*)\n* **Check secure Git configuration backups** (type *'list backups'*)\n* **Review healthcheck diagnostics** (type *'list healthchecks'*)\n* **Collect backups on-demand** (type *'run backup for demo-switch-01'*)\n* **Trigger healthchecks on-demand** (type *'run healthcheck for demo-switch-01'*)\n* **Run automation workflows** (type *'run automation UpgradeOSPF'*)\n* **Analyze diagnostic log files** (type *'analyze healthcheck logs of demo-switch-01'*)\n\nHow can I support your network operations today?"
        }
      ]
    };
    setThreads(prev => [newThread, ...prev]);
    setActiveThreadId(newId);
  };

  const deleteThread = (id, e) => {
    e.stopPropagation();
    const updated = threads.filter(t => t.id !== id);
    setThreads(updated);
    if (updated.length > 0) {
      if (activeThreadId === id) {
        setActiveThreadId(updated[0].id);
      }
    } else {
      localStorage.removeItem("copilot_threads");
      createNewThread();
    }
  };

  const fetchDocuments = async () => {
    try {
      const res = await axios.get("/api/copilot/documents");
      setDocuments(res.data);
    } catch (err) {
      console.error("Error fetching documents:", err);
    }
  };

  // 1b. Load sanitization config on mount
  useEffect(() => {
    async function loadSanitizationConfig() {
      try {
        const res = await axios.get("/api/copilot/sanitization/config");
        if (res.data) {
          setSanitizationConfig(res.data);
        }
      } catch (err) {
        console.error("Error fetching sanitization config:", err);
      }
    }
    loadSanitizationConfig();
  }, []);

  const handleRuleToggle = (ruleName, checked) => {
    setSanitizationConfig(prev => ({
      ...prev,
      rules: {
        ...prev.rules,
        [ruleName]: checked
      }
    }));
  };

  const addCustomTerm = () => {
    const term = newCustomTerm.trim();
    if (!term) return;
    if (sanitizationConfig.custom_terms.includes(term)) return;
    setSanitizationConfig(prev => ({
      ...prev,
      custom_terms: [...prev.custom_terms, term]
    }));
    setNewCustomTerm("");
  };

  const removeCustomTerm = (termToRemove) => {
    setSanitizationConfig(prev => ({
      ...prev,
      custom_terms: prev.custom_terms.filter(t => t !== termToRemove)
    }));
  };

  const addCustomRegex = () => {
    const regex = newCustomRegex.trim();
    if (!regex) return;
    if (sanitizationConfig.custom_regexes.includes(regex)) return;
    setSanitizationConfig(prev => ({
      ...prev,
      custom_regexes: [...prev.custom_regexes, regex]
    }));
    setNewCustomRegex("");
  };

  const removeCustomRegex = (regexToRemove) => {
    setSanitizationConfig(prev => ({
      ...prev,
      custom_regexes: prev.custom_regexes.filter(r => r !== regexToRemove)
    }));
  };

  const saveSanitizationConfig = async () => {
    try {
      setLoading(true);
      await axios.post("/api/copilot/sanitization/config", sanitizationConfig);
      alert("🛡️ Sanitization settings updated successfully!");
    } catch (err) {
      console.error(err);
      alert("❌ Failed to save sanitization settings.");
    } finally {
      setLoading(false);
    }
  };

  const handleUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append("file", file);

    setUploading(true);
    setErrorMsg("");
    try {
      await axios.post("/api/copilot/documents/upload", formData, {
        headers: {
          "Content-Type": "multipart/form-data"
        }
      });
      await fetchDocuments();
    } catch (err) {
      console.error("Upload failed:", err);
      setErrorMsg("Failed to upload document: " + (err.response?.data?.detail || err.message));
    } finally {
      setUploading(false);
      e.target.value = null;
    }
  };

  const handleDeleteDoc = async (filename) => {
    if (!window.confirm(`Are you sure you want to delete "${filename}"? This will remove it from the knowledgebase and Qdrant.`)) {
      return;
    }
    setErrorMsg("");
    try {
      await axios.delete(`/api/copilot/documents/${filename}`);
      setDisabledDocs(prev => {
        const next = new Set(prev);
        next.delete(filename);
        return next;
      });
      await fetchDocuments();
    } catch (err) {
      console.error("Delete failed:", err);
      setErrorMsg("Failed to delete document: " + (err.response?.data?.detail || err.message));
    }
  };

  const toggleDoc = (filename) => {
    setDisabledDocs(prev => {
      const next = new Set(prev);
      if (next.has(filename)) {
        next.delete(filename);
      } else {
        next.add(filename);
      }
      return next;
    });
  };

  const formatBytes = (bytes, decimals = 1) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
  };

  const getActiveThread = () => {
    return threads.find(t => t.id === activeThreadId) || { messages: [] };
  };

  const handleSendMessage = async (textToSend) => {
    const msg = textToSend || inputMessage;
    if (!msg.trim()) return;

    const activeThread = threads.find(t => t.id === activeThreadId);
    if (!activeThread) return;
    const updatedMessages = [...activeThread.messages, { role: "user", content: msg }];

    // Add user message and assistant placeholder to thread
    setThreads(prev => prev.map(t => {
      if (t.id === activeThreadId) {
        const name = t.name === "New Network Chat Thread" ? msg.substring(0, 30) + (msg.length > 30 ? "..." : "") : t.name;
        return {
          ...t,
          name,
          messages: [
            ...t.messages,
            { role: "user", content: msg },
            { role: "assistant", content: "" }
          ]
        };
      }
      return t;
    }));

    setInputMessage("");
    setLoading(true);
    setErrorMsg("");

    try {
      const response = await fetch("/api/copilot/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          messages: updatedMessages,
          conversation_id: activeThreadId,
          mode: chatMode,
          model: selectedModel || undefined,
          disabled_docs: Array.from(disabledDocs)
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(errText || `Server returned status ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let done = false;
      let accumulatedText = "";

      // Hide the spinner once streaming starts
      setLoading(false);

      while (!done) {
        const { value, done: doneReading } = await reader.read();
        done = doneReading;
        if (value) {
          const chunk = decoder.decode(value, { stream: !done });
          accumulatedText += chunk;
          
          setThreads(prev => prev.map(t => {
            if (t.id === activeThreadId) {
              const msgs = [...t.messages];
              if (msgs.length > 0 && msgs[msgs.length - 1].role === "assistant") {
                msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], content: accumulatedText };
              }
              return { ...t, messages: msgs };
            }
            return t;
          }));
        }
      }

    } catch (err) {
      console.error(err);
      setErrorMsg(err.message || "Network error communicating with AI Copilot service. Verify containers are active.");
      
      // Clean up empty assistant message if it failed before streaming anything
      setThreads(prev => prev.map(t => {
        if (t.id === activeThreadId) {
          const msgs = [...t.messages];
          if (msgs.length > 0 && msgs[msgs.length - 1].role === "assistant" && msgs[msgs.length - 1].content === "") {
            msgs.pop();
          }
          return { ...t, messages: msgs };
        }
        return t;
      }));
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    alert("Configuration code block copied to clipboard!");
  };

  // Modern High-Fidelity Markdown Parser supporting Tables, Code, Lists, Bold tags
  const renderMarkdown = (text) => {
    if (!text) return null;
    
    // Separate by fenced code blocks
    const parts = text.split(/(```[\s\S]*?```)/g);
    
    return parts.map((part, idx) => {
      if (part.startsWith("```")) {
        const lines = part.split("\n");
        const lang = lines[0].replace("```", "").trim() || "text";
        const code = lines.slice(1, -1).join("\n");
        
        return (
          <div key={idx} style={styles.codeSection}>
            <div style={styles.codeHeader}>
              <span>🚀 {lang.toUpperCase()} CONFIGURATION</span>
              <button onClick={() => copyToClipboard(code)} style={styles.copyBtn}>
                📋 Copy
              </button>
            </div>
            <pre style={styles.preCode}>
              <code>{code}</code>
            </pre>
          </div>
        );
      }
      
      const lines = part.split("\n");
      let inTable = false;
      let tableRows = [];
      let elements = [];
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        // Match Markdown Grid Tables: | ID | Hostname | IP Address |
        if (line.trim().startsWith("|") && line.trim().endsWith("|")) {
          inTable = true;
          if (line.includes("---")) continue; // skip dividers
          
          const cols = line.split("|").slice(1, -1).map(c => c.trim());
          tableRows.push(cols);
          continue;
        } else {
          if (inTable && tableRows.length > 0) {
            const rows = [...tableRows];
            tableRows = [];
            inTable = false;
            
            elements.push(
              <div key={`table-${i}`} style={styles.tableScroll}>
                <table style={styles.table}>
                  <thead>
                    <tr style={styles.tableHeaderRow}>
                      {rows[0].map((col, cIdx) => (
                        <th key={cIdx} style={styles.tableHeaderCell}>
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(1).map((row, rIdx) => (
                      <tr key={rIdx} style={{
                        ...styles.tableRow,
                        backgroundColor: rIdx % 2 === 0 ? "transparent" : "rgba(255,255,255,0.02)"
                      }}>
                        {row.map((col, cIdx) => (
                          <td key={cIdx} style={styles.tableCell}>
                            {col.startsWith("**") && col.endsWith("**") ? (
                              <strong>{col.replace(/\*\*/g, "")}</strong>
                            ) : col}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          }
        }
        
        // Match standard markdown typography
        if (line.startsWith("###")) {
          elements.push(<h4 key={i} style={styles.mdH4}>{line.replace("###", "").trim()}</h4>);
        } else if (line.startsWith("##")) {
          elements.push(<h3 key={i} style={styles.mdH3}>{line.replace("##", "").trim()}</h3>);
        } else if (line.startsWith("#")) {
          elements.push(<h2 key={i} style={styles.mdH2}>{line.replace("#", "").trim()}</h2>);
        } else if (line.startsWith("- ") || line.startsWith("* ")) {
          elements.push(<li key={i} style={styles.mdLi}>{line.substring(2)}</li>);
        } else if (line.trim() !== "") {
          const segments = line.split(/(\*\*.*?\*\*)/g);
          const renderedP = segments.map((seg, sIdx) => {
            if (seg.startsWith("**") && seg.endsWith("**")) {
              return <strong key={sIdx} style={{ color: "#fff" }}>{seg.replace(/\*\*/g, "")}</strong>;
            }
            return seg;
          });
          elements.push(<p key={i} style={styles.mdP}>{renderedP}</p>);
        }
      }
      
      // Handle remaining tables
      if (inTable && tableRows.length > 0) {
        const rows = [...tableRows];
        elements.push(
          <div key="table-end" style={styles.tableScroll}>
            <table style={styles.table}>
              <thead>
                <tr style={styles.tableHeaderRow}>
                  {rows[0].map((col, cIdx) => (
                    <th key={cIdx} style={styles.tableHeaderCell}>
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice(1).map((row, rIdx) => (
                  <tr key={rIdx} style={{
                    ...styles.tableRow,
                    backgroundColor: rIdx % 2 === 0 ? "transparent" : "rgba(255,255,255,0.02)"
                  }}>
                    {row.map((col, cIdx) => (
                      <td key={cIdx} style={styles.tableCell}>
                        {col.startsWith("**") && col.endsWith("**") ? (
                          <strong>{col.replace(/\*\*/g, "")}</strong>
                        ) : col}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      }
      
      return <React.Fragment key={idx}>{elements}</React.Fragment>;
    });
  };

  const handleChipClick = (action) => {
    let query = "";
    if (action === "nodes") query = "List all available nodes";
    if (action === "backups") query = "List all available backups";
    if (action === "health") query = "List all available healthchecks";
    handleSendMessage(query);
  };

  return (
    <div style={styles.container}>
      {/* SIDEBAR: Saved Threads Panel */}
      <div style={styles.leftPanel}>
        <div style={styles.panelHeader}>
          <div style={styles.titleRow}>
            <span style={{ fontSize: "20px" }}>🤖</span>
            <h2 style={styles.panelTitle}>AI Network Agent</h2>
          </div>
          <div style={styles.healthRow}>
            <span style={{
              ...styles.healthDot,
              backgroundColor: healthStatus === "online" ? "#2ea44f" : healthStatus === "offline" ? "#da3633" : "#f1e05a"
            }} />
            <span style={styles.healthText}>
              Ollama: {healthStatus.toUpperCase()}
            </span>
          </div>
        </div>

        <div style={styles.tabRow}>
          <button
            onClick={() => setActiveSidebarTab("threads")}
            className="kb-tab-btn"
            style={{
              ...styles.tabBtn,
              borderBottom: activeSidebarTab === "threads" ? "2px solid #58a6ff" : "none",
              color: activeSidebarTab === "threads" ? "#fff" : "#8b949e"
            }}
          >
            💬 Chat Threads
          </button>
          <button
            onClick={() => setActiveSidebarTab("kb")}
            className="kb-tab-btn"
            style={{
              ...styles.tabBtn,
              borderBottom: activeSidebarTab === "kb" ? "2px solid #58a6ff" : "none",
              color: activeSidebarTab === "kb" ? "#fff" : "#8b949e"
            }}
          >
            📚 Knowledge Base
          </button>
          <button
            onClick={() => setActiveSidebarTab("sanitization")}
            className="kb-tab-btn"
            style={{
              ...styles.tabBtn,
              borderBottom: activeSidebarTab === "sanitization" ? "2px solid #58a6ff" : "none",
              color: activeSidebarTab === "sanitization" ? "#fff" : "#8b949e"
            }}
          >
            🛡️ Sanitization
          </button>
          <button
            onClick={() => { setActiveSidebarTab("itsm"); fetchTickets(); }}
            className="kb-tab-btn"
            style={{
              ...styles.tabBtn,
              borderBottom: activeSidebarTab === "itsm" ? "2px solid #58a6ff" : "none",
              color: activeSidebarTab === "itsm" ? "#fff" : "#8b949e"
            }}
          >
            🎟️ ITSM
          </button>
          <button
            onClick={() => { setActiveSidebarTab("benchmark"); if (benchmarkGroups.length === 0) fetchBenchmarkGroups(); }}
            className="kb-tab-btn"
            style={{
              ...styles.tabBtn,
              borderBottom: activeSidebarTab === "benchmark" ? "2px solid #f1e05a" : "none",
              color: activeSidebarTab === "benchmark" ? "#f1e05a" : "#8b949e"
            }}
          >
            🧪 Benchmark
          </button>
        </div>

        {activeSidebarTab === "threads" && (
          <>
            <button onClick={createNewThread} style={styles.newThreadBtn}>
              ➕ New Network Chat Thread
            </button>

            <div style={styles.threadList}>
              {threads.map((thread) => (
                <div
                  key={thread.id}
                  onClick={() => setActiveThreadId(thread.id)}
                  style={{
                    ...styles.threadCard,
                    backgroundColor: activeThreadId === thread.id ? "rgba(255,255,255,0.06)" : "transparent",
                    borderColor: activeThreadId === thread.id ? "rgba(255,255,255,0.12)" : "transparent"
                  }}
                >
                  <div style={styles.threadCardName}>💬 {thread.name}</div>
                  <button
                    onClick={(e) => deleteThread(thread.id, e)}
                    style={styles.deleteThreadBtn}
                    title="Delete chat thread"
                  >
                    🗑️
                  </button>
                </div>
              ))}
            </div>
          </>
        )}

        {activeSidebarTab === "kb" && (
          <div style={styles.kbContainer}>
            <div style={styles.uploadBox}>
              <label className="kb-upload-label" style={styles.uploadLabel}>
                {uploading ? "⏳ Syncing Qdrant..." : "📁 Upload PDF/TXT Document"}
                <input
                  type="file"
                  accept=".pdf,.txt"
                  onChange={handleUpload}
                  disabled={uploading}
                  style={{ display: "none" }}
                />
              </label>
            </div>
            
            <div style={styles.docListTitle}>
              <span>Indexed Documents</span>
              <button onClick={fetchDocuments} className="kb-refresh-btn" style={styles.refreshBtn} title="Refresh Document List">
                🔄
              </button>
            </div>
            
            <div style={styles.docList}>
              {documents.length === 0 ? (
                <div style={styles.emptyDocs}>No documents uploaded yet.</div>
              ) : (
                documents.map((doc) => {
                  const isEnabled = !disabledDocs.has(doc.filename);
                  return (
                    <div key={doc.filename} className="kb-doc-card" style={styles.docCard}>
                      <div style={styles.docLeft}>
                        <input
                          type="checkbox"
                          checked={isEnabled}
                          onChange={() => toggleDoc(doc.filename)}
                          style={styles.docCheckbox}
                          title={isEnabled ? "Exclude from RAG query" : "Include in RAG query"}
                        />
                      </div>
                      <div style={styles.docMiddle}>
                        <div style={styles.docName} title={doc.filename}>
                          {doc.filename}
                        </div>
                        <div style={styles.docMeta}>
                          {formatBytes(doc.size_bytes)} • {doc.chunk_count} chunks
                        </div>
                      </div>
                      <div style={styles.docRight}>
                        <a
                          href={`/api/copilot/documents/download/${encodeURIComponent(doc.filename)}`}
                          download
                          className="kb-doc-action-btn"
                          style={styles.docActionBtn}
                          title="Download document"
                        >
                          📥
                        </a>
                        <button
                          onClick={() => handleDeleteDoc(doc.filename)}
                          className="kb-doc-delete-btn"
                          style={styles.docDeleteBtn}
                          title="Delete document"
                        >
                          🗑️
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {activeSidebarTab === "sanitization" && (
          <div style={styles.sanitizationContainer}>
            <div style={styles.sectionHeader}>🛡️ Dynamic Sanitization Rules</div>
            
            <div style={styles.configCard}>
              <div style={styles.configRow}>
                <input
                  type="checkbox"
                  id="mask_ips"
                  checked={sanitizationConfig.rules?.mask_ips}
                  onChange={(e) => handleRuleToggle("mask_ips", e.target.checked)}
                  style={styles.configCheckbox}
                />
                <label htmlFor="mask_ips" style={styles.configLabel}>
                  <strong>Mask IP Addresses</strong>
                  <div style={styles.configDesc}>Tokenizes all IPv4 addresses (e.g. 203.0.113.10)</div>
                </label>
              </div>
              
              <div style={styles.configRow}>
                <input
                  type="checkbox"
                  id="mask_hostnames"
                  checked={sanitizationConfig.rules?.mask_hostnames}
                  onChange={(e) => handleRuleToggle("mask_hostnames", e.target.checked)}
                  style={styles.configCheckbox}
                />
                <label htmlFor="mask_hostnames" style={styles.configLabel}>
                  <strong>Mask Device Hostnames</strong>
                  <div style={styles.configDesc}>Tokenizes router hostnames (e.g. demo-switch-01)</div>
                </label>
              </div>
              
              <div style={styles.configRow}>
                <input
                  type="checkbox"
                  id="mask_commands"
                  checked={sanitizationConfig.rules?.mask_commands}
                  onChange={(e) => handleRuleToggle("mask_commands", e.target.checked)}
                  style={styles.configCheckbox}
                />
                <label htmlFor="mask_commands" style={styles.configLabel}>
                  <strong>Mask CLI Commands</strong>
                  <div style={styles.configDesc}>Tokenizes CLI config and diagnostics</div>
                </label>
              </div>
              
              <div style={styles.configRow}>
                <input
                  type="checkbox"
                  id="mask_emails"
                  checked={sanitizationConfig.rules?.mask_emails}
                  onChange={(e) => handleRuleToggle("mask_emails", e.target.checked)}
                  style={styles.configCheckbox}
                />
                <label htmlFor="mask_emails" style={styles.configLabel}>
                  <strong>Mask Email Addresses</strong>
                  <div style={styles.configDesc}>Tokenizes contact email addresses</div>
                </label>
              </div>
            </div>

            <div style={styles.sectionHeader}>✍️ Custom Masking Words</div>
            <div style={styles.inputGroup}>
              <input
                type="text"
                placeholder="Add custom word (e.g. secret-vlan)"
                value={newCustomTerm}
                onChange={(e) => setNewCustomTerm(e.target.value)}
                style={styles.inlineInput}
                onKeyDown={(e) => { if (e.key === "Enter") addCustomTerm(); }}
              />
              <button onClick={addCustomTerm} style={styles.inlineAddBtn}>Add</button>
            </div>
            <div style={styles.tagContainer}>
              {sanitizationConfig.custom_terms?.map((term, i) => (
                <span key={i} style={styles.tag}>
                  {term}
                  <button onClick={() => removeCustomTerm(term)} style={styles.tagCloseBtn}>&times;</button>
                </span>
              ))}
              {(!sanitizationConfig.custom_terms || sanitizationConfig.custom_terms.length === 0) && (
                <div style={styles.emptyDesc}>No custom words added yet.</div>
              )}
            </div>

            <div style={styles.sectionHeader}>🔬 Custom Regular Expressions</div>
            <div style={styles.inputGroup}>
              <input
                type="text"
                placeholder="Add custom regex (e.g. \\bVLAN_\\d+\\b)"
                value={newCustomRegex}
                onChange={(e) => setNewCustomRegex(e.target.value)}
                style={styles.inlineInput}
                onKeyDown={(e) => { if (e.key === "Enter") addCustomRegex(); }}
              />
              <button onClick={addCustomRegex} style={styles.inlineAddBtn}>Add</button>
            </div>
            <div style={styles.tagContainer}>
              {sanitizationConfig.custom_regexes?.map((reg, i) => (
                <span key={i} style={{ ...styles.tag, backgroundColor: "rgba(255,165,0,0.1)", borderColor: "rgba(255,165,0,0.3)" }}>
                  <code>{reg}</code>
                  <button onClick={() => removeCustomRegex(reg)} style={styles.tagCloseBtn}>&times;</button>
                </span>
              ))}
              {(!sanitizationConfig.custom_regexes || sanitizationConfig.custom_regexes.length === 0) && (
                <div style={styles.emptyDesc}>No custom regex patterns added yet.</div>
              )}
            </div>

            <button onClick={saveSanitizationConfig} style={styles.saveConfigBtn}>
              💾 Save Sanitization Configuration
            </button>
          </div>
        )}

        {activeSidebarTab === "benchmark" && (
          <div style={styles.benchmarkContainer}>
            <div style={styles.sectionHeader}>🧪 Intent Classifier Benchmark</div>

            {/* Group selection */}
            <div style={styles.benchmarkGroupList}>
              {benchmarkGroups.length === 0 ? (
                <div style={styles.emptyDocs}>Loading groups…</div>
              ) : (
                benchmarkGroups.map(g => (
                  <div key={g.id} style={styles.benchmarkGroupRow}>
                    <input
                      type="checkbox"
                      checked={selectedBenchmarkGroups.has(g.id)}
                      onChange={() => toggleBenchmarkGroup(g.id)}
                      style={styles.docCheckbox}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={styles.benchmarkGroupName}>{g.id} — {g.name}</div>
                      <div style={styles.docMeta}>{g.case_count} cases · intent: {g.intent || "mixed"}</div>
                    </div>
                    {/* Show per-group pass rate badge if results exist */}
                    {benchmarkResults && (() => {
                      const gr = benchmarkResults.groups.find(x => x.id === g.id);
                      if (!gr) return null;
                      const color = gr.pass_rate === 100 ? "#3fb950" : gr.pass_rate >= 60 ? "#db6d28" : "#f85149";
                      return (
                        <span style={{ ...styles.ticketStatus, color, backgroundColor: color + "1a", minWidth: "42px", textAlign: "center" }}>
                          {gr.pass_rate}%
                        </span>
                      );
                    })()}
                  </div>
                ))
              )}
            </div>

            {/* Action buttons */}
            <div style={styles.benchmarkActions}>
              <button
                onClick={() => setSelectedBenchmarkGroups(new Set(benchmarkGroups.map(g => g.id)))}
                style={styles.inlineAddBtn}
                disabled={benchmarkRunning}
              >All</button>
              <button
                onClick={() => setSelectedBenchmarkGroups(new Set())}
                style={styles.inlineAddBtn}
                disabled={benchmarkRunning}
              >None</button>
              <button
                onClick={() => runBenchmark(false)}
                style={{ ...styles.saveConfigBtn, margin: 0, flex: 1, padding: "8px", fontSize: "12px" }}
                disabled={benchmarkRunning || selectedBenchmarkGroups.size === 0}
              >
                {benchmarkRunning ? "⏳ Running…" : "▶ Run Selected"}
              </button>
            </div>

            {/* Overall progress bar */}
            {benchmarkResults && (
              <div style={styles.benchmarkSummary}>
                <div style={styles.benchmarkSummaryRow}>
                  <span style={{ fontSize: "12px", color: "#c9d1d9" }}>Overall</span>
                  <span style={{ fontSize: "13px", fontWeight: "700", color: benchmarkResults.overall_pass_rate === 100 ? "#3fb950" : benchmarkResults.overall_pass_rate >= 60 ? "#db6d28" : "#f85149" }}>
                    {benchmarkResults.overall_pass_rate}% ({benchmarkResults.total_passed}/{benchmarkResults.total_cases})
                  </span>
                </div>
                <div style={styles.progressTrack}>
                  <div style={{
                    ...styles.progressFill,
                    width: `${benchmarkResults.overall_pass_rate}%`,
                    backgroundColor: benchmarkResults.overall_pass_rate === 100 ? "#3fb950" : benchmarkResults.overall_pass_rate >= 60 ? "#db6d28" : "#f85149"
                  }} />
                </div>
                <div style={{ fontSize: "10px", color: "#8b949e", marginTop: "4px" }}>
                  Run at {new Date(benchmarkResults.run_at).toLocaleString()}
                </div>

                {/* Per-group expandable results */}
                <div style={{ marginTop: "12px" }}>
                  {benchmarkResults.groups.map(gr => (
                    <div key={gr.id} style={styles.benchmarkGroupResult}>
                      <div
                        style={styles.benchmarkGroupResultHeader}
                        onClick={() => setExpandedBenchmarkGroup(expandedBenchmarkGroup === gr.id ? null : gr.id)}
                      >
                        <span style={{ fontSize: "11px", color: "#c9d1d9", flex: 1 }}>
                          {expandedBenchmarkGroup === gr.id ? "▼" : "▶"} {gr.id} {gr.name}
                        </span>
                        <span style={{
                          fontSize: "11px",
                          fontWeight: "700",
                          color: gr.pass_rate === 100 ? "#3fb950" : gr.pass_rate >= 60 ? "#db6d28" : "#f85149"
                        }}>
                          {gr.passed}/{gr.total}
                        </span>
                      </div>

                      {expandedBenchmarkGroup === gr.id && (
                        <div style={styles.benchmarkCaseList}>
                          {gr.cases.map(c => (
                            <div key={c.id} style={{
                              ...styles.benchmarkCaseRow,
                              borderLeft: `2px solid ${c.passed ? "#3fb950" : "#f85149"}`
                            }}>
                              <div style={{ fontSize: "11px", color: c.passed ? "#3fb950" : "#f85149", fontWeight: "600" }}>
                                {c.passed ? "✓" : "✗"} {c.id}
                              </div>
                              <div style={{ fontSize: "11px", color: "#8b949e", marginTop: "2px" }}>
                                {c.query}
                              </div>
                              {!c.passed && (
                                <div style={{ fontSize: "10px", color: "#ff7b72", marginTop: "3px" }}>
                                  {!c.intent_pass && `intent: ${c.expected_intent} → ${c.actual_intent || "null"}`}
                                  {!c.intent_pass && !c.device_pass && " | "}
                                  {!c.device_pass && `device: ${c.expected_device} → ${c.actual_device || "null"}`}
                                  {c.error && `error: ${c.error}`}
                                </div>
                              )}
                              <div style={{ fontSize: "10px", color: "#484f58", marginTop: "2px" }}>
                                {c.elapsed_ms}ms
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {activeSidebarTab === "itsm" && (
          <div style={styles.itsmContainer}>
            <div style={styles.sectionHeader}>🎟️ Change Management (Mock ITSM)</div>
            
            <div style={styles.ticketForm}>
              <div style={{ ...styles.sectionHeader, marginTop: 0, fontSize: "11px" }}>Create Change Request</div>
              <div style={styles.formRow}>
                <input
                  type="text"
                  placeholder="Device Hostname/IP (e.g. demo-router-01)"
                  value={newTicketDevice}
                  onChange={(e) => setNewTicketDevice(e.target.value)}
                  style={styles.formInput}
                />
              </div>
              <div style={{ ...styles.formRow, marginTop: "8px" }}>
                <select
                  value={newTicketAction}
                  onChange={(e) => setNewTicketAction(e.target.value)}
                  style={styles.formSelect}
                >
                  <option value="run_config_backup">run_config_backup</option>
                  <option value="run_automation_flow">run_automation_flow</option>
                  <option value="ssh_config_command">ssh_config_command</option>
                  <option value="cicd_trigger_job">cicd_trigger_job</option>
                </select>
              </div>
              <div style={{ ...styles.formRow, marginTop: "8px" }}>
                <input
                  type="text"
                  placeholder="Ticket Description / Reason"
                  value={newTicketDesc}
                  onChange={(e) => setNewTicketDesc(e.target.value)}
                  style={styles.formInput}
                />
              </div>
              <button onClick={createTicket} style={styles.createTicketBtn}>
                Create Ticket (Pending)
              </button>
            </div>
            
            <div style={styles.docListTitle}>
              <span>Active Change Tickets</span>
              <button onClick={fetchTickets} className="kb-refresh-btn" style={styles.refreshBtn} title="Refresh Tickets">
                🔄
              </button>
            </div>
            
            <div style={styles.ticketList}>
              {tickets.length === 0 ? (
                <div style={styles.emptyDocs}>No Change Requests created yet.</div>
              ) : (
                tickets.map((t) => (
                  <div key={t.ticket_id} style={styles.ticketCard}>
                    <div style={styles.ticketHeader}>
                      <span style={styles.ticketId}>{t.ticket_id}</span>
                      <span style={{
                        ...styles.ticketStatus,
                        color: t.status === "Approved" ? "#3fb950" : t.status === "Rejected" ? "#f85149" : "#db6d28",
                        backgroundColor: t.status === "Approved" ? "rgba(63,185,80,0.1)" : t.status === "Rejected" ? "rgba(248,81,73,0.1)" : "rgba(219,109,40,0.1)"
                      }}>{t.status}</span>
                    </div>
                    <div style={styles.ticketMeta}>
                      <strong>Device</strong>: {t.device_name}<br/>
                      <strong>Action</strong>: <code>{t.action_type}</code><br/>
                      <strong>Desc</strong>: {t.description}
                    </div>
                    {t.status === "Pending" && (
                      <div style={styles.ticketActions}>
                        <button onClick={() => approveTicket(t.ticket_id)} style={styles.approveBtn}>
                          Approve
                        </button>
                        <button onClick={() => rejectTicket(t.ticket_id)} style={styles.rejectBtn}>
                          Reject
                        </button>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {/* RIGHT PANEL: Conversational Feed */}
      <div style={styles.rightPanel}>
        {/* Messages list */}
        <div ref={chatFeedRef} style={styles.chatFeed}>
          {getActiveThread().messages.map((msg, idx) => (
            <div
              key={idx}
              style={{
                ...styles.chatRow,
                justifyContent: msg.role === "user" ? "flex-end" : "flex-start"
              }}
            >
              <div style={{
                ...styles.chatBubble,
                backgroundColor: msg.role === "user" ? "rgba(46, 164, 79, 0.05)" : "rgba(255,255,255,0.03)",
                border: msg.role === "user" ? "1px solid rgba(46, 164, 79, 0.2)" : "1px solid rgba(255,255,255,0.08)"
              }}>
                <div style={{
                  ...styles.bubbleRole,
                  color: msg.role === "user" ? "#2ea44f" : "#58a6ff"
                }}>
                  {msg.role === "user" ? "👤 User Operator" : `🤖 AI Network Assistant${chatMode === "ollama_model" && selectedModel ? ` (${selectedModel})` : ""}`}
                </div>
                <div style={styles.bubbleText}>
                  {renderMarkdown(msg.content)}
                </div>
              </div>
            </div>
          ))}

          {loading && (
            <div style={{ ...styles.chatRow, justifyContent: "flex-start" }}>
              <div style={{ ...styles.chatBubble, backgroundColor: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}>
                <div style={styles.bubbleRole}>🤖 AI Network Assistant</div>
                <div style={styles.loaderContainer}>
                  <div style={styles.spinner} />
                  <span style={styles.loaderText}>Copilot is evaluating networks...</span>
                </div>
              </div>
            </div>
          )}

          {errorMsg && (
            <div style={styles.errorCard}>
              <h4 style={styles.errorTitle}>⚠️ Connection Issue</h4>
              <p style={styles.errorText}>{errorMsg}</p>
            </div>
          )}

        </div>

        {/* Action input bar */}
        <div style={styles.bottomArea}>
          <div style={styles.modeRow}>
            <button 
              onClick={() => setChatMode("copilot_only")} 
              style={{
                ...styles.modeBtn,
                backgroundColor: chatMode === "copilot_only" ? "rgba(46, 164, 79, 0.12)" : "transparent",
                borderColor: chatMode === "copilot_only" ? "#2ea44f" : "rgba(255,255,255,0.06)",
                color: chatMode === "copilot_only" ? "#fff" : "#8b949e",
              }}
            >
              🤖 Copilot Only
            </button>
            <button 
              onClick={() => setChatMode("ollama_model")} 
              style={{
                ...styles.modeBtn,
                backgroundColor: chatMode === "ollama_model" ? "rgba(88, 166, 255, 0.12)" : "transparent",
                borderColor: chatMode === "ollama_model" ? "#58a6ff" : "rgba(255,255,255,0.06)",
                color: chatMode === "ollama_model" ? "#fff" : "#8b949e",
              }}
            >
              🧠 Local AI Mode
            </button>
            {chatMode === "ollama_model" && availableModels.length > 0 && (
              <select
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                style={styles.modelSelect}
              >
                {availableModels.map((m) => (
                  <option key={m} value={m} style={styles.modelOption}>
                    {m.toLowerCase().includes("gemini") ? `✨ ${m}` : `🎯 ${m}`}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div style={styles.chipRow}>
            <button onClick={() => handleChipClick("nodes")} style={styles.chip}>📋 List Nodes</button>
            <button onClick={() => handleChipClick("backups")} style={styles.chip}>📂 List Backups</button>
            <button onClick={() => handleChipClick("health")} style={styles.chip}>🩺 List Healthchecks</button>
          </div>
          <div style={styles.inputContainer}>
            <textarea
              placeholder={chatMode === "copilot_only" ? "Direct Copilot command... (e.g. 'gigabitEthernet0/0/7 demo-switch-01' or 'list nodes')" : "Ask AI Copilot... (e.g. 'Why is GigabitEthernet0/0/7 down?' or 'OSPF metric demo-switch-01')"}
              value={inputMessage}
              onChange={(e) => setInputMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSendMessage();
                }
              }}
              style={styles.textarea}
              disabled={loading || (chatMode === "ollama_model" && healthStatus !== "online")}
            />
            <button
              onClick={() => handleSendMessage()}
              disabled={loading || (chatMode === "ollama_model" && healthStatus !== "online") || !inputMessage.trim()}
              style={{
                ...styles.sendBtn,
                opacity: (loading || (chatMode === "ollama_model" && healthStatus !== "online") || !inputMessage.trim()) ? 0.5 : 1
              }}
            >
              🚀 Send
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Design Styles (Rich, dark glassmorphism workspace theme)
// ---------------------------------------------------------------------------
const styles = {
  container: {
    display: "flex",
    width: "100%",
    height: "100vh",
    backgroundColor: "#0d1117",
    color: "#c9d1d9",
    overflow: "hidden"
  },
  leftPanel: {
    width: "25%",
    minWidth: "260px",
    borderRight: "1px solid rgba(255,255,255,0.08)",
    backgroundColor: "#161b22",
    display: "flex",
    flexDirection: "column",
    padding: "16px"
  },
  tabRow: {
    display: "flex",
    borderBottom: "1px solid rgba(255,255,255,0.08)",
    marginBottom: "16px"
  },
  tabBtn: {
    flex: 1,
    padding: "10px 0",
    backgroundColor: "transparent",
    border: "none",
    fontSize: "13px",
    fontWeight: "600",
    cursor: "pointer",
    textAlign: "center",
    transition: "color 0.2s, border-bottom-color 0.2s",
    outline: "none"
  },
  kbContainer: {
    display: "flex",
    flexDirection: "column",
    flex: 1,
    overflow: "hidden"
  },
  uploadBox: {
    marginBottom: "16px"
  },
  uploadLabel: {
    display: "block",
    width: "100%",
    backgroundColor: "rgba(88, 166, 255, 0.1)",
    border: "1px dashed rgba(88, 166, 255, 0.3)",
    borderRadius: "6px",
    color: "#58a6ff",
    padding: "12px",
    fontSize: "13px",
    fontWeight: "600",
    textAlign: "center",
    cursor: "pointer",
    transition: "background-color 0.2s, border-color 0.2s"
  },
  docListTitle: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    fontSize: "12px",
    color: "#8b949e",
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: "0.5px",
    marginBottom: "10px",
    borderBottom: "1px solid rgba(255,255,255,0.04)",
    paddingBottom: "6px"
  },
  refreshBtn: {
    background: "none",
    border: "none",
    cursor: "pointer",
    color: "#8b949e",
    fontSize: "12px",
    padding: "2px",
    transition: "color 0.2s"
  },
  docList: {
    flex: 1,
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
    gap: "10px"
  },
  emptyDocs: {
    fontSize: "12px",
    color: "#8b949e",
    textAlign: "center",
    padding: "20px 0"
  },
  docCard: {
    display: "flex",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.02)",
    border: "1px solid rgba(255,255,255,0.06)",
    borderRadius: "6px",
    padding: "8px 10px",
    gap: "8px",
    transition: "border-color 0.2s, background-color 0.2s"
  },
  docLeft: {
    display: "flex",
    alignItems: "center"
  },
  docCheckbox: {
    width: "14px",
    height: "14px",
    cursor: "pointer",
    accentColor: "#58a6ff"
  },
  docMiddle: {
    flex: 1,
    minWidth: 0
  },
  docName: {
    fontSize: "12px",
    fontWeight: "600",
    color: "#c9d1d9",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis"
  },
  docMeta: {
    fontSize: "10px",
    color: "#8b949e",
    marginTop: "2px"
  },
  docRight: {
    display: "flex",
    alignItems: "center",
    gap: "6px"
  },
  docActionBtn: {
    background: "none",
    border: "none",
    cursor: "pointer",
    color: "#58a6ff",
    fontSize: "13px",
    padding: "4px",
    textDecoration: "none",
    lineHeight: 1,
    display: "inline-flex",
    alignItems: "center",
    transition: "transform 0.2s"
  },
  docDeleteBtn: {
    background: "none",
    border: "none",
    cursor: "pointer",
    color: "#ff7b72",
    fontSize: "13px",
    padding: "4px",
    lineHeight: 1,
    display: "inline-flex",
    alignItems: "center",
    transition: "transform 0.2s"
  },
  panelHeader: {
    paddingBottom: "16px",
    borderBottom: "1px solid rgba(255,255,255,0.08)",
    marginBottom: "16px"
  },
  titleRow: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    marginBottom: "8px"
  },
  panelTitle: {
    fontSize: "18px",
    fontWeight: "600",
    color: "#fff",
    margin: 0
  },
  healthRow: {
    display: "flex",
    alignItems: "center",
    gap: "8px"
  },
  healthDot: {
    width: "8px",
    height: "8px",
    borderRadius: "50%"
  },
  healthText: {
    fontSize: "11px",
    color: "#8b949e"
  },
  newThreadBtn: {
    width: "100%",
    backgroundColor: "rgba(255,255,255,0.05)",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: "6px",
    color: "#fff",
    padding: "10px",
    fontSize: "13px",
    fontWeight: "600",
    cursor: "pointer",
    transition: "background-color 0.2s, border-color 0.2s",
    marginBottom: "20px",
    textAlign: "center"
  },
  threadList: {
    flex: 1,
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
    gap: "8px"
  },
  threadCard: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "10px 12px",
    borderRadius: "6px",
    border: "1px solid transparent",
    cursor: "pointer",
    transition: "background-color 0.2s, border-color 0.2s"
  },
  threadCardName: {
    fontSize: "12px",
    color: "#c9d1d9",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    maxWidth: "180px",
    fontWeight: "500"
  },
  deleteThreadBtn: {
    backgroundColor: "transparent",
    border: "none",
    color: "#ff7b72",
    cursor: "pointer",
    fontSize: "12px",
    padding: "2px",
    opacity: 0.7,
    transition: "opacity 0.2s"
  },
  rightPanel: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    backgroundColor: "#0d1117",
    overflow: "hidden"
  },
  chatFeed: {
    flex: 1,
    overflowY: "auto",
    padding: "24px",
    display: "flex",
    flexDirection: "column",
    gap: "18px"
  },
  chatRow: {
    display: "flex",
    width: "100%"
  },
  chatBubble: {
    maxWidth: "80%",
    padding: "16px",
    borderRadius: "12px",
    display: "flex",
    flexDirection: "column",
    gap: "8px"
  },
  bubbleRole: {
    fontSize: "11px",
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: "0.5px"
  },
  bubbleText: {
    display: "flex",
    flexDirection: "column",
    gap: "10px"
  },
  mdH2: {
    fontSize: "16px",
    fontWeight: "600",
    color: "#fff",
    marginTop: "12px",
    borderBottom: "1px solid rgba(255,255,255,0.08)",
    paddingBottom: "6px"
  },
  mdH3: {
    fontSize: "14px",
    fontWeight: "600",
    color: "#58a6ff",
    marginTop: "8px"
  },
  mdH4: {
    fontSize: "13px",
    fontWeight: "600",
    color: "#fff",
    marginTop: "6px"
  },
  mdP: {
    fontSize: "13px",
    lineHeight: "1.6",
    color: "#c9d1d9",
    margin: 0
  },
  mdLi: {
    fontSize: "13px",
    lineHeight: "1.6",
    color: "#c9d1d9",
    marginLeft: "18px"
  },
  codeSection: {
    margin: "12px 0",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: "6px",
    overflow: "hidden",
    width: "100%"
  },
  codeHeader: {
    backgroundColor: "#161b22",
    padding: "8px 12px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    borderBottom: "1px solid rgba(255,255,255,0.08)",
    fontSize: "11px",
    color: "#8b949e",
    fontWeight: "600"
  },
  copyBtn: {
    backgroundColor: "#2ea44f",
    border: "none",
    borderRadius: "4px",
    color: "#fff",
    padding: "3px 8px",
    cursor: "pointer",
    fontSize: "10px",
    fontWeight: "600"
  },
  preCode: {
    margin: 0,
    padding: "12px",
    backgroundColor: "#05070a",
    overflowX: "auto",
    fontSize: "12px",
    color: "#8bc34a",
    fontFamily: "monospace",
    lineHeight: "1.5"
  },
  tableScroll: {
    overflowX: "auto",
    margin: "14px 0",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: "6px",
    width: "100%"
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: "12px"
  },
  tableHeaderRow: {
    backgroundColor: "rgba(255,255,255,0.03)",
    borderBottom: "2px solid rgba(255,255,255,0.08)"
  },
  tableHeaderCell: {
    padding: "8px 12px",
    textAlign: "left",
    color: "#fff",
    fontWeight: "600",
    borderRight: "1px solid rgba(255,255,255,0.08)"
  },
  tableRow: {
    borderBottom: "1px solid rgba(255,255,255,0.08)"
  },
  tableCell: {
    padding: "8px 12px",
    borderRight: "1px solid rgba(255,255,255,0.08)",
    color: "#c9d1d9"
  },
  loaderContainer: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    padding: "4px 0"
  },
  spinner: {
    width: "18px",
    height: "18px",
    border: "2px solid rgba(255,255,255,0.1)",
    borderTop: "2px solid #58a6ff",
    borderRadius: "50%",
    animation: "spin 1s linear infinite"
  },
  loaderText: {
    fontSize: "12px",
    color: "#8b949e",
    fontWeight: "500"
  },
  errorCard: {
    backgroundColor: "rgba(218, 54, 51, 0.08)",
    border: "1px solid #da3633",
    borderRadius: "8px",
    padding: "12px 16px",
    maxWidth: "80%",
    alignSelf: "flex-start"
  },
  errorTitle: {
    color: "#ff7b72",
    margin: "0 0 6px 0",
    fontSize: "13px",
    fontWeight: "600"
  },
  errorText: {
    fontSize: "12px",
    margin: 0,
    lineHeight: "1.4"
  },
  modeRow: {
    display: "flex",
    gap: "10px",
    marginBottom: "12px",
    borderBottom: "1px solid rgba(255,255,255,0.04)",
    paddingBottom: "12px",
    alignItems: "center"
  },
  modelSelect: {
    padding: "8px 12px",
    borderRadius: "6px",
    border: "1px solid rgba(255,255,255,0.12)",
    backgroundColor: "#161b22",
    color: "#fff",
    fontSize: "12px",
    fontWeight: "600",
    outline: "none",
    cursor: "pointer",
    transition: "border-color 0.2s",
    minWidth: "160px"
  },
  modelOption: {
    backgroundColor: "#161b22",
    color: "#fff"
  },
  modeBtn: {
    flex: 1,
    padding: "8px 16px",
    borderRadius: "6px",
    border: "1px solid",
    fontSize: "12px",
    fontWeight: "600",
    cursor: "pointer",
    transition: "all 0.2s ease",
    textAlign: "center"
  },
  bottomArea: {
    padding: "16px 24px 24px 24px",
    backgroundColor: "#0d1117",
    borderTop: "1px solid rgba(255,255,255,0.08)"
  },
  chipRow: {
    display: "flex",
    gap: "8px",
    marginBottom: "12px"
  },
  chip: {
    backgroundColor: "rgba(255,255,255,0.03)",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: "16px",
    color: "#c9d1d9",
    padding: "6px 14px",
    fontSize: "11px",
    fontWeight: "600",
    cursor: "pointer",
    transition: "background-color 0.2s, color 0.2s"
  },
  inputContainer: {
    display: "flex",
    gap: "12px",
    alignItems: "stretch"
  },
  textarea: {
    flex: 1,
    height: "60px",
    padding: "12px",
    backgroundColor: "#161b22",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: "8px",
    color: "#fff",
    fontSize: "13px",
    fontFamily: "inherit",
    resize: "none",
    outline: "none",
    lineHeight: "1.5"
  },
  sendBtn: {
    backgroundColor: "#2ea44f",
    color: "#fff",
    border: "none",
    borderRadius: "8px",
    padding: "0 20px",
    fontSize: "13px",
    fontWeight: "600",
    cursor: "pointer",
    transition: "background-color 0.2s"
  },
  sanitizationContainer: {
    display: "flex",
    flexDirection: "column",
    flex: 1,
    overflowY: "auto",
    paddingRight: "4px"
  },
  sectionHeader: {
    fontSize: "12px",
    fontWeight: "700",
    color: "#8b949e",
    textTransform: "uppercase",
    letterSpacing: "0.5px",
    marginTop: "20px",
    marginBottom: "10px",
    borderBottom: "1px solid rgba(255,255,255,0.06)",
    paddingBottom: "4px"
  },
  configCard: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    backgroundColor: "rgba(255,255,255,0.02)",
    border: "1px solid rgba(255,255,255,0.06)",
    borderRadius: "8px",
    padding: "12px"
  },
  configRow: {
    display: "flex",
    alignItems: "flex-start",
    gap: "10px"
  },
  configCheckbox: {
    marginTop: "3px",
    cursor: "pointer"
  },
  configLabel: {
    cursor: "pointer",
    fontSize: "13px",
    color: "#c9d1d9"
  },
  configDesc: {
    fontSize: "11px",
    color: "#8b949e",
    marginTop: "2px"
  },
  inputGroup: {
    display: "flex",
    gap: "8px",
    marginBottom: "10px"
  },
  inlineInput: {
    flex: 1,
    backgroundColor: "#161b22",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: "6px",
    padding: "8px 10px",
    fontSize: "12px",
    color: "#fff",
    outline: "none"
  },
  inlineAddBtn: {
    backgroundColor: "#21262d",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: "6px",
    color: "#c9d1d9",
    padding: "0 12px",
    fontSize: "12px",
    fontWeight: "600",
    cursor: "pointer"
  },
  tagContainer: {
    display: "flex",
    flexWrap: "wrap",
    gap: "6px",
    marginBottom: "15px"
  },
  tag: {
    display: "inline-flex",
    alignItems: "center",
    gap: "4px",
    backgroundColor: "rgba(88, 166, 255, 0.1)",
    border: "1px solid rgba(88, 166, 255, 0.2)",
    borderRadius: "4px",
    padding: "2px 6px",
    fontSize: "11px",
    color: "#58a6ff"
  },
  tagCloseBtn: {
    background: "none",
    border: "none",
    color: "#8b949e",
    cursor: "pointer",
    fontSize: "12px",
    padding: "0",
    marginLeft: "2px"
  },
  emptyDesc: {
    fontSize: "11px",
    color: "#8b949e",
    fontStyle: "italic"
  },
  saveConfigBtn: {
    backgroundColor: "#2ea44f",
    color: "#fff",
    border: "none",
    borderRadius: "6px",
    padding: "10px",
    fontSize: "13px",
    fontWeight: "600",
    cursor: "pointer",
    marginTop: "20px",
    transition: "background-color 0.2s"
  },
  itsmContainer: {
    display: "flex",
    flexDirection: "column",
    flex: 1,
    overflowY: "auto",
    paddingRight: "4px"
  },
  ticketForm: {
    display: "flex",
    flexDirection: "column",
    gap: "10px",
    backgroundColor: "rgba(255,255,255,0.02)",
    border: "1px solid rgba(255,255,255,0.06)",
    borderRadius: "8px",
    padding: "12px",
    marginBottom: "20px"
  },
  formRow: {
    display: "flex"
  },
  formInput: {
    flex: 1,
    backgroundColor: "#161b22",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: "6px",
    padding: "8px 10px",
    fontSize: "12px",
    color: "#fff",
    outline: "none"
  },
  formSelect: {
    flex: 1,
    backgroundColor: "#161b22",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: "6px",
    padding: "8px 10px",
    fontSize: "12px",
    color: "#fff",
    outline: "none"
  },
  createTicketBtn: {
    backgroundColor: "#21262d",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: "6px",
    color: "#c9d1d9",
    padding: "8px",
    fontSize: "12px",
    fontWeight: "600",
    cursor: "pointer",
    marginTop: "10px",
    transition: "background-color 0.2s"
  },
  ticketList: {
    display: "flex",
    flexDirection: "column",
    gap: "12px"
  },
  ticketCard: {
    backgroundColor: "rgba(255,255,255,0.02)",
    border: "1px solid rgba(255,255,255,0.06)",
    borderRadius: "8px",
    padding: "12px",
    display: "flex",
    flexDirection: "column",
    gap: "8px"
  },
  ticketHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center"
  },
  ticketId: {
    fontSize: "13px",
    fontWeight: "700",
    color: "#58a6ff"
  },
  ticketStatus: {
    fontSize: "11px",
    fontWeight: "600",
    padding: "2px 8px",
    borderRadius: "12px"
  },
  ticketMeta: {
    fontSize: "12px",
    color: "#c9d1d9",
    lineHeight: "1.4"
  },
  ticketActions: {
    display: "flex",
    gap: "8px",
    marginTop: "4px"
  },
  approveBtn: {
    flex: 1,
    backgroundColor: "#2ea44f",
    color: "#fff",
    border: "none",
    borderRadius: "4px",
    padding: "6px",
    fontSize: "11px",
    fontWeight: "600",
    cursor: "pointer"
  },
  rejectBtn: {
    flex: 1,
    backgroundColor: "#f85149",
    color: "#fff",
    border: "none",
    borderRadius: "4px",
    padding: "6px",
    fontSize: "11px",
    fontWeight: "600",
    cursor: "pointer"
  },

  // ── Benchmark styles ──────────────────────────────────────────────────────
  benchmarkContainer: {
    display: "flex",
    flexDirection: "column",
    flex: 1,
    overflowY: "auto",
    paddingRight: "4px"
  },
  benchmarkGroupList: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    marginBottom: "12px"
  },
  benchmarkGroupRow: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "6px 8px",
    backgroundColor: "rgba(255,255,255,0.02)",
    border: "1px solid rgba(255,255,255,0.05)",
    borderRadius: "6px"
  },
  benchmarkGroupName: {
    fontSize: "11px",
    fontWeight: "600",
    color: "#c9d1d9"
  },
  benchmarkActions: {
    display: "flex",
    gap: "6px",
    alignItems: "center",
    marginBottom: "14px"
  },
  benchmarkSummary: {
    backgroundColor: "rgba(255,255,255,0.02)",
    border: "1px solid rgba(255,255,255,0.06)",
    borderRadius: "8px",
    padding: "12px",
    marginBottom: "12px"
  },
  benchmarkSummaryRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "6px"
  },
  progressTrack: {
    height: "6px",
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: "3px",
    overflow: "hidden"
  },
  progressFill: {
    height: "100%",
    borderRadius: "3px",
    transition: "width 0.4s ease"
  },
  benchmarkGroupResult: {
    marginBottom: "4px",
    border: "1px solid rgba(255,255,255,0.05)",
    borderRadius: "6px",
    overflow: "hidden"
  },
  benchmarkGroupResultHeader: {
    display: "flex",
    alignItems: "center",
    padding: "7px 10px",
    backgroundColor: "rgba(255,255,255,0.03)",
    cursor: "pointer",
    gap: "8px"
  },
  benchmarkCaseList: {
    display: "flex",
    flexDirection: "column",
    gap: "0"
  },
  benchmarkCaseRow: {
    padding: "6px 10px",
    borderBottom: "1px solid rgba(255,255,255,0.04)",
    paddingLeft: "12px"
  }
};

// Add raw spin animation globally in stylesheet
if (typeof document !== "undefined") {
  const styleEl = document.createElement("style");
  styleEl.innerHTML = `
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
    .kb-tab-btn:hover {
      color: #fff !important;
    }
    .kb-upload-label:hover {
      background-color: rgba(88, 166, 255, 0.15) !important;
      border-color: rgba(88, 166, 255, 0.5) !important;
    }
    .kb-doc-card:hover {
      background-color: rgba(255,255,255,0.04) !important;
      border-color: rgba(255,255,255,0.1) !important;
    }
    .kb-refresh-btn:hover {
      color: #fff !important;
    }
    .kb-doc-action-btn:hover {
      transform: scale(1.1);
    }
    .kb-doc-delete-btn:hover {
      transform: scale(1.1);
    }
  `;
  document.head.appendChild(styleEl);
}
