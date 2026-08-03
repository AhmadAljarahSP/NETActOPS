import React, { useState, useEffect } from 'react';
import { useTheme } from '../context/ThemeContext';

export default function HelpModal({ isOpen, onClose }) {
  const { styles } = useTheme();
  const [activeTab, setActiveTab] = useState('overview');
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedCmd, setCopiedCmd] = useState(null);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
      if (e.shiftKey && e.key === '?') {
        if (isOpen) onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const copyToClipboard = (text, id) => {
    navigator.clipboard.writeText(text);
    setCopiedCmd(id);
    setTimeout(() => setCopiedCmd(null), 2000);
  };

  const tabs = [
    { id: 'overview', label: '🚀 Overview & Stack', icon: 'account_tree' },
    { id: 'inventory', label: '⚙️ Inventory & Devices', icon: 'inventory_2' },
    { id: 'automation', label: '⚡ Automation & IPAM/DNS', icon: 'bolt' },
    { id: 'copilot', label: '🤖 AI Copilot & Qdrant', icon: 'smart_toy' },
    { id: 'cli', label: '💻 netact CLI Manual', icon: 'terminal' },
    { id: 'troubleshooting', label: '❓ Runbooks & FAQs', icon: 'help_outline' },
  ];

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.75)',
      backdropFilter: 'blur(8px)',
      zIndex: 9999,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
      animation: 'fadeIn 0.2s ease-out'
    }}>
      <div style={{
        background: 'var(--background-secondary, #1a1d24)',
        border: '1px solid var(--border-whisper, #2e3440)',
        borderRadius: 16,
        width: '100%',
        maxWidth: 1100,
        height: '90vh',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '0 20px 50px rgba(0,0,0,0.6)',
        overflow: 'hidden'
      }}>
        {/* Modal Header */}
        <div style={{
          padding: '20px 28px',
          borderBottom: '1px solid var(--border-whisper, #2e3440)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'var(--background-tertiary, #12141a)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span className="material-symbols-outlined" style={{ fontSize: 28, color: 'var(--sidebar-active-indicator, #00adb5)' }}>menu_book</span>
            <div>
              <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--text-high-contrast, #fff)' }}>
                NETAct Solution & Documentation Center
              </h2>
              <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--text-medium-contrast, #94a3b8)' }}>
                Comprehensive operational manual, visual automation guides, CLI reference, and architecture specs
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            {/* Search Filter */}
            <div style={{ position: 'relative' }}>
              <span className="material-symbols-outlined" style={{
                position: 'absolute', left: 10, top: 8, fontSize: 18, color: '#64748b'
              }}>search</span>
              <input 
                type="text" 
                placeholder="Filter help topics..." 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{
                  background: 'var(--background, #0f172a)',
                  border: '1px solid var(--border-whisper, #334155)',
                  borderRadius: 8,
                  padding: '6px 12px 6px 34px',
                  color: '#fff',
                  fontSize: 13,
                  outline: 'none',
                  width: 220
                }}
              />
            </div>

            <button 
              onClick={onClose}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#94a3b8',
                fontSize: 24,
                cursor: 'pointer',
                padding: 4,
                display: 'flex',
                alignItems: 'center'
              }}
              title="Close (Esc)"
            >
              <span className="material-symbols-outlined">close</span>
            </button>
          </div>
        </div>

        {/* Body Container */}
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          {/* Navigation Sidebar */}
          <div style={{
            width: 240,
            borderRight: '1px solid var(--border-whisper, #2e3440)',
            background: 'var(--background-tertiary, #12141a)',
            padding: '16px 8px',
            display: 'flex',
            flexDirection: 'column',
            gap: 4
          }}>
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '12px 14px',
                  borderRadius: 8,
                  border: 'none',
                  background: activeTab === tab.id ? 'var(--sidebar-active-bg, rgba(0, 173, 181, 0.15))' : 'transparent',
                  color: activeTab === tab.id ? 'var(--sidebar-active-indicator, #00adb5)' : '#94a3b8',
                  fontWeight: activeTab === tab.id ? 700 : 500,
                  fontSize: 13,
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'all 0.2s ease'
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>{tab.icon}</span>
                {tab.label}
              </button>
            ))}
            
            <div style={{ marginTop: 'auto', padding: 12, background: 'rgba(255,255,255,0.03)', borderRadius: 8, fontSize: 11, color: '#64748b' }}>
              <div>Press <kbd style={{ background: '#334155', padding: '2px 6px', borderRadius: 4, color: '#fff' }}>Esc</kbd> to exit</div>
              <div style={{ marginTop: 4 }}>Full docs in <code style={{ color: '#00adb5' }}>docs/</code></div>
            </div>
          </div>

          {/* Tab Content Panel */}
          <div style={{ flex: 1, padding: 32, overflowY: 'auto', color: '#e2e8f0', lineHeight: 1.6 }}>
            {activeTab === 'overview' && (
              <div>
                <h3 style={{ marginTop: 0, color: '#00adb5', fontSize: 20 }}>🚀 System Architecture & Stack Overview</h3>
                <p>NETAct is structured into <strong>5 independent Docker Compose stacks</strong> communicating over a secure bridge network (<code>netact_config-net</code>).</p>

                <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 12, padding: 20, margin: '20px 0' }}>
                  <h4 style={{ margin: '0 0 12px 0', color: '#38bdf8' }}>Five Independent Compose Stacks</h4>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid #334155', textAlign: 'left', color: '#94a3b8' }}>
                        <th style={{ padding: '8px 0' }}>Stack</th>
                        <th>File</th>
                        <th>Ports</th>
                        <th>Key Components</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr style={{ borderBottom: '1px solid #1e293b' }}>
                        <td style={{ padding: '10px 0', fontWeight: 600, color: '#38bdf8' }}>Core</td>
                        <td><code>docker-compose.core.yml</code></td>
                        <td>:8000, :8003, :8002, :3000, :5001</td>
                        <td>Backend, Automation engine, Git repo, Web UI, MCP Server</td>
                      </tr>
                      <tr style={{ borderBottom: '1px solid #1e293b' }}>
                        <td style={{ padding: '10px 0', fontWeight: 600, color: '#a855f7' }}>AI / Copilot</td>
                        <td><code>docker-compose.ai.yml</code></td>
                        <td>:8010, :6333, :11434</td>
                        <td>Ollama LLM, Qdrant Vector DB, LangGraph Agent</td>
                      </tr>
                      <tr style={{ borderBottom: '1px solid #1e293b' }}>
                        <td style={{ padding: '10px 0', fontWeight: 600, color: '#34d399' }}>Topology</td>
                        <td><code>docker-compose.topology.yml</code></td>
                        <td>:8001, :3001</td>
                        <td>Neighbor graph engine, Interactive topology visualizer</td>
                      </tr>
                      <tr style={{ borderBottom: '1px solid #1e293b' }}>
                        <td style={{ padding: '10px 0', fontWeight: 600, color: '#f59e0b' }}>Knowledge</td>
                        <td><code>docker-compose.knowledge.yml</code></td>
                        <td>:8085</td>
                        <td>netact-brain, Obsidian Web vault editor</td>
                      </tr>
                      <tr>
                        <td style={{ padding: '10px 0', fontWeight: 600, color: '#ec4899' }}>Monitoring</td>
                        <td><code>docker-compose.monitoring.yml</code></td>
                        <td>:9090, :3002</td>
                        <td>Prometheus telemetry metrics, Grafana dashboards</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {activeTab === 'inventory' && (
              <div>
                <h3 style={{ marginTop: 0, color: '#00adb5', fontSize: 20 }}>⚙️ Multi-Vendor Inventory & Backup Engine</h3>
                <p>NETAct provides native configuration management and health checks across 7 multi-vendor OS platforms:</p>
                <ul>
                  <li><strong>Cisco</strong> (IOS / IOS-XE)</li>
                  <li><strong>Cisco XR</strong> (IOS-XR)</li>
                  <li><strong>Huawei</strong> (VRP: NE40E, NE9000, S5331, CE16804)</li>
                  <li><strong>Juniper</strong> (JunOS)</li>
                  <li><strong>Arista</strong> (EOS)</li>
                  <li><strong>Nokia</strong> (SR-OS 7750 / 7250)</li>
                  <li><strong>F5</strong> (BIG-IP TMOS)</li>
                </ul>

                <h4 style={{ color: '#38bdf8', marginTop: 24 }}>YAML Inventory Schema Example</h4>
                <pre style={{ background: '#0f172a', padding: 16, borderRadius: 8, border: '1px solid #1e293b', fontSize: 12 }}>{`devices:
  - id: CORE-RTR-01
    host: 10.0.1.1
    vendor: cisco
    device_type: router
    auth_profile: default
    jump_host: jump.example.com
    tags: [core, backbone, bgp]`}</pre>
              </div>
            )}

            {activeTab === 'automation' && (
              <div>
                <h3 style={{ marginTop: 0, color: '#00adb5', fontSize: 20 }}>⚡ Visual Automation & EfficientIP SOLIDserver</h3>
                <p>Build and execute visual workflows with automated rollback snapshots and built-in Ansible playbooks.</p>

                <h4 style={{ color: '#38bdf8' }}>EfficientIP SOLIDserver (IPAM & DNS) Integration</h4>
                <p>NETAct includes a custom Ansible collection <code>netact.solidserver</code> supporting IPAM reservations and DNS record management:</p>

                <div style={{ background: '#0f172a', padding: 16, borderRadius: 8, border: '1px solid #1e293b', fontSize: 12 }}>
                  <code style={{ color: '#34d399' }}># Reserve IP in SOLIDserver IPAM</code>
                  <pre style={{ margin: '8px 0 0', color: '#cbd5e1' }}>{`- name: Reserve IP
  netact.solidserver.ipam_write:
    ip_address: "10.1.1.60"
    name: "CORE-RTR-01-Loopback"
    space_name: "Production-Space"
    state: present`}</pre>
                </div>
              </div>
            )}

            {activeTab === 'copilot' && (
              <div>
                <h3 style={{ marginTop: 0, color: '#00adb5', fontSize: 20 }}>🤖 AI Copilot & Qdrant One-Way Vector Sync</h3>
                <p>The AI Copilot uses <strong>Qdrant vector search</strong> (<code>netact_knowledgebase</code>) and local <strong>Ollama models</strong> (<code>nomic-embed-text</code> embeddings + <code>llama3.2</code> LLM).</p>

                <div style={{ background: '#0f172a', padding: 20, borderRadius: 12, border: '1px solid #1e293b' }}>
                  <h4 style={{ margin: '0 0 8px 0', color: '#38bdf8' }}>One-Way Cumulative Ingestion Pipeline</h4>
                  <p style={{ fontSize: 13, color: '#94a3b8', margin: 0 }}>
                    1. <code>netact-brain</code> and users write Markdown notes to the Obsidian Vault (<code>knowledge/obsidian_topology</code>).<br />
                    2. <code>copilot-backend</code> computes SHA256 hashes in <code>knowledgebase_registry.json</code>.<br />
                    3. Modified notes are embedded via <code>nomic-embed-text</code> and uploaded to Qdrant. Obsidian never reads from Qdrant.
                  </p>
                </div>
              </div>
            )}

            {activeTab === 'cli' && (
              <div>
                <h3 style={{ marginTop: 0, color: '#00adb5', fontSize: 20 }}>💻 <code>netact</code> CLI Command Reference</h3>
                <p>Every administrative task can be executed via the <code>netact</code> command line tool:</p>

                {[
                  { cmd: 'netact status', desc: 'Health-check all 5 Compose stacks' },
                  { cmd: 'netact doctor', desc: 'Full diagnostic check for Qdrant, Ollama, and DBs' },
                  { cmd: 'netact inventory sync', desc: 'Reload device inventory from disk YAML files' },
                  { cmd: 'netact inventory list', desc: 'List all managed network devices' },
                  { cmd: 'netact healthcheck CORE-RTR-01', desc: 'Run instant SSH health check for a device' },
                  { cmd: 'netact topology show', desc: 'Query live network graph' },
                  { cmd: 'netact workflow list', desc: 'List visual workflows and Ansible playbooks' },
                  { cmd: 'netact qdrant status', desc: 'Check Qdrant vector DB status & point count' }
                ].map((item, idx) => (
                  <div key={idx} style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    background: '#0f172a',
                    padding: '12px 16px',
                    borderRadius: 8,
                    marginBottom: 8,
                    border: '1px solid #1e293b'
                  }}>
                    <div>
                      <code style={{ color: '#00adb5', fontSize: 13, fontWeight: 700 }}>{item.cmd}</code>
                      <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>{item.desc}</div>
                    </div>
                    <button
                      onClick={() => copyToClipboard(item.cmd, idx)}
                      style={{
                        background: copiedCmd === idx ? '#10b981' : '#334155',
                        border: 'none',
                        color: '#fff',
                        borderRadius: 6,
                        padding: '6px 12px',
                        fontSize: 12,
                        cursor: 'pointer'
                      }}
                    >
                      {copiedCmd === idx ? 'Copied!' : 'Copy'}
                    </button>
                  </div>
                ))}
              </div>
            )}

            {activeTab === 'troubleshooting' && (
              <div>
                <h3 style={{ marginTop: 0, color: '#00adb5', fontSize: 20 }}>❓ Runbooks & Quick Troubleshooting</h3>
                
                <h4 style={{ color: '#38bdf8' }}>1. SSH / Bastion Jump Host Failures</h4>
                <p>Verify <code>JUMP_HOST</code>, <code>JUMP_USER</code>, and <code>JUMP_PASSWORD</code> in <code>.env</code>. Test connectivity via:</p>
                <pre style={{ background: '#0f172a', padding: 12, borderRadius: 8, fontSize: 12 }}>{`netact logs backend -f`}</pre>

                <h4 style={{ color: '#38bdf8', marginTop: 20 }}>2. Re-triggering Vector Sync</h4>
                <pre style={{ background: '#0f172a', padding: 12, borderRadius: 8, fontSize: 12 }}>{`curl -X POST http://localhost:8010/api/copilot/sync -H "X-Api-Key: APP_PASSWORD"`}</pre>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
