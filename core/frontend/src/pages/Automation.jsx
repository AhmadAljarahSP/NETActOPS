import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import ReactFlow, {
  ReactFlowProvider,
  useNodesState,
  useEdgesState,
  addEdge,
  MiniMap,
  Controls,
  Background,
  Handle,
  Position,
  MarkerType,
  NodeToolbar,
  getBezierPath,
  EdgeLabelRenderer
} from 'reactflow';
import 'reactflow/dist/style.css';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import axios from 'axios';
import { getBadgeStyle } from '../styles';
import { 
  Play, Save, Plus, Trash2, ArrowRight, Settings, Info, 
  CheckCircle, AlertCircle, RefreshCw, Layers, ShieldAlert,
  Database, Activity, FileText, ChevronRight, X, Bell, Network,
  Download, Upload, Maximize2, Minimize2
} from "lucide-react";

const API = "/api/automation";
const CORE_API = "/api";

// Shared by PreCheckNode/PostCheckNode/ConfigDeployNode's "Ansible" mode —
// one fetch of the flow list (name/mode/required_vars), reused wherever a
// node needs to offer a playbook picker. Never triggers execution.
function useAnsibleFlowsList() {
  const [flows, setFlows] = useState([]);
  useEffect(() => {
    let mounted = true;
    axios.get(`${API}/ansible/flows`).then(res => {
      if (mounted) setFlows(res.data || []);
    }).catch(() => {
      if (mounted) setFlows([]);
    });
    return () => { mounted = false; };
  }, []);
  return flows;
}

// Fetches the raw playbook YAML for the Inspector's script preview —
// same GET /ansible/flows/{name} the "Ansible Flows" tab's View button uses.
function useAnsibleFlowContent(flowName) {
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => {
    if (!flowName) { setContent(''); setError(null); return; }
    let mounted = true;
    setLoading(true);
    setError(null);
    axios.get(`${API}/ansible/flows/${flowName}`).then(res => {
      if (mounted) setContent(res.data?.content || '');
    }).catch(e => {
      if (mounted) setError(e.response?.data?.detail || e.message);
    }).finally(() => {
      if (mounted) setLoading(false);
    });
    return () => { mounted = false; };
  }, [flowName]);
  return { content, loading, error };
}

// Inspector-panel version of the node card's Ansible flow picker — same
// underlying data (ansibleFlowName / ansibleExtraVars on the node), but
// rendered at the Inspector's width/font-size and with a read-only preview
// of the actual playbook script, so the operator can see what the flow
// does and which vars it needs without squinting at the tiny canvas card.
function AnsibleFlowInspector({ data, flows, filterMode }) {
  const { styles, theme } = useTheme();
  const colors = theme.colors;
  const filteredFlows = filterMode ? flows.filter(f => f.mode === filterMode) : flows;
  const selectedFlow = flows.find(f => f.name === data.ansibleFlowName);
  const requiredVars = selectedFlow?.required_vars || [];
  const extraVars = data.ansibleExtraVars || {};
  const { content, loading, error } = useAnsibleFlowContent(data.ansibleFlowName);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={styles.fieldWrap}>
        <label style={styles.label}>Ansible Flow</label>
        <select
          value={data.ansibleFlowName || ''}
          onChange={(e) => data.updateNodeData && data.updateNodeData({ ansibleFlowName: e.target.value })}
          style={styles.input}
        >
          {filteredFlows.length === 0 ? (
            <option value="">No flows found</option>
          ) : (
            filteredFlows.map((f) => (
              <option key={f.name} value={f.name}>{f.name} ({f.mode})</option>
            ))
          )}
        </select>
      </div>

      {requiredVars.length > 0 && (
        <div style={styles.fieldWrap}>
          <label style={styles.label}>Extra vars this playbook requires</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {requiredVars.map(v => (
              <div key={v} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span style={{ fontSize: 11, color: colors.gray, fontFamily: 'monospace' }}>{v}</span>
                <input
                  value={extraVars[v] || ''}
                  onChange={(e) => {
                    const newVars = { ...extraVars, [v]: e.target.value };
                    data.updateNodeData && data.updateNodeData({ ansibleExtraVars: newVars });
                  }}
                  placeholder="enter value..."
                  style={{ ...styles.input, fontFamily: "monospace", fontSize: 11 }}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={styles.fieldWrap}>
        <label style={styles.label}>Playbook script{data.ansibleFlowName ? ` — ${data.ansibleFlowName}` : ""}</label>
        <textarea
          rows={14}
          readOnly
          value={
            !data.ansibleFlowName ? "Select a flow above to preview its script."
            : loading ? "Loading…"
            : error ? `Failed to load: ${error}`
            : (content || "(empty file)")
          }
          style={{ ...styles.input, fontFamily: "monospace", fontSize: 11, opacity: 0.85 }}
        />
      </div>
    </div>
  );
}

const displayVendor = (vendor) => {
  if (!vendor) return "";
  const v = vendor.toLowerCase();
  if (v === "cisco") return "CISCO";
  if (v === "cisco_xr") return "CISCO_XR";
  if (v.includes("juniper") || v.includes("junos")) return "JUNIPER_JUNOS";
  if (v.includes("huawei")) return "HUAWEI";
  return vendor.toUpperCase();
};

const getNodeColor = (type) => {
  switch (type) {
    case 'startNode': return '#10b981'; // Green
    case 'deviceSelectNode': return '#f59e0b'; // Amber
    case 'preCheckNode': return '#3b82f6'; // Blue
    case 'configDeployNode': return '#ef4444'; // Red
    case 'postCheckNode': return '#06b6d4'; // Cyan
    case 'gitCommitNode': return '#8b5cf6'; // Purple
    case 'notificationNode': return '#d946ef'; // Magenta
    default: return '#64748b';
  }
};

const getNodeIcon = (type) => {
  switch (type) {
    case 'startNode': return '🟢';
    case 'deviceSelectNode': return '🎯';
    case 'preCheckNode': return '🩺';
    case 'configDeployNode': return '⚡';
    case 'postCheckNode': return '🧪';
    case 'gitCommitNode': return '📦';
    case 'notificationNode': return '🔔';
    default: return '⚙️';
  }
};

const getFriendlyTypeName = (type) => {
  switch (type) {
    case 'startNode': return 'Trigger Start';
    case 'deviceSelectNode': return 'Target Select';
    case 'preCheckNode': return 'Pre-Checks';
    case 'configDeployNode': return 'Config Deploy';
    case 'postCheckNode': return 'Post-Checks';
    case 'gitCommitNode': return 'Git Commit';
    case 'notificationNode': return 'Alert Notify';
    default: return 'Unknown Node';
  }
};

// ==========================================
// 🎨 Custom Node Components with Floating Flowise-style designs
// ==========================================

const getNodeGlow = (status, colors) => {
  if (status === 'running') return `0 0 20px ${colors.warning || '#f59e0b'}`;
  if (status === 'success') return `0 0 20px ${colors.success || '#10b981'}`;
  if (status === 'failed') return `0 0 20px ${colors.danger || '#ef4444'}`;
  return '0 4px 15px rgba(0, 0, 0, 0.4)';
};

const getNodeBorder = (status, colors, defaultBorder) => {
  if (status === 'running') return `2px solid ${colors.warning || '#f59e0b'}`;
  if (status === 'success') return `2px solid ${colors.success || '#10b981'}`;
  if (status === 'failed') return `2px solid ${colors.danger || '#ef4444'}`;
  return `1px solid ${defaultBorder || 'rgba(255,255,255,0.08)'}`;
};

const handleStyle = (colors) => ({
  background: '#0f172a',
  border: `2px solid ${colors.primary || '#6366f1'}`,
  width: '8px',
  height: '8px',
  borderRadius: '50%',
  zIndex: 10
});

// Inline Control Styles for Flowise look & feel
const getInputStyle = (colors) => ({
  background: '#090d16',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: '6px',
  color: '#fff',
  fontSize: '11px',
  padding: '6px 10px',
  outline: 'none',
  width: '100%',
  fontFamily: 'Inter, sans-serif',
  transition: 'border-color 0.2s',
  boxSizing: 'border-box',
  marginTop: '4px'
});

const getTextareaStyle = (colors) => ({
  ...getInputStyle(colors),
  fontFamily: '"Fira Code", monospace, Courier',
  fontSize: '10px',
  height: '75px',
  resize: 'none',
  lineHeight: '1.4'
});

const getLabelStyle = () => ({
  fontSize: '9px',
  color: '#94a3b8',
  fontWeight: '700',
  letterSpacing: '0.3px',
  marginTop: '6px',
  marginBottom: '2px',
  display: 'block'
});

// Custom interactive edge with a delete button
function ButtonEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  markerEnd,
  data,
}) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  return (
    <>
      <path
        id={id}
        style={{ ...style, stroke: '#6366f1', strokeWidth: 2.5 }}
        className="react-flow__edge-path"
        d={edgePath}
        markerEnd={markerEnd}
      />
      <EdgeLabelRenderer>
        <div
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            fontSize: 12,
            pointerEvents: 'all',
            zIndex: 10,
          }}
          className="nodrag nopan"
        >
          <button
            title="Delete Connection"
            style={{
              width: 18,
              height: 18,
              background: 'rgba(239, 68, 68, 0.85)',
              border: '1px solid rgba(239, 68, 68, 0.4)',
              color: '#fff',
              borderRadius: '50%',
              cursor: 'pointer',
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              fontSize: '11px',
              fontWeight: 'bold',
              boxShadow: '0 2px 4px rgba(0,0,0,0.3)',
              backdropFilter: 'blur(4px)',
              transition: 'all 0.15s ease-in-out',
            }}
            onClick={(event) => {
              event.stopPropagation();
              if (data && data.onDelete) {
                data.onDelete(id);
              }
            }}
          >
            ×
          </button>
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

const edgeTypes = {
  buttonEdge: ButtonEdge,
};

const findUpstreamDeviceSelectNode = (nodeId, nodes, edges) => {
  if (!nodeId || !nodes || !edges) return null;
  const incomingEdges = edges.filter(e => e.target === nodeId);
  for (const edge of incomingEdges) {
    const sourceNode = nodes.find(n => n.id === edge.source);
    if (!sourceNode) continue;
    if (sourceNode.type === 'deviceSelectNode') {
      return sourceNode;
    }
    const found = findUpstreamDeviceSelectNode(sourceNode.id, nodes, edges);
    if (found) return found;
  }
  return null;
};

// Resolve commands_source profile files from group or devices dynamically
const getScriptProfilesForNode = (nodeId, nodes, edges, deviceGroups, devicesList, availableCommandsList) => {
  const list = [];
  const targetNode = findUpstreamDeviceSelectNode(nodeId, nodes, edges);
  if (!targetNode) return list;

  const ticked = targetNode.data?.tickedDevices || [];

  if (ticked.length > 0 && devicesList) {
    ticked.forEach(devId => {
      const dev = devicesList.find(d => String(d.id) === String(devId) || d.hostname === devId);
      if (dev) {
        if (dev.commands_source) {
          const srcs = Array.isArray(dev.commands_source) ? dev.commands_source : [dev.commands_source];
          srcs.forEach(src => {
            if (src && typeof src === 'object') {
              list.push({
                name: `[Device: ${dev.hostname}] ${src.name || src.path.split('/').pop() || 'Default'}`,
                path: src.path
              });
            } else if (typeof src === 'string') {
              list.push({
                name: `[Device: ${dev.hostname}] ${src.split('/').pop() || 'Default'}`,
                path: src
              });
            }
          });
        }
        
        const devGroup = dev.group || dev.group_file;
        if (devGroup && deviceGroups) {
          const matchGrp = deviceGroups.find(dg => dg.group === devGroup);
          if (matchGrp && matchGrp.commands_sources) {
            matchGrp.commands_sources.forEach(src => {
              list.push({
                name: `[Group: ${devGroup}] ${src.name || src.path.split('/').pop() || 'Default'}`,
                path: src.path
              });
            });
          }
        }
      }
    });
  }

  // Remove duplicates by path
  const uniquePaths = new Set();
  const uniqueList = [];
  list.forEach(item => {
    if (!uniquePaths.has(item.path)) {
      uniquePaths.add(item.path);
      uniqueList.push(item);
    }
  });

  return uniqueList;
};

// Clean nodes and edges of structures and runtime callbacks before serialization
const cleanGraphData = (nds, eds) => {
  const cleanNodes = nds.map((n) => ({
    id: n.id,
    type: n.type,
    position: n.position,
    data: {
      status: n.data.status || 'idle',
      triggerMode: n.data.triggerMode,
      group: n.data.group,
      vendor: n.data.vendor,
      tickedDevices: n.data.tickedDevices || [],
      customUsername: n.data.customUsername,
      customPassword: n.data.customPassword,
      cpuThreshold: n.data.cpuThreshold,
      useYamlCommands: n.data.useYamlCommands,
      yamlScriptPath: n.data.yamlScriptPath,
      commandsText: n.data.commandsText,
      commandsCount: n.data.commandsCount,
      variables: n.data.variables,
      autoRollback: n.data.autoRollback,
      webhook: n.data.webhook
    }
  }));

  const cleanEdges = eds.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    animated: e.animated
  }));

  return { nodes: cleanNodes, edges: cleanEdges };
};

// Floating toolbar wrapper
const renderFloatingToolbar = (selected, onEdit, onDelete, colors) => (
  <NodeToolbar isVisible={selected} position={Position.Top} className="nodrag nopan">
    <div 
      className="nodrag nopan"
      style={{
        display: 'flex',
        gap: 6,
        background: 'rgba(10, 16, 26, 0.95)',
        backdropFilter: 'blur(8px)',
        border: '1px solid rgba(255,255,255,0.08)',
        padding: '5px 8px',
        borderRadius: '8px',
        boxShadow: '0 4px 20px rgba(0,0,0,0.6)',
        alignItems: 'center',
        marginBottom: 8
      }}
    >
      <button 
        className="nodrag nopan"
        onClick={(e) => {
          e.stopPropagation();
          onEdit();
        }} 
        style={{
          background: 'rgba(255,255,255,0.06)',
          border: 'none',
          color: '#fff',
          padding: '4px 10px',
          borderRadius: '5px',
          fontSize: '11px',
          fontWeight: '700',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 4
        }}
      >
        <span>✏️</span> Configure
      </button>
      <div style={{ width: 1, height: 12, background: 'rgba(255,255,255,0.1)' }} />
      <button 
        className="nodrag nopan"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }} 
        style={{
          background: 'rgba(255, 77, 77, 0.15)',
          border: 'none',
          color: '#ff4d4d',
          padding: '4px 10px',
          borderRadius: '5px',
          fontSize: '11px',
          fontWeight: '700',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 4
        }}
      >
        <span>🗑️</span> Delete
      </button>
    </div>
  </NodeToolbar>
);

// Unified Flowise card layout
function FlowiseCard({ title, icon, color, status, themeColors, styles, width, children }) {
  const isRunning = status === 'running';
  
  const renderStatusBadge = () => {
    if (!status || status === 'idle') return null;
    
    let label = 'IDLE';
    let bgColor = 'rgba(255,255,255,0.06)';
    let textColor = '#94a3b8';
    let border = '1px solid rgba(255,255,255,0.1)';
    let showSpinner = false;

    if (status === 'running') {
      label = 'RUNNING';
      bgColor = 'rgba(245, 158, 11, 0.15)';
      textColor = '#f59e0b';
      border = '1px solid rgba(245, 158, 11, 0.3)';
      showSpinner = true;
    } else if (status === 'success') {
      label = 'SUCCESS';
      bgColor = 'rgba(16, 185, 129, 0.15)';
      textColor = '#10b981';
      border = '1px solid rgba(16, 185, 129, 0.3)';
    } else if (status === 'failed') {
      label = 'FAILED';
      bgColor = 'rgba(239, 68, 68, 0.15)';
      textColor = '#ef4444';
      border = '1px solid rgba(239, 68, 68, 0.3)';
    }

    return (
      <div style={{
        marginLeft: 'auto',
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '2px 6px',
        borderRadius: '12px',
        background: bgColor,
        border: border,
        fontSize: '8px',
        fontWeight: '800',
        color: textColor,
        letterSpacing: '0.3px',
        lineHeight: '1'
      }}>
        {showSpinner && (
          <div style={{
            width: 8,
            height: 8,
            border: `2px solid ${textColor}`,
            borderTopColor: 'transparent',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite'
          }} />
        )}
        <span>{label}</span>
      </div>
    );
  };

  return (
    <div style={{
      background: 'rgba(15, 23, 42, 0.9)',
      backdropFilter: 'blur(16px)',
      border: getNodeBorder(status, themeColors, styles.border),
      boxShadow: getNodeGlow(status, themeColors),
      borderRadius: '12px',
      color: styles.light,
      fontFamily: 'Inter, sans-serif',
      width: width ? `${width}px` : '220px',
      overflow: 'hidden',
      position: 'relative',
      transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
      display: 'flex',
      flexDirection: 'column',
      textAlign: 'left',
      animation: isRunning ? 'pulseGlow 2s infinite ease-in-out' : 'none'
    }}>
      {/* Accent Header */}
      <div style={{
        background: 'rgba(30, 41, 59, 0.4)',
        borderLeft: `4px solid ${color}`,
        borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
        padding: '10px 14px',
        display: 'flex',
        alignItems: 'center',
        gap: 8
      }}>
        <span style={{ fontSize: '14px' }}>{icon}</span>
        <span style={{ 
          fontSize: '10px', 
          fontWeight: '800', 
          textTransform: 'uppercase', 
          letterSpacing: '0.8px', 
          color: '#fff' 
        }}>
          {title}
        </span>
        {renderStatusBadge()}
      </div>
      
      {/* Body content */}
      <div style={{
        padding: '12px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 4
      }}>
        {children}
      </div>
    </div>
  );
}

function StartNode({ id, data, selected }) {
  const { styles, theme } = useTheme();
  return (
    <FlowiseCard
      title="Trigger Start"
      icon="🟢"
      color={theme.colors.success}
      status={data.status}
      themeColors={theme.colors}
      styles={styles}
      width={data.width}
    >
      {renderFloatingToolbar(selected, () => data.onEdit(), data.onDelete, theme.colors)}
      <Handle type="source" position={Position.Right} style={handleStyle(theme.colors)} />
      
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <label style={getLabelStyle()}>Trigger Mode</label>
        <select
          className="nodrag"
          value={data.triggerMode || 'Manual'}
          onChange={(e) => data.updateNodeData && data.updateNodeData({ triggerMode: e.target.value })}
          style={getInputStyle(theme.colors)}
        >
          <option value="Manual">Manual Trigger</option>
          <option value="Webhook">Webhook API</option>
          <option value="Schedule">Schedule Cron</option>
        </select>
      </div>
      {data.triggerMode === 'Schedule' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <label style={getLabelStyle()}>Cron Expression</label>
            <input
              type="text"
              className="nodrag"
              placeholder="e.g. */10 * * * *"
              value={data.cronExpression || ''}
              onChange={(e) => data.updateNodeData && data.updateNodeData({ cronExpression: e.target.value })}
              style={getInputStyle(theme.colors)}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <label style={getLabelStyle()}>Specific Date & Time</label>
            <input
              type="datetime-local"
              className="nodrag"
              value={data.scheduleDateTime || ''}
              onChange={(e) => data.updateNodeData && data.updateNodeData({ scheduleDateTime: e.target.value })}
              style={getInputStyle(theme.colors)}
            />
          </div>
        </div>
      )}
      <div style={{ fontSize: 9, color: theme.colors.gray, marginTop: 4 }}>Topological trigger start.</div>
    </FlowiseCard>
  );
}

function DeviceSelectNode({ id, data, selected }) {
  const { styles, theme } = useTheme();
  const tickedCount = data.tickedDevices ? data.tickedDevices.length : 0;
  const groupsList = data.deviceGroups || [];
  
  const selectMode = tickedCount > 0 ? 'ticked' : 'group';

  return (
    <FlowiseCard
      title="Target Select"
      icon="🎯"
      color={theme.colors.warning}
      status={data.status}
      themeColors={theme.colors}
      styles={styles}
      width={data.width}
    >
      {renderFloatingToolbar(selected, () => data.onEdit(), data.onDelete, theme.colors)}
      <Handle type="target" position={Position.Left} style={handleStyle(theme.colors)} />
      <Handle type="source" position={Position.Right} style={handleStyle(theme.colors)} />
      
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ marginTop: 4 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: theme.colors.primary, display: 'flex', alignItems: 'center', gap: 4 }}>
            <span>🎯</span> {tickedCount} Router(s) Selected
          </div>
          <button
            className="nodrag"
            onClick={data.onEdit}
            style={{
              marginTop: 6,
              background: 'rgba(99, 102, 241, 0.15)',
              border: '1px solid rgba(99, 102, 241, 0.3)',
              color: theme.colors.primary,
              padding: '4px 8px',
              borderRadius: '6px',
              fontSize: '10px',
              fontWeight: '700',
              cursor: 'pointer',
              width: '100%'
            }}
          >
            🔎 Configure Selection
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
          <input
            className="nodrag"
            type="checkbox"
            id={`cred-override-${id}`}
            checked={!!data.customUsername}
            onChange={(e) => {
              if (e.target.checked) {
                data.updateNodeData && data.updateNodeData({ customUsername: 'admin', customPassword: '' });
              } else {
                data.updateNodeData && data.updateNodeData({ customUsername: '', customPassword: '' });
              }
            }}
            style={{ width: 12, height: 12, accentColor: theme.colors.primary, cursor: 'pointer' }}
          />
          <label htmlFor={`cred-override-${id}`} style={{ fontSize: '9px', fontWeight: '700', color: theme.colors.warning, cursor: 'pointer' }}>
            Override Credentials
          </label>
        </div>

        {!!data.customUsername && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
            <input
              className="nodrag"
              value={data.customUsername || ''}
              onChange={(e) => data.updateNodeData && data.updateNodeData({ customUsername: e.target.value })}
              placeholder="Username"
              style={{ ...getInputStyle(theme.colors), padding: '4px 8px', fontSize: '10px' }}
            />
            <input
              className="nodrag"
              type="password"
              value={data.customPassword || ''}
              onChange={(e) => data.updateNodeData && data.updateNodeData({ customPassword: e.target.value })}
              placeholder="Password"
              style={{ ...getInputStyle(theme.colors), padding: '4px 8px', fontSize: '10px' }}
            />
          </div>
        )}
      </div>
    </FlowiseCard>
  );
}

// Shared by PreCheckNode/PostCheckNode (filterMode="read_only" — a check
// node must never be able to run a write playbook) and ConfigDeployNode
// (filterMode=null — deploy is the write path, so all flows are offered).
// Renders the flow picker plus a form for whatever extra-vars that flow's
// own "assert ... is defined" preflight declares it needs.
function AnsibleFlowFields({ data, flows, filterMode }) {
  const { theme } = useTheme();
  const filteredFlows = filterMode ? flows.filter(f => f.mode === filterMode) : flows;
  const selectedFlow = flows.find(f => f.name === data.ansibleFlowName);
  const requiredVars = selectedFlow?.required_vars || [];
  const extraVars = data.ansibleExtraVars || {};

  useEffect(() => {
    const isValid = filteredFlows.some(f => f.name === data.ansibleFlowName);
    if (!isValid && filteredFlows.length > 0) {
      data.updateNodeData && data.updateNodeData({ ansibleFlowName: filteredFlows[0].name });
    }
  }, [filteredFlows, data.ansibleFlowName]);

  return (
    <>
      <label style={getLabelStyle()}>Ansible Flow</label>
      <select
        className="nodrag"
        value={data.ansibleFlowName || ''}
        onChange={(e) => data.updateNodeData && data.updateNodeData({ ansibleFlowName: e.target.value })}
        style={getInputStyle(theme.colors)}
      >
        {filteredFlows.length === 0 ? (
          <option value="">No flows found</option>
        ) : (
          filteredFlows.map((f) => (
            <option key={f.name} value={f.name}>{f.name} ({f.mode})</option>
          ))
        )}
      </select>

      {requiredVars.length > 0 && (
        <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 9, fontWeight: '800', color: theme.colors.primary }}>📝 EXTRA VARS</span>
          {requiredVars.map(v => (
            <div key={v} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 9, color: '#94a3b8', fontFamily: 'monospace' }}>{v}:</span>
              <input
                className="nodrag"
                value={extraVars[v] || ''}
                onChange={(e) => {
                  const newVars = { ...extraVars, [v]: e.target.value };
                  data.updateNodeData && data.updateNodeData({ ansibleExtraVars: newVars });
                }}
                placeholder="enter value..."
                style={{ ...getInputStyle(theme.colors), padding: '4px 8px', fontSize: '10px' }}
              />
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function PreCheckNode({ id, data, selected }) {
  const { styles, theme } = useTheme();
  const [scriptContent, setScriptContent] = useState('');
  const [loading, setLoading] = useState(false);
  const ansibleFlows = useAnsibleFlowsList();
  const checkMode = data.checkMode || (data.useYamlCommands ? 'yaml' : 'custom');

  const scriptProfiles = useMemo(() => {
    return getScriptProfilesForNode(
      id,
      data.nodes || [],
      data.edges || [],
      data.deviceGroups || [],
      data.devicesList || [],
      data.availableCommandsList || []
    );
  }, [id, data.nodes, data.edges, data.deviceGroups, data.devicesList, data.availableCommandsList]);

  useEffect(() => {
    if (data.useYamlCommands && scriptProfiles.length > 0) {
      const isValid = scriptProfiles.some(p => p.path === data.yamlScriptPath);
      if (!isValid) {
        const defaultPath = scriptProfiles[0].path;
        data.updateNodeData && data.updateNodeData({ yamlScriptPath: defaultPath });
      }
    }
  }, [scriptProfiles, data.yamlScriptPath, data.useYamlCommands]);

  useEffect(() => {
    if (!data.useYamlCommands || !data.yamlScriptPath) {
      setScriptContent('');
      return;
    }
    const filename = data.yamlScriptPath.split('/').pop();
    if (!filename) return;

    let isMounted = true;
    setLoading(true);
    const apiKey = sessionStorage.getItem('app_password') || '';
    
    axios.get(`/api/commands/${filename}/content`, {
      headers: { 'x-api-key': apiKey }
    }).then(res => {
      if (isMounted && res.data && res.data.content) {
        setScriptContent(res.data.content);
        if (data.updateNodeData && data.commandsText !== res.data.content) {
          data.updateNodeData({ 
            commandsText: res.data.content, 
            commandsCount: res.data.content.split('\n').filter(Boolean).length 
          });
        }
      }
    }).catch(err => {
      console.error(err);
      if (isMounted) setScriptContent('Error loading script.');
    }).finally(() => {
      if (isMounted) setLoading(false);
    });

    return () => {
      isMounted = false;
    };
  }, [data.yamlScriptPath, data.useYamlCommands]);

  return (
    <FlowiseCard
      title="Pre-Checks"
      icon="🩺"
      color={theme.colors.info}
      status={data.status}
      themeColors={theme.colors}
      styles={styles}
      width={data.width}
    >
      {renderFloatingToolbar(selected, () => data.onEdit(), data.onDelete, theme.colors)}
      <Handle type="target" position={Position.Left} style={handleStyle(theme.colors)} />
      <Handle type="source" position={Position.Right} style={handleStyle(theme.colors)} />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div>
          <label style={getLabelStyle()}>CPU Limit (%)</label>
          <input
            className="nodrag"
            type="number"
            value={data.cpuThreshold || 90}
            onChange={(e) => data.updateNodeData && data.updateNodeData({ cpuThreshold: parseInt(e.target.value) || 0 })}
            style={getInputStyle(theme.colors)}
          />
        </div>

        <label style={getLabelStyle()}>Check Mode</label>
        <select
          className="nodrag"
          value={checkMode}
          onChange={(e) => {
            const mode = e.target.value;
            if (mode === 'yaml') {
              const firstPath = scriptProfiles[0]?.path || '';
              data.updateNodeData && data.updateNodeData({
                checkMode: 'yaml',
                useYamlCommands: true,
                yamlScriptPath: firstPath
              });
            } else if (mode === 'ansible') {
              data.updateNodeData && data.updateNodeData({
                checkMode: 'ansible',
                useYamlCommands: false
              });
            } else {
              data.updateNodeData && data.updateNodeData({
                checkMode: 'custom',
                useYamlCommands: false
              });
            }
          }}
          style={getInputStyle(theme.colors)}
        >
          <option value="custom">Custom CLI Text</option>
          <option value="yaml">Command Profile</option>
          <option value="ansible">Ansible Script</option>
        </select>

        {checkMode === 'yaml' ? (
          <>
            <label style={getLabelStyle()}>Diagnostics Profile</label>
            <select
              className="nodrag"
              value={data.yamlScriptPath || ''}
              onChange={(e) => data.updateNodeData && data.updateNodeData({ yamlScriptPath: e.target.value })}
              style={getInputStyle(theme.colors)}
            >
              {scriptProfiles.length === 0 ? (
                <option value="">No profiles found</option>
              ) : (
                scriptProfiles.map((p) => (
                  <option key={p.path} value={p.path}>{p.name}</option>
                ))
              )}
            </select>
            <label style={getLabelStyle()}>Script Preview</label>
            <textarea
              className="nodrag"
              readOnly
              value={loading ? 'Loading script...' : scriptContent}
              style={{ ...getTextareaStyle(theme.colors), opacity: 0.6 }}
            />
          </>
        ) : checkMode === 'ansible' ? (
          <AnsibleFlowFields data={data} flows={ansibleFlows} filterMode="read_only" />
        ) : (
          <>
            <label style={getLabelStyle()}>CLI Commands</label>
            <textarea
              className="nodrag"
              value={data.commandsText || ''}
              onChange={(e) => data.updateNodeData && data.updateNodeData({
                commandsText: e.target.value
              })}
              placeholder="one command per line..."
              style={getTextareaStyle(theme.colors)}
            />
          </>
        )}
      </div>
    </FlowiseCard>
  );
}

function ConfigDeployNode({ id, data, selected }) {
  const { styles, theme } = useTheme();
  const ansibleFlows = useAnsibleFlowsList();
  const deployMode = data.deployMode || 'cli';

  const commandsText = data.commandsText || '';
  const variables = data.variables || {};

  const detectedVars = useMemo(() => {
    const regex = /\{\{\s*([a-zA-Z0-9_-]+)\s*\}\}/g;
    let match;
    const found = [];
    while ((match = regex.exec(commandsText)) !== null) {
      const varName = match[1];
      if (!found.includes(varName)) {
        found.push(varName);
      }
    }
    return found;
  }, [commandsText]);

  useEffect(() => {
    const updatedVars = { ...variables };
    let changed = false;
    
    detectedVars.forEach(v => {
      if (updatedVars[v] === undefined) {
        updatedVars[v] = '';
        changed = true;
      }
    });

    Object.keys(updatedVars).forEach(v => {
      if (!detectedVars.includes(v)) {
        delete updatedVars[v];
        changed = true;
      }
    });

    if (changed && data.updateNodeData) {
      data.updateNodeData({ variables: updatedVars });
    }
  }, [detectedVars]);

  return (
    <FlowiseCard
      title="Config Deploy"
      icon="⚡"
      color={theme.colors.danger}
      status={data.status}
      themeColors={theme.colors}
      styles={styles}
      width={data.width}
    >
      {renderFloatingToolbar(selected, () => data.onEdit(), data.onDelete, theme.colors)}
      <Handle type="target" position={Position.Left} style={handleStyle(theme.colors)} />
      <Handle type="source" position={Position.Right} style={handleStyle(theme.colors)} />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <label style={getLabelStyle()}>Deployment Mode</label>
        <select
          className="nodrag"
          value={deployMode}
          onChange={(e) => data.updateNodeData && data.updateNodeData({ deployMode: e.target.value })}
          style={getInputStyle(theme.colors)}
        >
          <option value="cli">Deployment Script</option>
          <option value="ansible">Ansible Playbook</option>
        </select>

        {deployMode === 'ansible' ? (
          <AnsibleFlowFields data={data} flows={ansibleFlows} filterMode={null} />
        ) : (
          <>
            <label style={getLabelStyle()}>Deployment Script</label>
            <textarea
              className="nodrag"
              value={commandsText}
              onChange={(e) => data.updateNodeData && data.updateNodeData({ commandsText: e.target.value })}
              placeholder="system-view..."
              style={getTextareaStyle(theme.colors)}
            />

            {detectedVars.length > 0 && (
              <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 9, fontWeight: '800', color: theme.colors.primary }}>📝 VARIABLES</span>
                {detectedVars.map(v => (
                  <div key={v} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ fontSize: 9, color: '#94a3b8', fontFamily: 'monospace' }}>{v}:</span>
                    <input
                      className="nodrag"
                      value={variables[v] || ''}
                      onChange={(e) => {
                        const newVars = { ...variables, [v]: e.target.value };
                        data.updateNodeData && data.updateNodeData({ variables: newVars });
                      }}
                      placeholder="enter value..."
                      style={{ ...getInputStyle(theme.colors), padding: '4px 8px', fontSize: '10px' }}
                    />
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </FlowiseCard>
  );
}

function PostCheckNode({ id, data, selected }) {
  const { styles, theme } = useTheme();
  const [scriptContent, setScriptContent] = useState('');
  const [loading, setLoading] = useState(false);
  const ansibleFlows = useAnsibleFlowsList();
  const checkMode = data.checkMode || (data.useYamlCommands ? 'yaml' : 'custom');

  const scriptProfiles = useMemo(() => {
    return getScriptProfilesForNode(
      id,
      data.nodes || [],
      data.edges || [],
      data.deviceGroups || [],
      data.devicesList || [],
      data.availableCommandsList || []
    );
  }, [id, data.nodes, data.edges, data.deviceGroups, data.devicesList, data.availableCommandsList]);

  useEffect(() => {
    if (data.useYamlCommands && scriptProfiles.length > 0) {
      const isValid = scriptProfiles.some(p => p.path === data.yamlScriptPath);
      if (!isValid) {
        const defaultPath = scriptProfiles[0].path;
        data.updateNodeData && data.updateNodeData({ yamlScriptPath: defaultPath });
      }
    }
  }, [scriptProfiles, data.yamlScriptPath, data.useYamlCommands]);

  useEffect(() => {
    if (!data.useYamlCommands || !data.yamlScriptPath) {
      setScriptContent('');
      return;
    }
    const filename = data.yamlScriptPath.split('/').pop();
    if (!filename) return;

    let isMounted = true;
    setLoading(true);
    const apiKey = sessionStorage.getItem('app_password') || '';
    
    axios.get(`/api/commands/${filename}/content`, {
      headers: { 'x-api-key': apiKey }
    }).then(res => {
      if (isMounted && res.data && res.data.content) {
        setScriptContent(res.data.content);
        if (data.updateNodeData && data.commandsText !== res.data.content) {
          data.updateNodeData({ 
            commandsText: res.data.content, 
            commandsCount: res.data.content.split('\n').filter(Boolean).length 
          });
        }
      }
    }).catch(err => {
      console.error(err);
      if (isMounted) setScriptContent('Error loading script.');
    }).finally(() => {
      if (isMounted) setLoading(false);
    });

    return () => {
      isMounted = false;
    };
  }, [data.yamlScriptPath, data.useYamlCommands]);

  return (
    <FlowiseCard
      title="Post-Checks"
      icon="🧪"
      color="#06b6d4"
      status={data.status}
      themeColors={theme.colors}
      styles={styles}
      width={data.width}
    >
      {renderFloatingToolbar(selected, () => data.onEdit(), data.onDelete, theme.colors)}
      <Handle type="target" position={Position.Left} style={handleStyle(theme.colors)} />
      <Handle type="source" position={Position.Right} style={handleStyle(theme.colors)} />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
          <input
            className="nodrag"
            type="checkbox"
            id={`auto-rollback-${id}`}
            checked={data.autoRollback !== false}
            onChange={(e) => data.updateNodeData && data.updateNodeData({ autoRollback: e.target.checked })}
            style={{ width: 12, height: 12, accentColor: theme.colors.primary, cursor: 'pointer' }}
          />
          <label htmlFor={`auto-rollback-${id}`} style={{ fontSize: '9px', fontWeight: '700', color: theme.colors.primary, cursor: 'pointer' }}>
            Auto-Rollback on fail
          </label>
        </div>

        <label style={getLabelStyle()}>Check Mode</label>
        <select
          className="nodrag"
          value={checkMode}
          onChange={(e) => {
            const mode = e.target.value;
            if (mode === 'yaml') {
              const firstPath = scriptProfiles[0]?.path || '';
              data.updateNodeData && data.updateNodeData({
                checkMode: 'yaml',
                useYamlCommands: true,
                yamlScriptPath: firstPath
              });
            } else if (mode === 'ansible') {
              data.updateNodeData && data.updateNodeData({
                checkMode: 'ansible',
                useYamlCommands: false
              });
            } else {
              data.updateNodeData && data.updateNodeData({
                checkMode: 'custom',
                useYamlCommands: false
              });
            }
          }}
          style={getInputStyle(theme.colors)}
        >
          <option value="custom">Custom CLI Text</option>
          <option value="yaml">Command Profile</option>
          <option value="ansible">Ansible Script</option>
        </select>

        {checkMode === 'yaml' ? (
          <>
            <label style={getLabelStyle()}>Diagnostics Profile</label>
            <select
              className="nodrag"
              value={data.yamlScriptPath || ''}
              onChange={(e) => data.updateNodeData && data.updateNodeData({ yamlScriptPath: e.target.value })}
              style={getInputStyle(theme.colors)}
            >
              {scriptProfiles.length === 0 ? (
                <option value="">No profiles found</option>
              ) : (
                scriptProfiles.map((p) => (
                  <option key={p.path} value={p.path}>{p.name}</option>
                ))
              )}
            </select>
            <label style={getLabelStyle()}>Script Preview</label>
            <textarea
              className="nodrag"
              readOnly
              value={loading ? 'Loading script...' : scriptContent}
              style={{ ...getTextareaStyle(theme.colors), opacity: 0.6 }}
            />
          </>
        ) : checkMode === 'ansible' ? (
          <AnsibleFlowFields data={data} flows={ansibleFlows} filterMode="read_only" />
        ) : (
          <>
            <label style={getLabelStyle()}>Verification Checks</label>
            <textarea
              className="nodrag"
              value={data.commandsText || ''}
              onChange={(e) => data.updateNodeData && data.updateNodeData({
                commandsText: e.target.value
              })}
              placeholder="one command per line..."
              style={getTextareaStyle(theme.colors)}
            />
          </>
        )}
      </div>
    </FlowiseCard>
  );
}

function GitCommitNode({ id, data, selected }) {
  const { styles, theme } = useTheme();
  return (
    <FlowiseCard
      title="Git Commit"
      icon="📦"
      color="#8b5cf6"
      status={data.status}
      themeColors={theme.colors}
      styles={styles}
      width={data.width}
    >
      {renderFloatingToolbar(selected, () => data.onEdit(), data.onDelete, theme.colors)}
      <Handle type="target" position={Position.Left} style={handleStyle(theme.colors)} />
      <Handle type="source" position={Position.Right} style={handleStyle(theme.colors)} />
      <div style={{ fontSize: 11, opacity: 0.8 }}>Tracks change audit logs</div>
      <div style={{ fontSize: 9, color: theme.colors.gray, marginTop: 4 }}>Committed config change to Git timeline.</div>
    </FlowiseCard>
  );
}

function NotificationNode({ id, data, selected }) {
  const { styles, theme } = useTheme();
  return (
    <FlowiseCard
      title="Alert Notify"
      icon="🔔"
      color="#d946ef"
      status={data.status}
      themeColors={theme.colors}
      styles={styles}
      width={data.width}
    >
      {renderFloatingToolbar(selected, () => data.onEdit(), data.onDelete, theme.colors)}
      <Handle type="target" position={Position.Left} style={handleStyle(theme.colors)} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <label style={getLabelStyle()}>Webhook URL</label>
        <input
          className="nodrag"
          value={data.webhook || ''}
          onChange={(e) => data.updateNodeData && data.updateNodeData({ webhook: e.target.value })}
          placeholder="http://..."
          style={getInputStyle(theme.colors)}
        />
      </div>
    </FlowiseCard>
  );
}

function DelayNode({ id, data, selected }) {
  const { styles, theme } = useTheme();
  return (
    <FlowiseCard
      title="Time Delay"
      icon="⏱️"
      color={theme.colors.info}
      status={data.status}
      themeColors={theme.colors}
      styles={styles}
      width={data.width}
    >
      {renderFloatingToolbar(selected, () => data.onEdit(), data.onDelete, theme.colors)}
      <Handle type="target" position={Position.Left} style={handleStyle(theme.colors)} />
      <Handle type="source" position={Position.Right} style={handleStyle(theme.colors)} />
      
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <label style={getLabelStyle()}>Wait Duration</label>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input
            type="number"
            className="nodrag"
            min="1"
            value={data.delayTime || 10}
            onChange={(e) => data.updateNodeData && data.updateNodeData({ delayTime: parseInt(e.target.value) || 1 })}
            style={{ ...getInputStyle(theme.colors), flex: 1, minWidth: 40 }}
          />
          <select
            className="nodrag"
            value={data.delayUnit || 'minutes'}
            onChange={(e) => data.updateNodeData && data.updateNodeData({ delayUnit: e.target.value })}
            style={{ ...getInputStyle(theme.colors), width: 90 }}
          >
            <option value="seconds">Sec</option>
            <option value="minutes">Min</option>
            <option value="hours">Hours</option>
          </select>
        </div>
      </div>
      <div style={{ fontSize: 9, color: theme.colors.gray, marginTop: 4 }}>Pauses execution path.</div>
    </FlowiseCard>
  );
}

function LogicNode({ id, data, selected }) {
  const { styles, theme } = useTheme();
  return (
    <FlowiseCard
      title="Logic Gate"
      icon="🔀"
      color={theme.colors.primary}
      status={data.status}
      themeColors={theme.colors}
      styles={styles}
      width={data.width}
    >
      {renderFloatingToolbar(selected, () => data.onEdit(), data.onDelete, theme.colors)}
      <Handle type="target" position={Position.Left} style={handleStyle(theme.colors)} />
      <Handle type="source" position={Position.Right} style={handleStyle(theme.colors)} />
      
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <label style={getLabelStyle()}>Operator</label>
        <select
          className="nodrag"
          value={data.operator || 'IF'}
          onChange={(e) => data.updateNodeData && data.updateNodeData({ operator: e.target.value })}
          style={getInputStyle(theme.colors)}
        >
          <option value="IF">IF Condition</option>
          <option value="AND">AND Operator</option>
          <option value="OR">OR Operator</option>
        </select>
      </div>
      <div style={{ fontSize: 9, color: theme.colors.gray, marginTop: 4 }}>Evaluation logic control.</div>
    </FlowiseCard>
  );
}

function CustomNode({ id, data, selected }) {
  const { styles, theme } = useTheme();
  return (
    <FlowiseCard
      title={data.title || 'Custom Node'}
      icon={data.icon || '🛠️'}
      color={data.color || theme.colors.primary}
      status={data.status}
      themeColors={theme.colors}
      styles={styles}
      width={data.width}
    >
      {renderFloatingToolbar(selected, () => data.onEdit(), data.onDelete, theme.colors)}
      <Handle type="target" position={Position.Left} style={handleStyle(theme.colors)} />
      <Handle type="source" position={Position.Right} style={handleStyle(theme.colors)} />
      
      <div style={{ fontSize: 11, color: theme.colors.light, fontWeight: 500, whiteSpace: 'normal', wordBreak: 'break-word' }}>
        {data.description || 'Custom configured toolbox element.'}
      </div>
    </FlowiseCard>
  );
}

function AIAgentNode({ id, data, selected }) {
  const { styles, theme } = useTheme();
  return (
    <FlowiseCard
      title="AI Agent"
      icon="🤖"
      color={theme.colors.info}
      status={data.status}
      themeColors={theme.colors}
      styles={styles}
      width={data.width}
    >
      {renderFloatingToolbar(selected, () => data.onEdit(), data.onDelete, theme.colors)}
      <Handle type="target" position={Position.Left} style={handleStyle(theme.colors)} />
      <Handle type="source" position={Position.Right} style={handleStyle(theme.colors)} />
      
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <label style={getLabelStyle()}>Model Task</label>
        <textarea
          className="nodrag"
          rows={2}
          value={data.promptGoal || 'Analyze configuration diffs and output safety reports.'}
          onChange={(e) => data.updateNodeData && data.updateNodeData({ promptGoal: e.target.value })}
          style={{ ...getInputStyle(theme.colors), fontSize: 10, fontFamily: 'sans-serif', resize: 'none' }}
        />
      </div>
      <div style={{ fontSize: 9, color: theme.colors.gray, marginTop: 4 }}>Ollama-powered AI analysis.</div>
    </FlowiseCard>
  );
}

const nodeTypes = {
  startNode: StartNode,
  deviceSelectNode: DeviceSelectNode,
  preCheckNode: PreCheckNode,
  configDeployNode: ConfigDeployNode,
  postCheckNode: PostCheckNode,
  gitCommitNode: GitCommitNode,
  notificationNode: NotificationNode,
  delayNode: DelayNode,
  logicNode: LogicNode,
  customNode: CustomNode,
  aiAgentNode: AIAgentNode
};

// Helper to parse log strings into structured objects
const parseLogLine = (line) => {
  if (typeof line !== 'string') return line;
  const match = line.match(/^\[(\d{2}:\d{2}:\d{2})\]\s+(.*)$/);
  if (match) {
    return {
      timestamp: match[1],
      level: 'INFO',
      content: match[2],
      raw: line
    };
  }
  return {
    timestamp: '',
    level: 'INFO',
    content: line,
    raw: line
  };
};

// ==========================================
// 🚀 Main Automation Dashboard Component
// ==========================================

export default function Automation() {
  const { config, styles, theme } = useTheme();
  const { colors } = theme;
  const { isAdmin, isViewer } = useAuth();
  const isDark = config.mode === 'dark';
  // Independent of the "ansible" tab's own ansibleFlows state below (which
  // only fetches when that tab is active) — the Inspector needs the flow
  // list on the designer tab too, so it fetches on mount like the node cards do.
  const designerAnsibleFlows = useAnsibleFlowsList();

  // File Input Ref for workflows JSON import
  const fileInputRef = useRef(null);

  // Collapsible workspace states
  const [toolboxExpanded, setToolboxExpanded] = useState(true);
  const [inspectorExpanded, setInspectorExpanded] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  // Inspector's own maximize — separate from canvas isFullscreen above, since
  // fields like the Ansible playbook script preview need real reading room
  // that the 350px sidebar can't give without maximizing the whole canvas too.
  const [inspectorMaximized, setInspectorMaximized] = useState(false);

  // Navigation tab bar state
  const [activeTab, setActiveTab] = useState('designer');
  const [historyList, setHistoryList] = useState([]);

  // Ansible Flows tab state — playbook list, collection list, upload/install forms.
  // Deliberately never triggers execution — this UI only lists, uploads, and
  // installs; there is no "run" action wired anywhere here.
  const [ansibleFlows, setAnsibleFlows] = useState([]);
  const [ansibleCollections, setAnsibleCollections] = useState("");
  const [ansibleLoading, setAnsibleLoading] = useState(false);
  const [ansibleMessage, setAnsibleMessage] = useState(null);
  const [newCollectionName, setNewCollectionName] = useState("");
  const [newCollectionVersion, setNewCollectionVersion] = useState("");
  const [selectedPlaybookFile, setSelectedPlaybookFile] = useState(null);
  const [flowContentPreview, setFlowContentPreview] = useState(null);

  const refreshAnsibleFlows = useCallback(async () => {
    try {
      const res = await axios.get(`${API}/ansible/flows`);
      setAnsibleFlows(res.data || []);
    } catch (e) {
      setAnsibleMessage({ type: "error", text: "Failed to list flows: " + (e.response?.data?.detail || e.message) });
    }
  }, []);

  const refreshAnsibleCollections = useCallback(async () => {
    try {
      const res = await axios.get(`${API}/ansible/collections`);
      setAnsibleCollections(res.data?.stdout || "");
    } catch (e) {
      setAnsibleMessage({ type: "error", text: "Failed to list collections: " + (e.response?.data?.detail || e.message) });
    }
  }, []);

  useEffect(() => {
    if (activeTab === "ansible") {
      refreshAnsibleFlows();
      refreshAnsibleCollections();
    }
  }, [activeTab, refreshAnsibleFlows, refreshAnsibleCollections]);

  const handleUploadPlaybook = async () => {
    if (!selectedPlaybookFile) return;
    setAnsibleLoading(true);
    setAnsibleMessage(null);
    try {
      const formData = new FormData();
      formData.append("file", selectedPlaybookFile);
      await axios.post(`${API}/ansible/flows/upload`, formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setAnsibleMessage({ type: "success", text: `${selectedPlaybookFile.name} uploaded and passed syntax-check.` });
      setSelectedPlaybookFile(null);
      refreshAnsibleFlows();
    } catch (e) {
      setAnsibleMessage({ type: "error", text: "Upload rejected: " + (e.response?.data?.detail || e.message) });
    } finally {
      setAnsibleLoading(false);
    }
  };

  const handleInstallCollection = async () => {
    if (!newCollectionName.trim()) return;
    setAnsibleLoading(true);
    setAnsibleMessage(null);
    try {
      await axios.post(`${API}/ansible/collections/install`, {
        name: newCollectionName.trim(),
        version: newCollectionVersion.trim() || null,
      });
      setAnsibleMessage({ type: "success", text: `${newCollectionName} installed.` });
      setNewCollectionName("");
      setNewCollectionVersion("");
      refreshAnsibleCollections();
    } catch (e) {
      setAnsibleMessage({ type: "error", text: "Install failed: " + (e.response?.data?.detail?.stderr || e.response?.data?.detail || e.message) });
    } finally {
      setAnsibleLoading(false);
    }
  };

  const handleViewFlow = async (name) => {
    try {
      const res = await axios.get(`${API}/ansible/flows/${name}`);
      setFlowContentPreview({ name, content: res.data.content });
    } catch (e) {
      setAnsibleMessage({ type: "error", text: "Failed to load flow: " + (e.response?.data?.detail || e.message) });
    }
  };

  const handleSyntaxCheckFlow = async (name) => {
    setAnsibleLoading(true);
    try {
      const res = await axios.post(`${API}/ansible/flows/${name}/syntax-check`);
      setAnsibleMessage({
        type: res.data.ok ? "success" : "error",
        text: `${name}: ${res.data.ok ? "syntax OK" : res.data.stderr.slice(0, 300)}`,
      });
    } catch (e) {
      setAnsibleMessage({ type: "error", text: "Syntax check failed: " + (e.response?.data?.detail || e.message) });
    } finally {
      setAnsibleLoading(false);
    }
  };
  const [filterTaskId, setFilterTaskId] = useState("");
  const [filterWorkflowName, setFilterWorkflowName] = useState("");
  const [filterTargetDevices, setFilterTargetDevices] = useState("");
  const [filterStartTime, setFilterStartTime] = useState("");
  const [filterStatus, setFilterStatus] = useState("All");

  const filteredHistoryList = useMemo(() => {
    return historyList.filter(run => {
      if (filterTaskId && !run.task_id?.toLowerCase().includes(filterTaskId.toLowerCase())) {
        return false;
      }
      if (filterWorkflowName && !run.flow_name?.toLowerCase().includes(filterWorkflowName.toLowerCase())) {
        return false;
      }
      if (filterTargetDevices) {
        const query = filterTargetDevices.toLowerCase();
        const devices = Array.isArray(run.devices) ? run.devices : [];
        const match = devices.some(d => d?.toLowerCase().includes(query));
        if (!match) return false;
      }
      if (filterStartTime) {
        const dateStr = new Date(run.started_at).toLocaleString().toLowerCase();
        if (!dateStr.includes(filterStartTime.toLowerCase())) {
          return false;
        }
      }
      if (filterStatus !== "All" && run.status !== filterStatus) {
        return false;
      }
      return true;
    });
  }, [historyList, filterTaskId, filterWorkflowName, filterTargetDevices, filterStartTime, filterStatus]);
  
  // Floating Console Modal states (Req 1)
  const [consoleModalOpen, setConsoleModalOpen] = useState(false);
  const [consoleModalData, setConsoleModalData] = useState(null);
  const [consoleActiveTab, setConsoleActiveTab] = useState("logs");
  const [consoleSelectedDevice, setConsoleSelectedDevice] = useState("");
  const [isConsoleMinimized, setIsConsoleMinimized] = useState(false);
  const [consolePosition, setConsolePosition] = useState({ x: 200, y: 100 });
  const [isDraggingConsole, setIsDraggingConsole] = useState(false);
  const [consoleDragOffset, setConsoleDragOffset] = useState({ x: 0, y: 0 });

  // Custom node templates (localStorage persistent)
  const [customNodeTemplates, setCustomNodeTemplates] = useState(() => {
    try {
      const saved = localStorage.getItem("custom_node_templates");
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  // Modal states for creating custom nodes
  const [isCustomNodeModalOpen, setIsCustomNodeModalOpen] = useState(false);
  const [customNodeForm, setCustomNodeForm] = useState({
    title: "",
    description: "",
    icon: "🛠️",
    color: "#6366f1",
    parameters: []
  });

  const handleAddFormParameter = () => {
    setCustomNodeForm(prev => ({
      ...prev,
      parameters: [...(prev.parameters || []), { key: "", value: "" }]
    }));
  };

  const handleUpdateFormParameter = (index, field, value) => {
    setCustomNodeForm(prev => {
      const updated = [...(prev.parameters || [])];
      updated[index] = { ...updated[index], [field]: value };
      return { ...prev, parameters: updated };
    });
  };

  const handleRemoveFormParameter = (index) => {
    setCustomNodeForm(prev => {
      const updated = (prev.parameters || []).filter((_, i) => i !== index);
      return { ...prev, parameters: updated };
    });
  };

  const handleCreateCustomNodeSubmit = (e) => {
    if (e) e.preventDefault();
    if (!customNodeForm.title.trim()) return;
    const paramMap = {};
    (customNodeForm.parameters || []).forEach(p => {
      if (p.key.trim()) {
        paramMap[p.key.trim()] = p.value;
      }
    });
    const newTemplate = {
      title: customNodeForm.title.trim(),
      description: customNodeForm.description.trim(),
      icon: customNodeForm.icon,
      color: customNodeForm.color,
      parameters: paramMap
    };
    const updated = [...customNodeTemplates, newTemplate];
    setCustomNodeTemplates(updated);
    localStorage.setItem("custom_node_templates", JSON.stringify(updated));
    // Reset form
    setCustomNodeForm({
      title: "",
      description: "",
      icon: "🛠️",
      color: "#6366f1",
      parameters: []
    });
    setIsCustomNodeModalOpen(false);
  };
  
  // Draggable Console dragging logic (Requirement 1)
  useEffect(() => {
    const handleMouseMove = (e) => {
      if (isDraggingConsole) {
        setConsolePosition({
          x: e.clientX - consoleDragOffset.x,
          y: e.clientY - consoleDragOffset.y
        });
      }
    };

    const handleMouseUp = () => {
      setIsDraggingConsole(false);
    };

    if (isDraggingConsole) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    }

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDraggingConsole, consoleDragOffset]);

  // Nodes & Edges visual states
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selectedNode, setSelectedNode] = useState(null);

  // Keep a mutable ref of the nodes state to prevent stale closure captures in toolbar callbacks
  const nodesRef = useRef(nodes);
  const initialLoadDone = useRef(false);
  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  const [nodeWidth, setNodeWidth] = useState(220);
  const [deviceGroups, setDeviceGroups] = useState([]);
  const [availableCommandsList, setAvailableCommandsList] = useState([]);

  // Raw Inventory states for Target Select Grid
  const [devicesList, setDevicesList] = useState([]);
  const [searchName, setSearchName] = useState('');
  const [searchIp, setSearchIp] = useState('');
  const [filterGroup, setFilterGroup] = useState('');
  const [filterVendor, setFilterVendor] = useState('');
  const [tickedDevices, setTickedDevices] = useState([]);

  // Workflow Templates state
  const [workflows, setWorkflows] = useState([]);
  const [currentWorkflowName, setCurrentWorkflowName] = useState('IPTV Loopback Automation');
  const [activeWorkflowId, setActiveWorkflowId] = useState('');

  // Saved Workflows Templates tab — search + category filter, needed once
  // the template list grows past a handful (e.g. the 55 auto-generated
  // per-method SolidServer flows) and scanning the raw table stops scaling.
  const [templateSearch, setTemplateSearch] = useState('');
  const [templateCategory, setTemplateCategory] = useState('All');

  // Terminal Execution states
  const [logs, setLogs] = useState([]);
  const [isRunning, setIsRunning] = useState(false);
  const [activeTaskId, setActiveTaskId] = useState(null);
  const [executionDetail, setExecutionDetail] = useState(null);
  const [activeTabDetail, setActiveTabDetail] = useState("logs"); // 'logs' | 'console' | 'diff'
  const [selectedDetailDevice, setSelectedDetailDevice] = useState("");

  // Inspector override states
  const [isGridModalOpen, setIsGridModalOpen] = useState(false);

  // Connect edges manually
  const onConnect = useCallback((params) => {
    setEdges((eds) => {
      const newEdge = {
        ...params,
        id: `edge_${params.source}_${params.target}`,
        type: 'buttonEdge',
        animated: true,
        markerEnd: { type: MarkerType.ArrowClosed },
        data: {
          onDelete: (edgeId) => {
            if (window.confirm("Delete connection link?")) {
              setEdges((prevEdges) => prevEdges.filter((e) => e.id !== edgeId));
            }
          }
        }
      };
      return addEdge(newEdge, eds);
    });
  }, [setEdges]);

  // Handle Edit Action from node floating toolbars
  const handleEditNode = useCallback((node) => {
    setSelectedNode(node);
    setInspectorExpanded(true); // Always expand inspector on edit
    if (node.type === 'deviceSelectNode') {
      setFilterGroup(node.data.group || '');
      setFilterVendor(node.data.vendor || '');
      setTickedDevices(node.data.tickedDevices || []);
    }
  }, []);

  // Handle Delete Action from node floating toolbars
  const handleDeleteNode = useCallback((nodeId) => {
    setNodes((nds) => {
      const filtered = nds.filter((n) => n.id !== nodeId);
      return filtered.map(item => ({
        ...item,
        data: {
          ...item.data,
          nodes: filtered
        }
      }));
    });
    setEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId));
    setSelectedNode((prev) => (prev && prev.id === nodeId ? null : prev));
  }, []);

  // Dynamic injector of callback handlers and lists into visual nodes state
  const bindNodeCallbacks = useCallback((nds) => {
    return nds.map((node) => ({
      ...node,
      data: {
        ...node.data,
        nodes: nds,
        edges,
        deviceGroups,
        availableCommandsList,
        devicesList,
        width: nodeWidth,
        updateNodeData: (newData) => {
          setNodes((prevNodes) => {
            const updated = prevNodes.map((n) => {
              if (n.id === node.id) {
                const updatedData = { ...n.data, ...newData };
                if (updatedData.commandsText !== undefined) {
                  updatedData.commandsCount = updatedData.commandsText.split('\n').filter(Boolean).length;
                }
                return { ...n, data: updatedData };
              }
              return n;
            });
            return updated.map(item => ({
              ...item,
              data: {
                ...item.data,
                nodes: updated,
                edges
              }
            }));
          });
        },
        onEdit: () => {
          const latestNode = nodesRef.current.find(n => n.id === node.id);
          if (latestNode) handleEditNode(latestNode);
        },
        onDelete: () => handleDeleteNode(node.id)
      }
    }));
  }, [handleEditNode, handleDeleteNode, deviceGroups, availableCommandsList, devicesList, nodeWidth, setNodes, edges]);

  // Dynamic injector of callback handlers for edges
  const bindEdgeCallbacks = useCallback((eds) => {
    return eds.map((edge) => ({
      ...edge,
      type: 'buttonEdge',
      data: {
        onDelete: (edgeId) => {
          if (window.confirm("Delete connection link?")) {
            setEdges((prevEdges) => prevEdges.filter((e) => e.id !== edgeId));
          }
        }
      }
    }));
  }, [setEdges]);

  // Load Saved Workflows & Devices lists
  const loadWorkflowList = useCallback(async () => {
    try {
      const apiKey = sessionStorage.getItem('app_password') || '';
      const wRes = await axios.get(`${API}/flows`, {
        headers: { 'x-api-key': apiKey }
      });
      setWorkflows(wRes.data);
      
      const dRes = await axios.get(`${CORE_API}/devices`, {
        headers: { 'x-api-key': apiKey }
      });
      setDevicesList(dRes.data || []);

      const gRes = await axios.get(`${CORE_API}/device-groups`, {
        headers: { 'x-api-key': apiKey }
      });
      setDeviceGroups(gRes.data || []);

      const cRes = await axios.get(`${CORE_API}/commands`, {
        headers: { 'x-api-key': apiKey }
      });
      setAvailableCommandsList(cRes.data || []);

      const hRes = await axios.get(`${API}/executions`, {
        headers: { 'x-api-key': apiKey }
      });
      setHistoryList(hRes.data || []);
    } catch (err) {
      console.error("Failed to boot inventory loader:", err);
    }
  }, []);

  useEffect(() => {
    loadWorkflowList();
  }, [loadWorkflowList]);

  // Auto-load first workflow if none active
  useEffect(() => {
    if (workflows.length > 0 && !activeWorkflowId && !initialLoadDone.current) {
      initialLoadDone.current = true;
      handleLoadWorkflow(workflows[0].id);
    }
  }, [workflows, activeWorkflowId]);

  // Set default nodes layout if empty
  const initializeDefaultGraph = () => {
    const defaultNodes = [
      { id: "start", type: "startNode", position: { x: 80, y: 150 }, data: { status: 'idle', triggerMode: 'Manual' } },
      { id: "device_select", type: "deviceSelectNode", position: { x: 340, y: 150 }, data: { status: 'idle', tickedDevices: [], group: '', vendor: '' } },
      { id: "pre_check", type: "preCheckNode", position: { x: 600, y: 150 }, data: { status: 'idle', cpuThreshold: 90, useYamlCommands: false, commandsText: 'show ip interface brief\nshow version' } },
      { id: "deploy", type: "configDeployNode", position: { x: 860, y: 150 }, data: { status: 'idle', commandsText: 'interface GigabitEthernet1\n description Configured by visual ReactFlow' } },
      { id: "post_check", type: "postCheckNode", position: { x: 1120, y: 150 }, data: { status: 'idle', autoRollback: true, useYamlCommands: false, commandsText: 'show ip interface brief\nshow version' } },
      { id: "commit", type: "gitCommitNode", position: { x: 1380, y: 150 }, data: { status: 'idle' } },
      { id: "notify", type: "notificationNode", position: { x: 1640, y: 150 }, data: { status: 'idle', webhook: '' } }
    ];

    const defaultEdges = [
      { id: "edge_start_device", source: "start", target: "device_select" },
      { id: "edge_device_pre", source: "device_select", target: "pre_check" },
      { id: "edge_pre_deploy", source: "pre_check", target: "deploy" },
      { id: "edge_deploy_post", source: "deploy", target: "post_check" },
      { id: "edge_post_commit", source: "post_check", target: "commit" },
      { id: "edge_commit_notify", source: "commit", target: "notify" }
    ];

    setNodes(bindNodeCallbacks(defaultNodes));
    setEdges(bindEdgeCallbacks(defaultEdges));
    setSelectedNode(null);
    setActiveWorkflowId('');
  };

  // Re-bind callbacks when list properties change
  useEffect(() => {
    if (nodes.length > 0) {
      setNodes((nds) => bindNodeCallbacks(nds));
    }
  }, [deviceGroups, availableCommandsList, devicesList, nodeWidth]);

  // Save current graph to backend
  const handleSaveWorkflow = async () => {
    if (!currentWorkflowName.trim()) return;
    const { nodes: cleanNodes, edges: cleanEdges } = cleanGraphData(nodes, edges);
    const workflowPayload = {
      id: activeWorkflowId || undefined,
      name: currentWorkflowName,
      description: flowDesc || "Network automation pipeline",
      nodes: cleanNodes,
      edges: cleanEdges
    };
    try {
      const apiKey = sessionStorage.getItem('app_password') || '';
      const res = await axios.post(`${API}/flows`, workflowPayload, {
        headers: { 'x-api-key': apiKey }
      });
      alert(`Workflow "${currentWorkflowName}" saved successfully!`);
      loadWorkflowList();
      if (res.data && res.data.flow_id) {
        setActiveWorkflowId(res.data.flow_id);
      }
    } catch (err) {
      console.error("Failed to save workflow:", err);
      alert("Error saving flow to backend: " + err.message);
    }
  };

  const flowDesc = useMemo(() => {
    return `ReactFlow automation pipeline with ${nodes.length} nodes`;
  }, [nodes]);

  // Load workflow template from backend
  const handleLoadWorkflow = async (id) => {
    try {
      const apiKey = sessionStorage.getItem('app_password') || '';
      const res = await axios.get(`${API}/flows/${id}`, {
        headers: { 'x-api-key': apiKey }
      });
      if (res.data) {
        setCurrentWorkflowName(res.data.name);
        
        // Convert clean stored nodes back into local state with positions
        const restoredNodes = res.data.nodes.map(n => ({
          id: n.id,
          type: n.type,
          position: n.position || { x: 100, y: 100 },
          data: n.data || {}
        }));
        
        setNodes(bindNodeCallbacks(restoredNodes));
        setEdges(bindEdgeCallbacks(res.data.edges || []));
        setActiveWorkflowId(id);
        setSelectedNode(null);
        setActiveTab("designer");
      }
    } catch (err) {
      console.error("Failed to load workflow data:", err);
    }
  };

  // Delete workflow template
  const handleDeleteWorkflowTemplate = async (id, name, e) => {
    e.stopPropagation();
    if (!confirm(`Are you sure you want to delete workflow template "${name}"?`)) return;
    try {
      const apiKey = sessionStorage.getItem('app_password') || '';
      await axios.delete(`${API}/flows/${id}`, {
        headers: { 'x-api-key': apiKey }
      });
      setWorkflows(prev => prev.filter(w => w.id !== id));
      if (activeWorkflowId === id) {
        setActiveWorkflowId('');
        initializeDefaultGraph();
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Run Visual Flow
  const handleRunWorkflow = async () => {
    if (isRunning) return;
    
    // Save template changes first
    await handleSaveWorkflow();

    setIsRunning(true);
    setLogs([
      { timestamp: new Date().toLocaleTimeString(), level: 'SYSTEM', content: 'Queuing workflow pipeline execution run...', raw: '[SYSTEM] Queuing workflow pipeline execution run...' }
    ]);
    
    try {
      const { nodes: cleanNodes, edges: cleanEdges } = cleanGraphData(nodes, edges);
      const payload = {
        name: currentWorkflowName,
        nodes: cleanNodes,
        edges: cleanEdges
      };

      const apiKey = sessionStorage.getItem('app_password') || '';
      const res = await axios.post(`${API}/run-flow`, payload, {
        headers: { 'x-api-key': apiKey }
      });
      
      if (res.data && res.data.task_id) {
        setActiveTaskId(res.data.task_id);
        setExecutionDetail(null);
        setActiveTabDetail("logs");
      } else {
        setIsRunning(false);
        alert("Execution failed to start.");
      }
    } catch (e) {
      setIsRunning(false);
      alert("Error starting workflow: " + e.message);
    }
  };

  // Poll active task status
  useEffect(() => {
    if (!activeTaskId) return;
    
    const interval = setInterval(async () => {
      try {
        const apiKey = sessionStorage.getItem('app_password') || '';
        const res = await axios.get(`${API}/executions/${activeTaskId}`, {
          headers: { 'x-api-key': apiKey }
        });
        
        if (res.data) {
          const detail = res.data;
          setExecutionDetail(detail);
          
          // Parse and load structured logs
          if (detail.logs) {
            setLogs(detail.logs.map(l => parseLogLine(l.message || l)));
          }
          
          // Sync node status in designer canvas directly from task steps
          if (detail.nodes) {
            setNodes(prevNodes => prevNodes.map(n => {
              const updatedNode = detail.nodes.find(dn => dn.id === n.id);
              if (updatedNode && updatedNode.data) {
                return {
                  ...n,
                  data: {
                    ...n.data,
                    status: updatedNode.data.status || 'idle'
                  }
                };
              }
              return n;
            }));
          }

          if (detail.devices && detail.devices.length > 0 && !selectedDetailDevice) {
            setSelectedDetailDevice(detail.devices[0]);
          }

          if (detail.status !== "running" && detail.status !== "pending") {
            setIsRunning(false);
            setActiveTaskId(null);
            loadWorkflowList(); // Reload logs lists

            const isSuccess = detail.status === 'success' || detail.status === 'completed';
            const flowName = detail.flow_name || detail.name || currentWorkflowName || 'Automation';
            window.dispatchEvent(new CustomEvent('netact-notification', {
              detail: {
                type: 'automation',
                status: isSuccess ? 'success' : 'failed',
                title: 'Automation Complete',
                message: `Pipeline "${flowName}" execution ${isSuccess ? 'completed successfully' : 'failed'}.`,
                targetUrl: '/automation'
              }
            }));
          }
        }
      } catch (e) {
        console.error(e);
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [activeTaskId, selectedDetailDevice]);

  // Load old execution detailed logs
  const handleViewExecutionRun = async (taskId) => {
    try {
      const apiKey = sessionStorage.getItem('app_password') || '';
      const res = await axios.get(`${API}/executions/${taskId}`, {
        headers: { 'x-api-key': apiKey }
      });
      if (res.data) {
        const detail = res.data;
        setExecutionDetail(detail);
        if (detail.logs) {
          setLogs(detail.logs.map(l => parseLogLine(l.message || l)));
        }
        if (detail.devices && detail.devices.length > 0) {
          setSelectedDetailDevice(detail.devices[0]);
        }
        setActiveTabDetail("logs");
        setActiveTab("designer");
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleExportWorkflow = () => {
    const { nodes: cleanNodes, edges: cleanEdges } = cleanGraphData(nodes, edges);
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify({
      name: currentWorkflowName,
      description: flowDesc,
      nodes: cleanNodes,
      edges: cleanEdges
    }, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `${currentWorkflowName.toLowerCase().replace(/\s+/g, '_')}_workflow.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  const handleImportWorkflow = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target.result);
        if (parsed.name) setCurrentWorkflowName(parsed.name);
        
        const restoredNodes = (parsed.nodes || []).map(n => ({
          id: n.id,
          type: n.type,
          position: n.position || { x: 100, y: 100 },
          data: n.data || {}
        }));
        
        setNodes(bindNodeCallbacks(restoredNodes));
        setEdges(bindEdgeCallbacks(parsed.edges || []));
        setSelectedNode(null);
        alert("Workflow imported successfully!");
      } catch (err) {
        alert("Failed to parse workflow file: " + err.message);
      }
    };
    reader.readAsText(file);
    e.target.value = null;
  };

  // Client-side Export Workflow to local computer
  const handleExport = () => {
    handleExportWorkflow();
  };

  // Client-side Import Trigger
  const triggerImport = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const handleCreateNewWorkflow = () => {
    const name = prompt("Enter new workflow name:", "New Netflow Workflow");
    if (!name || !name.trim()) return;
    setCurrentWorkflowName(name.trim());
    setActiveWorkflowId("");
    initializeDefaultGraph();
  };

  // Add new node clicking toolbox
  const handleAddNodeFromToolbox = (type, customData = null) => {
    const id = `${type}_${Math.floor(Math.random() * 1000)}`;
    const position = { x: 300 + Math.random() * 80, y: 150 + Math.random() * 80 };
    
    let defaultData = { status: 'idle' };
    if (type === 'deviceSelectNode') {
      defaultData = { ...defaultData, tickedDevices: [], group: '', vendor: '' };
    } else if (type === 'preCheckNode' || type === 'postCheckNode') {
      defaultData = { ...defaultData, cpuThreshold: 90, useYamlCommands: false, commandsText: 'show version' };
    } else if (type === 'configDeployNode') {
      defaultData = { ...defaultData, commandsText: '' };
    } else if (type === 'notificationNode') {
      defaultData = { ...defaultData, webhook: '' };
    } else if (type === 'delayNode') {
      defaultData = { ...defaultData, delayTime: 10, delayUnit: 'minutes' };
    } else if (type === 'logicNode') {
      defaultData = { ...defaultData, operator: 'IF' };
    } else if (type === 'customNode') {
      if (customData) {
        defaultData = { 
          ...defaultData, 
          title: customData.title, 
          description: customData.description, 
          icon: customData.icon, 
          color: customData.color,
          parameters: customData.parameters ? JSON.parse(JSON.stringify(customData.parameters)) : {} 
        };
      } else {
        defaultData = { 
          ...defaultData, 
          title: 'Custom Node', 
          description: 'Custom configured element.', 
          icon: '🛠️', 
          color: '#6366f1',
          parameters: {} 
        };
      }
    } else if (type === 'aiAgentNode') {
      defaultData = { ...defaultData, promptGoal: 'Analyze configuration diffs and output safety reports.' };
    }

    const newNode = {
      id,
      type,
      position,
      data: defaultData
    };

    setNodes((prevNodes) => {
      const updated = [...prevNodes, newNode];
      return bindNodeCallbacks(updated);
    });
  };

  // Grid filter inventory logic
  const filteredInventoryList = useMemo(() => {
    return devicesList.filter(d => {
      const nameMatch = !searchName || d.hostname.toLowerCase().includes(searchName.toLowerCase());
      const ipMatch = !searchIp || d.ip_address.includes(searchIp);
      const grpMatch = !filterGroup || d.group_file === filterGroup || d.group === filterGroup;
      const vendMatch = !filterVendor || (
        filterVendor === 'cisco' ? (d.vendor.toLowerCase() === 'cisco') :
        filterVendor === 'cisco_xr' ? (d.vendor.toLowerCase() === 'cisco_xr') :
        filterVendor === 'juniper_junos' ? (d.vendor.toLowerCase() === 'juniper_junos' || d.vendor.toLowerCase().includes('juniper') || d.vendor.toLowerCase().includes('junos')) :
        d.vendor.toLowerCase() === filterVendor.toLowerCase()
      );
      return nameMatch && ipMatch && grpMatch && vendMatch;
    });
  }, [devicesList, searchName, searchIp, filterGroup, filterVendor]);

  const toggleDeviceSelection = (id) => {
    setTickedDevices(prev => {
      const updated = prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id];
      if (selectedNode) {
        selectedNode.data.updateNodeData({ tickedDevices: updated });
      }
      return updated;
    });
  };

  const selectAllFiltered = () => {
    const allFilteredIds = filteredInventoryList.map(d => d.id);
    const areAllSelected = allFilteredIds.every(id => tickedDevices.includes(id));
    
    let updated;
    if (areAllSelected) {
      updated = tickedDevices.filter(id => !allFilteredIds.includes(id));
    } else {
      updated = Array.from(new Set([...tickedDevices, ...allFilteredIds]));
    }
    
    setTickedDevices(updated);
    if (selectedNode) {
      selectedNode.data.updateNodeData({ tickedDevices: updated });
    }
  };

  // Console output log string mapping for details
  const selectedDeviceConsoleLog = useMemo(() => {
    if (!executionDetail || !selectedDetailDevice) return "";
    const pushStep = Object.values(executionDetail.steps).find(step => step.data && step.data[selectedDetailDevice]?.console_log);
    return pushStep ? pushStep.data[selectedDetailDevice].console_log : "No active CLI logs captured for this device.";
  }, [executionDetail, selectedDetailDevice]);

  const selectedDeviceDiff = useMemo(() => {
    if (!executionDetail || !selectedDetailDevice) return [];
    const diffStep = Object.values(executionDetail.steps).find(step => step.data && step.data[selectedDetailDevice]?.diff);
    return diffStep ? diffStep.data[selectedDetailDevice].diff : [];
  }, [executionDetail, selectedDetailDevice]);

  // ----------------------------------------------------
  // Console Modal Popup Component (Requirement 1)
  // ----------------------------------------------------
  const renderConsoleModal = () => {
    if (!consoleModalOpen || !consoleModalData) return null;

    const status = consoleModalData.status || 'pending';
    const flowName = consoleModalData.flow_name || consoleModalData.name || 'Workflow Run';
    const devices = consoleModalData.devices || [];
    const steps = consoleModalData.steps || {};

    const handleDownloadConsoleLogs = () => {
      let content = `NETAct Automation Console Logs\n`;
      content += `====================================\n`;
      content += `Workflow: ${flowName}\n`;
      content += `Task Run ID: ${consoleModalData.task_id}\n`;
      content += `Status: ${status.toUpperCase()}\n`;
      content += `Started At: ${consoleModalData.started_at}\n`;
      content += `Completed At: ${consoleModalData.completed_at || 'N/A'}\n`;
      content += `====================================\n\n`;

      content += `1. PIPELINE STEPS LOGS\n`;
      content += `---------------------\n`;
      const stepLogs = consoleModalData.logs || [];
      stepLogs.forEach(l => {
        content += `[${l.timestamp || ''}] ${l.message || l.content || l}\n`;
      });
      content += `\n`;

      content += `2. INTERACTIVE DEVICE SSH LOGS (DEEP DEBUG)\n`;
      content += `-----------------------------------------\n`;
      devices.forEach(d => {
        content += `Device: ${d}\n`;
        const pushStep = Object.values(steps).find(step => step.data && step.data[d]?.console_log);
        const cliLog = pushStep ? pushStep.data[d].console_log : "No active CLI logs captured.";
        content += `${cliLog}\n`;
        content += `-----------------------------------------\n`;
      });
      content += `\n`;

      content += `3. PRE/POST-HC CONFIGURATION DIFFERENCES\n`;
      content += `-----------------------------------------\n`;
      devices.forEach(d => {
        content += `Device: ${d}\n`;
        const diffStep = Object.values(steps).find(step => step.data && step.data[d]?.diff);
        const diffLines = diffStep ? diffStep.data[d].diff : [];
        if (diffLines && diffLines.length > 0) {
          content += diffLines.join('\n') + '\n';
        } else {
          content += `No difference lines detected.\n`;
        }
        content += `-----------------------------------------\n`;
      });

      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `execution_console_${consoleModalData.task_id}.txt`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    };

    const pipelineLogs = consoleModalData.logs || [];
    
    const deviceConsoleLog = (() => {
      if (!consoleSelectedDevice) return "Select a device to view SSH debug logs.";
      const pushStep = Object.values(steps).find(step => step.data && step.data[consoleSelectedDevice]?.console_log);
      return pushStep ? pushStep.data[consoleSelectedDevice].console_log : "No active CLI logs captured for this device.";
    })();

    const deviceDiffLog = (() => {
      if (!consoleSelectedDevice) return [];
      const diffStep = Object.values(steps).find(step => step.data && step.data[consoleSelectedDevice]?.diff);
      return diffStep ? diffStep.data[consoleSelectedDevice].diff : [];
    })();

    const errorLogs = [];
    if (consoleModalData.logs) {
      consoleModalData.logs.forEach(l => {
        const text = l.message || l.content || '';
        if (text.toLowerCase().includes('fail') || text.toLowerCase().includes('error') || text.toLowerCase().includes('crash')) {
          errorLogs.push(l);
        }
      });
    }
    Object.entries(steps).forEach(([nodeId, res]) => {
      if (res.status === 'failed') {
        errorLogs.push({ timestamp: '', message: `Node [${nodeId}] failed: ${res.error || 'Unknown error'}` });
      }
      if (res.data) {
        Object.entries(res.data).forEach(([dev, devData]) => {
          if (devData.status === 'failed') {
            errorLogs.push({ timestamp: '', message: `Device [${dev}] error in node [${nodeId}]: ${devData.error || 'Execution failed'}` });
          }
        });
      }
    });

    if (isConsoleMinimized) {
      return (
        <div style={{
          position: 'fixed',
          left: 20,
          bottom: 20,
          zIndex: 10000,
          background: colors.dark,
          border: `1px solid ${colors.border}`,
          borderRadius: 12,
          padding: '10px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
          fontFamily: 'Inter, sans-serif'
        }}>
          <span style={{ fontSize: 14 }}>🖥️</span>
          <span style={{ fontSize: 12, fontWeight: 600, color: colors.light }}>
            Console: {flowName}
          </span>
          <span style={getBadgeStyle(status, colors)}>{status}</span>
          <button 
            onClick={() => setIsConsoleMinimized(false)}
            style={{ 
              background: `${colors.primary}20`, 
              border: `1px solid ${colors.primary}40`, 
              color: colors.primary, 
              padding: '4px 10px', 
              borderRadius: 6, 
              fontSize: 11, 
              fontWeight: 700, 
              cursor: 'pointer' 
            }}
          >
            🗖 Restore
          </button>
          <button 
            onClick={() => setConsoleModalOpen(false)}
            style={{ 
              background: 'none', 
              border: 'none', 
              color: colors.gray, 
              fontSize: 16, 
              cursor: 'pointer', 
              padding: '0 4px' 
            }}
          >
            ×
          </button>
        </div>
      );
    }

    return (
      <div style={{
        position: 'fixed',
        left: consolePosition.x,
        top: consolePosition.y,
        zIndex: 9000,
        boxShadow: "0 30px 70px rgba(0,0,0,0.45)",
        background: colors.dark,
        border: `1px solid ${colors.border}`,
        borderRadius: 22,
        width: 850,
        height: 600,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden'
      }}>
        <div 
          className="drag-handle"
          onMouseDown={(e) => {
            if (e.target.tagName !== 'BUTTON' && !e.target.closest('button')) {
              setIsDraggingConsole(true);
              setConsoleDragOffset({
                x: e.clientX - consolePosition.x,
                y: e.clientY - consolePosition.y
              });
            }
          }}
          style={{ 
            ...styles.modalHeader, 
            padding: '16px 24px', 
            cursor: 'move', 
            userSelect: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: colors.darker
          }}
        >
          <div>
            <h4 style={{ ...styles.modalTitle, margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
              <span>🖥️</span> Execution Debug Console
              <span style={getBadgeStyle(status, colors)}>{status}</span>
            </h4>
            <p style={{ margin: '4px 0 0 0', fontSize: 11, color: colors.gray }}>
              Workflow: <strong>{flowName}</strong> &bull; Run ID: <span style={{ fontFamily: 'monospace' }}>{consoleModalData.task_id}</span>
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button 
              onClick={() => setIsConsoleMinimized(true)} 
              style={{ ...styles.closeButton, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12 }}
              title="Minimize to Corner"
            >
              ➖
            </button>
            <button 
              onClick={() => setConsoleModalOpen(false)} 
              style={{ ...styles.closeButton, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              ×
            </button>
          </div>
        </div>

        <div style={{
          display: 'flex',
          alignItems: 'center',
          background: colors.darker,
          borderBottom: `1px solid ${colors.border}`,
          padding: '8px 24px',
          gap: 8
        }}>
          <button 
            onClick={() => setConsoleActiveTab("logs")}
            style={{
              background: consoleActiveTab === 'logs' ? `${colors.primary}20` : 'none',
              border: 'none',
              color: consoleActiveTab === 'logs' ? colors.primary : colors.gray,
              fontSize: 12,
              fontWeight: '700',
              padding: '6px 12px',
              borderRadius: 4,
              cursor: 'pointer',
              transition: 'all 0.15s'
            }}
          >
            Pipeline Steps (Info)
          </button>
          <button 
            onClick={() => setConsoleActiveTab("console")}
            style={{
              background: consoleActiveTab === 'console' ? `${colors.primary}20` : 'none',
              border: 'none',
              color: consoleActiveTab === 'console' ? colors.primary : colors.gray,
              fontSize: 12,
              fontWeight: '700',
              padding: '6px 12px',
              borderRadius: 4,
              cursor: 'pointer',
              transition: 'all 0.15s'
            }}
          >
            Interactive SSH (Deep Debug)
          </button>
          <button 
            onClick={() => setConsoleActiveTab("diff")}
            style={{
              background: consoleActiveTab === 'diff' ? `${colors.primary}20` : 'none',
              border: 'none',
              color: consoleActiveTab === 'diff' ? colors.primary : colors.gray,
              fontSize: 12,
              fontWeight: '700',
              padding: '6px 12px',
              borderRadius: 4,
              cursor: 'pointer',
              transition: 'all 0.15s'
            }}
          >
            Pre/Post-HC Diff
          </button>
          <button 
            onClick={() => setConsoleActiveTab("errors")}
            style={{
              background: consoleActiveTab === 'errors' ? `rgba(239, 68, 68, 0.15)` : 'none',
              border: 'none',
              color: consoleActiveTab === 'errors' ? '#ef4444' : colors.gray,
              fontSize: 12,
              fontWeight: '700',
              padding: '6px 12px',
              borderRadius: 4,
              cursor: 'pointer',
              transition: 'all 0.15s'
            }}
          >
            Errors ({errorLogs.length})
          </button>

          {(consoleActiveTab === 'console' || consoleActiveTab === 'diff') && devices.length > 0 && (
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 11, color: colors.gray }}>Device:</span>
              <select
                value={consoleSelectedDevice}
                onChange={(e) => setConsoleSelectedDevice(e.target.value)}
                style={{ ...styles.input, padding: '4px 8px', fontSize: 11, width: 140, margin: 0 }}
              >
                <option value="" disabled>-- Select Device --</option>
                {devices.map(d => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </div>
          )}

          <button 
            onClick={handleDownloadConsoleLogs}
            style={{
              ...styles.buttonSecondary,
              marginLeft: (consoleActiveTab === 'console' || consoleActiveTab === 'diff') ? 12 : 'auto',
              fontSize: 11,
              padding: '5px 10px',
              display: 'flex',
              alignItems: 'center',
              gap: 4
            }}
          >
            📥 Download Logs
          </button>
        </div>

        <div style={{ flex: 1, padding: '20px 24px', overflowY: 'auto', background: '#030712' }}>
          {consoleActiveTab === 'logs' && (
            <div style={{ ...styles.codeBlock, maxHeight: 'none', background: 'transparent', margin: 0, padding: 0 }}>
              {pipelineLogs.map((log, idx) => (
                <div key={idx} style={{ display: 'flex', gap: 10, fontSize: 12, fontFamily: 'monospace', color: '#e5e7eb', marginBottom: 4 }}>
                  {log.timestamp && <span style={{ color: colors.primary }}>[{log.timestamp}]</span>}
                  <span>{log.message || log.content || log}</span>
                </div>
              ))}
              {pipelineLogs.length === 0 && (
                <div style={{ color: colors.gray, fontSize: 12, textAlign: 'center', padding: 20 }}>No logs captured yet.</div>
              )}
            </div>
          )}

          {consoleActiveTab === 'console' && (
            <div style={{ ...styles.codeBlock, maxHeight: 'none', background: 'transparent', margin: 0, padding: 0, color: '#a5f3fc', fontFamily: 'monospace', fontSize: 12, whiteSpace: 'pre-wrap' }}>
              {deviceConsoleLog}
            </div>
          )}

          {consoleActiveTab === 'diff' && (
            <div style={{ ...styles.diffBlock, maxHeight: 'none', background: 'transparent', margin: 0, padding: 0 }}>
              {deviceDiffLog && deviceDiffLog.length > 0 ? (
                deviceDiffLog.map((line, idx) => {
                  let color = '#e5e7eb';
                  if (line.startsWith("+")) color = colors.success;
                  else if (line.startsWith("-")) color = colors.danger;
                  return (
                    <div key={idx} style={{ color, fontFamily: 'monospace', fontSize: 12, marginBottom: 2 }}>
                      {line}
                    </div>
                  );
                })
              ) : (
                <div style={{ fontSize: 12, color: colors.gray, textAlign: 'center', padding: 20 }}>
                  {consoleSelectedDevice ? "No differences detected for this device." : "Please select a device above."}
                </div>
              )}
            </div>
          )}

          {consoleActiveTab === 'errors' && (
            <div style={{ ...styles.codeBlock, maxHeight: 'none', background: 'transparent', margin: 0, padding: 0 }}>
              {errorLogs.map((log, idx) => (
                <div key={idx} style={{ display: 'flex', gap: 10, fontSize: 12, fontFamily: 'monospace', color: '#f87171', marginBottom: 6 }}>
                  {log.timestamp && <span>[{log.timestamp}]</span>}
                  <span>❌ {log.message || log.content || log}</span>
                </div>
              ))}
              {errorLogs.length === 0 && (
                <div style={{ color: colors.success, fontSize: 12, textAlign: 'center', padding: 20 }}>
                  ✔ No errors detected in this execution.
                </div>
              )}
            </div>
          )}
        </div>
        
        <div style={{ padding: '12px 24px', borderTop: `1px solid ${colors.border}`, display: 'flex', justifyContent: 'flex-end', background: colors.darker }}>
          <button onClick={() => setConsoleModalOpen(false)} style={{ ...styles.buttonPrimary, padding: '6px 20px' }}>
            Close Console
          </button>
        </div>
      </div>
    );
  };

  // Load default layout on init
  useEffect(() => {
    initializeDefaultGraph();
  }, []);

  const activeSelectedNode = selectedNode ? (nodes.find(n => n.id === selectedNode.id) || selectedNode) : null;

  return (
    <div style={{ ...styles.container, maxWidth: "none", position: "relative" }}>
      {/* Visual Header — deliberately overrides styles.container's 1400px
          reading-width cap above. That cap is right for text-heavy pages
          (Dashboard, Settings) but wrong here: the Designer Canvas, Saved
          Workflows, Flow Execution Logs and Ansible Flows tabs are all a
          workspace/tool UI, not prose, and were being squeezed into ~1200px
          with hundreds of pixels of dead space on any wider viewport. */}
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <div style={{ ...styles.logoBox, color: colors.primary }}>
            <Network size={36} />
          </div>
          <div>
            <h2 style={styles.title}>Visual Automation Flow</h2>
            <p style={styles.subtitle}>Topological visual pipeline editor featuring pre/post-healthchecks and Slack/Teams webhooks</p>
          </div>
        </div>
        
        {/* Navigation Tabs */}
        <div style={{ display: "flex", gap: 12 }}>
          <button 
            onClick={() => setActiveTab("designer")} 
            style={{ 
              ...styles.buttonSecondary, 
              borderColor: activeTab === "designer" ? colors.primary : colors.border,
              background: activeTab === "designer" ? `${colors.primary}15` : colors.dark,
              color: activeTab === "designer" ? colors.primary : colors.light
            }}
          >
            ⛓️ Designer Canvas
          </button>
          <button 
            onClick={() => setActiveTab("templates")} 
            style={{ 
              ...styles.buttonSecondary, 
              borderColor: activeTab === "templates" ? colors.primary : colors.border,
              background: activeTab === "templates" ? `${colors.primary}15` : colors.dark,
              color: activeTab === "templates" ? colors.primary : colors.light
            }}
          >
            📋 Saved Workflows
          </button>
          <button 
            onClick={() => setActiveTab("history")} 
            style={{ 
              ...styles.buttonSecondary, 
              borderColor: activeTab === "history" ? colors.primary : colors.border,
              background: activeTab === "history" ? `${colors.primary}15` : colors.dark,
              color: activeTab === "history" ? colors.primary : colors.light
            }}
          >
            📊 Flow Executions Logs
          </button>
          <button
            onClick={() => setActiveTab("ansible")}
            style={{
              ...styles.buttonSecondary,
              borderColor: activeTab === "ansible" ? colors.primary : colors.border,
              background: activeTab === "ansible" ? `${colors.primary}15` : colors.dark,
              color: activeTab === "ansible" ? colors.primary : colors.light
            }}
          >
            🅰️ Ansible Flows
          </button>
        </div>
      </div>

      {activeTab === "designer" && (
        <div style={{
          display: "grid", 
          gridTemplateColumns: `${toolboxExpanded ? "220px" : "50px"} 1fr ${inspectorExpanded ? "350px" : "50px"}`, 
          gap: 16, 
          height: isFullscreen ? "100vh" : "calc(100vh - 240px)",
          position: isFullscreen ? "fixed" : "relative",
          inset: isFullscreen ? 0 : "auto",
          zIndex: isFullscreen ? 9999 : 1,
          background: isFullscreen ? colors.darker : "transparent",
          padding: isFullscreen ? "20px" : "0",
          transition: "all 0.3s ease-in-out"
        }}>
          {/* 1. Left Side Toolbox */}
          <div style={{
            ...styles.panel,
            padding: toolboxExpanded ? "20px" : "12px",
            display: "flex",
            flexDirection: "column",
            gap: 16,
            transition: "all 0.25s",
            overflow: "hidden"
          }}>
            <div style={{ display: "flex", alignItems: "center", justifySpace: "between", gap: 10, borderBottom: `1px solid ${colors.border}`, paddingBottom: 10 }}>
              {toolboxExpanded && <h3 style={{ ...styles.sectionTitle, fontSize: 14, margin: 0 }}>🎨 Visual Toolbox</h3>}
              <button 
                onClick={() => setToolboxExpanded(!toolboxExpanded)}
                style={{ background: "none", border: "none", color: colors.primary, cursor: "pointer", marginLeft: "auto", padding: 2 }}
              >
                {toolboxExpanded ? "◀" : "▶"}
              </button>
            </div>

            {toolboxExpanded ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, overflowY: "auto", maxHeight: "68vh" }}>
                <span style={{ fontSize: 9, fontWeight: 700, color: colors.gray, letterSpacing: 0.5 }}>ADD DESIGNER NODES</span>
                <button onClick={() => handleAddNodeFromToolbox("startNode")} style={{ ...styles.buttonSecondary, fontSize: 11, textAlign: "left", display: "flex", alignItems: "center", gap: 8 }}>
                  <span>🟢</span> Trigger Start
                </button>
                <button onClick={() => handleAddNodeFromToolbox("deviceSelectNode")} style={{ ...styles.buttonSecondary, fontSize: 11, textAlign: "left", display: "flex", alignItems: "center", gap: 8 }}>
                  <span>🎯</span> Target Select
                </button>
                <button onClick={() => handleAddNodeFromToolbox("preCheckNode")} style={{ ...styles.buttonSecondary, fontSize: 11, textAlign: "left", display: "flex", alignItems: "center", gap: 8 }}>
                  <span>🩺</span> Pre-Checks
                </button>
                <button onClick={() => handleAddNodeFromToolbox("configDeployNode")} style={{ ...styles.buttonSecondary, fontSize: 11, textAlign: "left", display: "flex", alignItems: "center", gap: 8 }}>
                  <span>⚡</span> Config Deploy
                </button>
                <button onClick={() => handleAddNodeFromToolbox("postCheckNode")} style={{ ...styles.buttonSecondary, fontSize: 11, textAlign: "left", display: "flex", alignItems: "center", gap: 8 }}>
                  <span>🧪</span> Post-Checks
                </button>
                <button onClick={() => handleAddNodeFromToolbox("gitCommitNode")} style={{ ...styles.buttonSecondary, fontSize: 11, textAlign: "left", display: "flex", alignItems: "center", gap: 8 }}>
                  <span>📦</span> Git Commit
                </button>
                <button onClick={() => handleAddNodeFromToolbox("notificationNode")} style={{ ...styles.buttonSecondary, fontSize: 11, textAlign: "left", display: "flex", alignItems: "center", gap: 8 }}>
                  <span>🔔</span> Alert Notify
                </button>
                
                {/* Visual Toolbox additions: Time Delay, Logic branch, AI Agent */}
                <button onClick={() => handleAddNodeFromToolbox("delayNode")} style={{ ...styles.buttonSecondary, fontSize: 11, textAlign: "left", display: "flex", alignItems: "center", gap: 8 }}>
                  <span>⏱️</span> Time Delay
                </button>
                <button onClick={() => handleAddNodeFromToolbox("logicNode")} style={{ ...styles.buttonSecondary, fontSize: 11, textAlign: "left", display: "flex", alignItems: "center", gap: 8 }}>
                  <span>🔀</span> Logic Gate
                </button>
                <button onClick={() => handleAddNodeFromToolbox("aiAgentNode")} style={{ ...styles.buttonSecondary, fontSize: 11, textAlign: "left", display: "flex", alignItems: "center", gap: 8 }}>
                  <span>🤖</span> AI Agent
                </button>

                {/* Custom node creation section */}
                <div style={{ borderTop: "1px solid var(--border-whisper)", marginTop: 8, paddingTop: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <span style={{ fontSize: 9, fontWeight: 700, color: colors.gray, letterSpacing: 0.5 }}>CUSTOM ELEMENTS</span>
                    <button 
                      onClick={() => setIsCustomNodeModalOpen(true)}
                      style={{ 
                        background: `${colors.primary}20`, 
                        border: `1px solid ${colors.primary}40`, 
                        color: colors.primary, 
                        fontSize: 9, 
                        fontWeight: 700, 
                        padding: '2px 6px', 
                        borderRadius: 4, 
                        cursor: 'pointer',
                        marginLeft: 'auto'
                      }}
                    >
                      ➕ Create
                    </button>
                  </div>
                  {customNodeTemplates.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {customNodeTemplates.map((tpl, idx) => (
                        <div key={idx} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                          <button 
                            onClick={() => handleAddNodeFromToolbox("customNode", tpl)} 
                            style={{ 
                              ...styles.buttonSecondary, 
                              flex: 1,
                              fontSize: 11, 
                              textAlign: "left", 
                              display: "flex", 
                              alignItems: "center", 
                              gap: 8,
                              borderLeft: `3px solid ${tpl.color || colors.primary}`
                            }}
                          >
                            <span>{tpl.icon || '🛠️'}</span> {tpl.title}
                          </button>
                          <button
                            onClick={() => {
                              if (window.confirm("Remove this custom element template?")) {
                                const updated = customNodeTemplates.filter((_, i) => i !== idx);
                                setCustomNodeTemplates(updated);
                                localStorage.setItem("custom_node_templates", JSON.stringify(updated));
                              }
                            }}
                            style={{ background: 'none', border: 'none', color: colors.danger, cursor: 'pointer', padding: 4, fontSize: 12 }}
                            title="Delete template"
                          >
                            🗑️
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ fontSize: 9, color: colors.gray, textAlign: 'center', padding: '6px 0' }}>
                      No custom node elements created yet.
                    </div>
                  )}
                </div>
                
                <div style={{ borderTop: "1px solid var(--border-whisper)", marginTop: 14, paddingTop: 14 }}>
                  <span style={{ fontSize: 9, fontWeight: 700, color: colors.gray, letterSpacing: 0.5, display: "block", marginBottom: 6 }}>CANVAS CONTROLS</span>
                  <div style={styles.fieldWrap}>
                    <label style={{ fontSize: 10, color: colors.gray }}>Card Width</label>
                    <input 
                      type="range" 
                      min="180" 
                      max="300" 
                      value={nodeWidth} 
                      onChange={(e) => setNodeWidth(parseInt(e.target.value))}
                      style={{ width: "100%", accentColor: colors.primary }}
                    />
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 12, overflowY: "auto", maxHeight: "68vh", alignItems: "center", width: "100%" }}>
                <button onClick={() => handleAddNodeFromToolbox("startNode")} title="Trigger Start" style={{ ...styles.buttonSecondary, padding: 0, display: "flex", justifyContent: "center", alignItems: "center", width: "26px", height: "26px", borderRadius: "6px", border: "1px solid var(--border-whisper)" }}>
                  <span>🟢</span>
                </button>
                <button onClick={() => handleAddNodeFromToolbox("deviceSelectNode")} title="Target Select" style={{ ...styles.buttonSecondary, padding: 0, display: "flex", justifyContent: "center", alignItems: "center", width: "26px", height: "26px", borderRadius: "6px", border: "1px solid var(--border-whisper)" }}>
                  <span>🎯</span>
                </button>
                <button onClick={() => handleAddNodeFromToolbox("preCheckNode")} title="Pre-Checks" style={{ ...styles.buttonSecondary, padding: 0, display: "flex", justifyContent: "center", alignItems: "center", width: "26px", height: "26px", borderRadius: "6px", border: "1px solid var(--border-whisper)" }}>
                  <span>🩺</span>
                </button>
                <button onClick={() => handleAddNodeFromToolbox("configDeployNode")} title="Config Deploy" style={{ ...styles.buttonSecondary, padding: 0, display: "flex", justifyContent: "center", alignItems: "center", width: "26px", height: "26px", borderRadius: "6px", border: "1px solid var(--border-whisper)" }}>
                  <span>⚡</span>
                </button>
                <button onClick={() => handleAddNodeFromToolbox("postCheckNode")} title="Post-Checks" style={{ ...styles.buttonSecondary, padding: 0, display: "flex", justifyContent: "center", alignItems: "center", width: "26px", height: "26px", borderRadius: "6px", border: "1px solid var(--border-whisper)" }}>
                  <span>🧪</span>
                </button>
                <button onClick={() => handleAddNodeFromToolbox("gitCommitNode")} title="Git Commit" style={{ ...styles.buttonSecondary, padding: 0, display: "flex", justifyContent: "center", alignItems: "center", width: "26px", height: "26px", borderRadius: "6px", border: "1px solid var(--border-whisper)" }}>
                  <span>📦</span>
                </button>
                <button onClick={() => handleAddNodeFromToolbox("notificationNode")} title="Alert Notify" style={{ ...styles.buttonSecondary, padding: 0, display: "flex", justifyContent: "center", alignItems: "center", width: "26px", height: "26px", borderRadius: "6px", border: "1px solid var(--border-whisper)" }}>
                  <span>🔔</span>
                </button>
                <button onClick={() => handleAddNodeFromToolbox("delayNode")} title="Time Delay" style={{ ...styles.buttonSecondary, padding: 0, display: "flex", justifyContent: "center", alignItems: "center", width: "26px", height: "26px", borderRadius: "6px", border: "1px solid var(--border-whisper)" }}>
                  <span>⏱️</span>
                </button>
                <button onClick={() => handleAddNodeFromToolbox("logicNode")} title="Logic Gate" style={{ ...styles.buttonSecondary, padding: 0, display: "flex", justifyContent: "center", alignItems: "center", width: "26px", height: "26px", borderRadius: "6px", border: "1px solid var(--border-whisper)" }}>
                  <span>🔀</span>
                </button>
                <button onClick={() => handleAddNodeFromToolbox("aiAgentNode")} title="AI Agent" style={{ ...styles.buttonSecondary, padding: 0, display: "flex", justifyContent: "center", alignItems: "center", width: "26px", height: "26px", borderRadius: "6px", border: "1px solid var(--border-whisper)" }}>
                  <span>🤖</span>
                </button>
                
                {customNodeTemplates.length > 0 && (
                  <div style={{ borderTop: "1px solid var(--border-whisper)", marginTop: 6, paddingTop: 10, display: "flex", flexDirection: "column", gap: 12, width: "100%", alignItems: "center" }}>
                    {customNodeTemplates.map((tpl, idx) => (
                      <button 
                        key={idx}
                        onClick={() => handleAddNodeFromToolbox("customNode", tpl)} 
                        title={tpl.title}
                        style={{ 
                          ...styles.buttonSecondary, 
                          padding: 0, 
                          display: "flex", 
                          justifyContent: "center", 
                          alignItems: "center", 
                          width: "26px", 
                          height: "26px", 
                          borderRadius: "6px",
                          border: "1px solid var(--border-whisper)",
                          borderLeft: `3px solid ${tpl.color || colors.primary}`
                        }}
                      >
                        <span>{tpl.icon || '🛠️'}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 2. ReactFlow Visual Editor Workspace Canvas */}
          <div style={{
            position: "relative",
            border: `1.5px solid ${colors.border}`,
            borderRadius: 22,
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            boxShadow: isDark ? "inset 0 10px 30px rgba(0,0,0,0.5)" : "none",
            background: isDark ? "#060b13" : "#fafafa"
          }}>
            {/* Top Toolbar */}
            <div style={{
              display: "flex", alignItems: "center", justifySpace: "between", gap: 16, padding: "12px 20px",
              background: isDark ? "rgba(10, 16, 26, 0.9)" : "rgba(240, 244, 248, 0.9)",
              borderBottom: `1px solid ${colors.border}`, zIndex: 10
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1 }}>
                <select
                  value={activeWorkflowId || ""}
                  onChange={(e) => {
                    const selectedId = e.target.value;
                    if (selectedId) {
                      handleLoadWorkflow(selectedId);
                    }
                  }}
                  style={{
                    background: colors.dark,
                    border: `1px solid ${colors.border}`,
                    borderRadius: '6px',
                    color: colors.light,
                    fontSize: '13px',
                    padding: '6px 12px',
                    outline: 'none',
                    minWidth: '180px'
                  }}
                >
                  <option value="" disabled>-- Select Workflow --</option>
                  {workflows.map(w => (
                    <option key={w.id} value={w.id}>{w.name}</option>
                  ))}
                </select>
                {activeWorkflowId && (
                  <span style={getBadgeStyle("info", colors)}>Template Active</span>
                )}
                <button 
                  onClick={handleCreateNewWorkflow}
                  style={{ ...styles.buttonSecondary, display: "flex", alignItems: "center", gap: 6, padding: "6px 12px" }}
                  title="Create a new workflow template from scratch"
                >
                  <Plus size={14} /> New Flow
                </button>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {/* File upload hidden field */}
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  onChange={handleImportWorkflow} 
                  style={{ display: 'none' }} 
                  accept=".json"
                />
                <button onClick={triggerImport} style={{ ...styles.buttonSecondary, display: "flex", alignItems: "center", gap: 6, padding: "6px 12px" }} title="Import pipeline JSON">
                  <Upload size={14} /> Import
                </button>
                <button onClick={handleExport} style={{ ...styles.buttonSecondary, display: "flex", alignItems: "center", gap: 6, padding: "6px 12px" }} title="Export pipeline JSON">
                  <Download size={14} /> Export
                </button>
                <button onClick={() => setIsFullscreen(!isFullscreen)} style={{ ...styles.buttonSecondary, padding: "6px 10px" }}>
                  {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                </button>
                <div style={{ width: 1, height: 20, background: colors.border }} />
                <button 
                  onClick={handleSaveWorkflow} 
                  disabled={isViewer}
                  style={styles.buttonSecondary}
                >
                  <Save size={14} style={{ marginRight: 6 }} /> Save template
                </button>
                <button 
                  onClick={handleRunWorkflow} 
                  disabled={isRunning || isViewer} 
                  style={styles.buttonPrimary}
                >
                  {isRunning ? (
                    <>
                      <RefreshCw size={14} className="spin" style={{ marginRight: 6 }} /> Deploying...
                    </>
                  ) : (
                    <>
                      <Play size={14} style={{ marginRight: 6 }} /> Deploy Pipeline
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* React Flow Core Engine Canvas */}
            <div style={{ flex: 1, position: "relative" }}>
              <ReactFlowProvider>
                <ReactFlow
                  nodes={nodes}
                  edges={edges}
                  onNodesChange={onNodesChange}
                  onEdgesChange={onEdgesChange}
                  onConnect={onConnect}
                  nodeTypes={nodeTypes}
                  edgeTypes={edgeTypes}
                  fitView
                  minZoom={0.2}
                  maxZoom={1.5}
                >
                  <Controls style={{ background: colors.dark, border: `1px solid ${colors.border}`, fill: colors.light, color: colors.light }} />
                  <MiniMap nodeStrokeColor={(n) => getNodeColor(n.type)} nodeColor={(n) => getNodeColor(n.type)} maskColor="rgba(99, 102, 241, 0.15)" style={{ background: 'rgba(3, 7, 18, 0.9)', border: `1px solid ${colors.border}`, borderRadius: '12px', boxShadow: '0 8px 32px rgba(0,0,0,0.5)', overflow: 'hidden' }} />
                  <Background color={isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)"} gap={16} size={1} />
                </ReactFlow>
              </ReactFlowProvider>
            </div>
            
            {/* Real-time running status logs drawer popup */}
            {(isRunning || executionDetail) && (
              <div style={{
                position: "absolute", bottom: 0, left: 0, right: 0, height: 260,
                background: isDark ? "rgba(10, 16, 26, 0.95)" : "rgba(255, 255, 255, 0.95)",
                borderTop: `1.5px solid ${colors.border}`, zIndex: 100, display: "flex", flexDirection: "column",
                boxShadow: "0 -10px 30px rgba(0,0,0,0.5)", backdropFilter: "blur(12px)"
              }}>
                {/* Header */}
                <div style={{
                  display: "flex", alignItems: "center", justifySpace: "between", padding: "10px 16px",
                  background: isDark ? "rgba(15, 23, 42, 0.6)" : "rgba(230, 235, 245, 0.6)",
                  borderBottom: `1px solid ${colors.border}`
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={getBadgeStyle(executionDetail?.status || 'pending', colors)}>{executionDetail?.status || 'pending'}</span>
                    <strong style={{ fontSize: 13, color: colors.light }}>Real-time execution dashboard: {currentWorkflowName}</strong>
                  </div>
                  
                  {/* Tabs Detail Navigation */}
                  <div style={{ display: "flex", gap: 10, marginLeft: 20, alignItems: "center" }}>
                    <button onClick={() => setActiveTabDetail("logs")} style={{
                      background: activeTabDetail === 'logs' ? `${colors.primary}20` : 'none',
                      border: 'none', color: activeTabDetail === 'logs' ? colors.primary : colors.gray,
                      fontSize: 11, fontWeight: 700, padding: "4px 8px", borderRadius: 4, cursor: "pointer"
                    }}>Pipeline execution logs</button>
                    <button onClick={() => setActiveTabDetail("console")} style={{
                      background: activeTabDetail === 'console' ? `${colors.primary}20` : 'none',
                      border: 'none', color: activeTabDetail === 'console' ? colors.primary : colors.gray,
                      fontSize: 11, fontWeight: 700, padding: "4px 8px", borderRadius: 4, cursor: "pointer"
                    }}>Console debug logs</button>
                    <button onClick={() => setActiveTabDetail("diff")} style={{
                      background: activeTabDetail === 'diff' ? `${colors.primary}20` : 'none',
                      border: 'none', color: activeTabDetail === 'diff' ? colors.primary : colors.gray,
                      fontSize: 11, fontWeight: 700, padding: "4px 8px", borderRadius: 4, cursor: "pointer"
                    }}>Pre/Post-HC diff check</button>
                    <button 
                      onClick={() => {
                        setConsoleModalData(executionDetail || {
                          task_id: activeTaskId,
                          flow_name: currentWorkflowName,
                          status: isRunning ? 'running' : 'idle',
                          logs: logs,
                          devices: executionDetail?.devices || [],
                          steps: executionDetail?.steps || {}
                        });
                        if (executionDetail?.devices && executionDetail.devices.length > 0) {
                          setConsoleSelectedDevice(executionDetail.devices[0]);
                        }
                        setConsoleActiveTab(activeTabDetail);
                        setConsoleModalOpen(true);
                      }}
                      style={{
                        background: 'none',
                        border: `1px solid ${colors.border}`,
                        color: colors.primary,
                        fontSize: 11,
                        fontWeight: '700',
                        padding: "4px 10px",
                        borderRadius: 4,
                        cursor: "pointer",
                        marginLeft: 16,
                        display: "flex",
                        alignItems: "center",
                        gap: 4
                      }}
                    >
                      🖥️ Expand Pop-up
                    </button>
                  </div>

                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginLeft: "auto" }}>
                    {executionDetail?.devices?.length > 0 && (
                      <select 
                        value={selectedDetailDevice}
                        onChange={(e) => setSelectedDetailDevice(e.target.value)}
                        style={{ ...styles.input, padding: "4px 8px", fontSize: 11, width: 140 }}
                      >
                        {executionDetail.devices.map(d => (
                          <option key={d} value={d}>{d}</option>
                        ))}
                      </select>
                    )}
                    <button 
                      onClick={() => { setExecutionDetail(null); setIsRunning(false); setActiveTaskId(null); }}
                      style={{ background: "none", border: "none", color: colors.gray, cursor: "pointer", display: "flex", alignItems: "center" }}
                    >
                      <X size={16} />
                    </button>
                  </div>
                </div>
                
                {/* Console contents */}
                <div style={{ flex: 1, padding: 16, overflowY: "auto" }}>
                  {activeTabDetail === "logs" && (
                    <div style={{ ...styles.codeBlock, maxHeight: 180, background: "rgba(0,0,0,0.3)" }}>
                      {logs.map((log, idx) => (
                        <div key={idx} style={{ display: "flex", gap: 10, fontSize: 11, fontFamily: "monospace", color: colors.light, marginBottom: 2 }}>
                          {log.timestamp && <span style={{ color: colors.primary }}>[{log.timestamp}]</span>}
                          <span style={{ color: colors.light }}>{log.content}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {activeTabDetail === "console" && (
                    <div style={{ ...styles.codeBlock, maxHeight: 180, background: "rgba(0,0,0,0.3)", color: "#a5f3fc", fontFamily: "monospace" }}>
                      {selectedDeviceConsoleLog}
                    </div>
                  )}

                  {activeTabDetail === "diff" && (
                    <div style={{ ...styles.diffBlock, maxHeight: 180, background: "rgba(0,0,0,0.3)" }}>
                      {selectedDeviceDiff.length > 0 ? (
                        selectedDeviceDiff.map((line, idx) => {
                          let color = colors.light;
                          if (line.startsWith("+")) color = colors.success;
                          else if (line.startsWith("-")) color = colors.danger;
                          return (
                            <div key={idx} style={{ color, fontFamily: "monospace", fontSize: 11 }}>
                              {line}
                            </div>
                          );
                        })
                      ) : (
                        <div style={{ fontSize: 11, color: colors.gray, textAlign: "center", padding: 20 }}>
                          No active difference lines detected. Pre-HC and Post-HC configurations are identical.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* 3. Right Side Inspector Panel */}
          {inspectorMaximized && (
            <div
              onClick={() => setInspectorMaximized(false)}
              style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 10000 }}
            />
          )}
          <div style={{
            ...styles.panel,
            padding: inspectorExpanded ? "20px" : "12px",
            display: "flex",
            flexDirection: "column",
            gap: 16,
            transition: "all 0.25s",
            overflow: "hidden",
            ...(inspectorMaximized ? {
              position: "fixed",
              top: 40,
              bottom: 40,
              left: "50%",
              transform: "translateX(-50%)",
              width: "min(760px, 92vw)",
              zIndex: 10001,
              boxShadow: "0 20px 60px rgba(0,0,0,0.6)"
            } : {})
          }}>
            <div style={{ display: "flex", alignItems: "center", justifySpace: "between", gap: 10, borderBottom: `1px solid ${colors.border}`, paddingBottom: 10 }}>
              <button
                onClick={() => setInspectorExpanded(!inspectorExpanded)}
                style={{ background: "none", border: "none", color: colors.primary, cursor: "pointer", marginRight: "auto", padding: 2 }}
              >
                {inspectorExpanded ? "▶" : "◀"}
              </button>
              {inspectorExpanded && <h3 style={{ ...styles.sectionTitle, fontSize: 14, margin: 0 }}>⚙️ Inspector Node</h3>}
              {inspectorExpanded && (
                <button
                  onClick={() => setInspectorMaximized(!inspectorMaximized)}
                  title={inspectorMaximized ? "Restore" : "Maximize inspector"}
                  style={{ background: "none", border: "none", color: colors.gray, cursor: "pointer", padding: 2, display: "flex", alignItems: "center" }}
                >
                  {inspectorMaximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                </button>
              )}
            </div>

            {inspectorExpanded && (() => {
              const activeNode = activeSelectedNode;
              return (
                <div style={{ display: "flex", flexDirection: "column", gap: 16, overflowY: "auto", flex: 1 }}>
                  {activeNode ? (
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 12 }}>
                        <span style={{ color: getNodeColor(activeNode.type) }}>{getNodeIcon(activeNode.type)}</span>
                        <strong style={{ fontSize: 13, color: colors.light }}>{getFriendlyTypeName(activeNode.type)}</strong>
                      </div>

                      {activeNode.type === 'deviceSelectNode' && (
                        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                          <div>
                            <div style={{ fontSize: 12, fontWeight: 700, color: colors.primary, display: "flex", alignItems: "center", gap: 6 }}>
                              <span>🎯</span> {activeNode.data.tickedDevices?.length || 0} Router Node(s) Selected
                            </div>
                            <button 
                              onClick={() => setIsGridModalOpen(true)}
                              style={{ ...styles.buttonSecondary, width: "100%", fontSize: 11, marginTop: 8 }}
                            >
                              🔎 Edit selection grid
                            </button>
                          </div>

                          {/* Visual listing of selected devices (Requirement 3) */}
                          <div style={{ marginTop: 12 }}>
                            <label style={styles.label}>Selected Routers</label>
                            <div style={{ 
                              maxHeight: 250, 
                              overflowY: 'auto', 
                              border: `1px solid ${colors.border}`, 
                              borderRadius: 8, 
                              background: colors.darker, 
                              padding: '8px 12px' 
                            }}>
                              {activeNode.data.tickedDevices && activeNode.data.tickedDevices.length > 0 ? (
                                activeNode.data.tickedDevices.map(devId => {
                                  const dev = devicesList.find(d => String(d.id) === String(devId) || d.hostname === devId);
                                  return (
                                    <div key={devId} style={{ display: 'flex', alignItems: 'center', justifySpace: 'between', padding: '4px 0', fontSize: 12, borderBottom: `1px solid ${colors.border}50` }}>
                                      <span style={{ color: colors.light, fontWeight: 'bold' }}>{dev ? dev.hostname : devId}</span>
                                      <span style={{ color: colors.gray, fontSize: 10 }}>{dev ? dev.ip_address : ''}</span>
                                    </div>
                                  );
                                })
                              ) : (
                                <div style={{ fontSize: 11, color: colors.gray, textAlign: 'center', padding: '10px 0' }}>
                                  No routers selected. Click the button above to configure selection.
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      )}

                      {activeNode.type === 'preCheckNode' && (
                        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                          <div style={styles.fieldWrap}>
                            <label style={styles.label}>Max CPU Threshold (%)</label>
                            <input 
                              type="number"
                              value={activeNode.data.cpuThreshold || 90}
                              onChange={(e) => activeNode.data.updateNodeData({ cpuThreshold: parseInt(e.target.value) || 0 })}
                              style={styles.input}
                            />
                          </div>
                          <div style={styles.fieldWrap}>
                            <label style={styles.label}>Command Mode</label>
                            <select
                              value={activeNode.data.checkMode || (activeNode.data.useYamlCommands ? "yaml" : "custom")}
                              onChange={(e) => {
                                const mode = e.target.value;
                                if (mode === 'yaml') {
                                  activeNode.data.updateNodeData({ checkMode: 'yaml', useYamlCommands: true });
                                } else if (mode === 'ansible') {
                                  activeNode.data.updateNodeData({ checkMode: 'ansible', useYamlCommands: false });
                                } else {
                                  activeNode.data.updateNodeData({ checkMode: 'custom', useYamlCommands: false });
                                }
                              }}
                              style={styles.input}
                            >
                              <option value="custom">Custom text CLI overrides</option>
                              <option value="yaml">Healthcheck script profiles</option>
                              <option value="ansible">Ansible script</option>
                            </select>
                          </div>
                          {(activeNode.data.checkMode || (activeNode.data.useYamlCommands ? "yaml" : "custom")) === 'yaml' ? (
                            <>
                              <div style={styles.fieldWrap}>
                                <label style={styles.label}>Script Profile</label>
                                <select
                                  value={activeNode.data.yamlScriptPath || ""}
                                  onChange={(e) => activeNode.data.updateNodeData({ yamlScriptPath: e.target.value })}
                                  style={styles.input}
                                >
                                  {getScriptProfilesForNode(activeNode.id, nodes, edges, deviceGroups, devicesList, availableCommandsList).map(p => (
                                    <option key={p.path} value={p.path}>{p.name}</option>
                                  ))}
                                </select>
                              </div>
                              <div style={styles.fieldWrap}>
                                <label style={styles.label}>Script Preview</label>
                                <textarea
                                  rows={8}
                                  readOnly
                                  value={activeNode.data.commandsText || ""}
                                  style={{ ...styles.input, fontFamily: "monospace", fontSize: 11, opacity: 0.7 }}
                                />
                              </div>
                            </>
                          ) : (activeNode.data.checkMode === 'ansible') ? (
                            <AnsibleFlowInspector data={activeNode.data} flows={designerAnsibleFlows} filterMode="read_only" />
                          ) : (
                            <div style={styles.fieldWrap}>
                              <label style={styles.label}>Commands</label>
                              <textarea
                                rows={8}
                                value={activeNode.data.commandsText || ""}
                                onChange={(e) => activeNode.data.updateNodeData({ commandsText: e.target.value })}
                                style={{ ...styles.input, fontFamily: "monospace", fontSize: 11 }}
                              />
                            </div>
                          )}
                        </div>
                      )}

                      {activeNode.type === 'configDeployNode' && (
                        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                          <div style={styles.fieldWrap}>
                            <label style={styles.label}>Deployment Mode</label>
                            <select
                              value={activeNode.data.deployMode || "cli"}
                              onChange={(e) => activeNode.data.updateNodeData({ deployMode: e.target.value })}
                              style={styles.input}
                            >
                              <option value="cli">Deployment Script</option>
                              <option value="ansible">Ansible Playbook</option>
                            </select>
                          </div>
                          {(activeNode.data.deployMode || "cli") === 'ansible' ? (
                            <AnsibleFlowInspector data={activeNode.data} flows={designerAnsibleFlows} filterMode={null} />
                          ) : (
                            <div style={styles.fieldWrap}>
                              <label style={styles.label}>CLI commands to push</label>
                              <textarea
                                rows={12}
                                value={activeNode.data.commandsText || ""}
                                onChange={(e) => activeNode.data.updateNodeData({ commandsText: e.target.value })}
                                placeholder="interface Loopback0&#10; description Loopback for IPTV&#10; ip address {{ loopback_ip }} 255.255.255.255"
                                style={{ ...styles.input, fontFamily: "monospace", fontSize: 11 }}
                              />
                            </div>
                          )}
                        </div>
                      )}

                      {activeNode.type === 'postCheckNode' && (
                        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                          <div style={styles.fieldWrap}>
                            <label style={styles.label}>Auto Rollback on fail</label>
                            <select
                              value={activeNode.data.autoRollback !== false ? "yes" : "no"}
                              onChange={(e) => activeNode.data.updateNodeData({ autoRollback: e.target.value === 'yes' })}
                              style={styles.input}
                            >
                              <option value="yes">Yes, rollback to baseline</option>
                              <option value="no">No, ignore error flags</option>
                            </select>
                          </div>
                          <div style={styles.fieldWrap}>
                            <label style={styles.label}>Command Mode</label>
                            <select
                              value={activeNode.data.checkMode || (activeNode.data.useYamlCommands ? "yaml" : "custom")}
                              onChange={(e) => {
                                const mode = e.target.value;
                                if (mode === 'yaml') {
                                  activeNode.data.updateNodeData({ checkMode: 'yaml', useYamlCommands: true });
                                } else if (mode === 'ansible') {
                                  activeNode.data.updateNodeData({ checkMode: 'ansible', useYamlCommands: false });
                                } else {
                                  activeNode.data.updateNodeData({ checkMode: 'custom', useYamlCommands: false });
                                }
                              }}
                              style={styles.input}
                            >
                              <option value="custom">Custom text CLI overrides</option>
                              <option value="yaml">Healthcheck script profiles</option>
                              <option value="ansible">Ansible script</option>
                            </select>
                          </div>
                          {(activeNode.data.checkMode || (activeNode.data.useYamlCommands ? "yaml" : "custom")) === 'yaml' ? (
                            <>
                              <div style={styles.fieldWrap}>
                                <label style={styles.label}>Script Profile</label>
                                <select
                                  value={activeNode.data.yamlScriptPath || ""}
                                  onChange={(e) => activeNode.data.updateNodeData({ yamlScriptPath: e.target.value })}
                                  style={styles.input}
                                >
                                  {getScriptProfilesForNode(activeNode.id, nodes, edges, deviceGroups, devicesList, availableCommandsList).map(p => (
                                    <option key={p.path} value={p.path}>{p.name}</option>
                                  ))}
                                </select>
                              </div>
                              <div style={styles.fieldWrap}>
                                <label style={styles.label}>Script Preview</label>
                                <textarea
                                  rows={8}
                                  readOnly
                                  value={activeNode.data.commandsText || ""}
                                  style={{ ...styles.input, fontFamily: "monospace", fontSize: 11, opacity: 0.7 }}
                                />
                              </div>
                            </>
                          ) : (activeNode.data.checkMode === 'ansible') ? (
                            <AnsibleFlowInspector data={activeNode.data} flows={designerAnsibleFlows} filterMode="read_only" />
                          ) : (
                            <div style={styles.fieldWrap}>
                              <label style={styles.label}>Commands</label>
                              <textarea
                                rows={8}
                                value={activeNode.data.commandsText || ""}
                                onChange={(e) => activeNode.data.updateNodeData({ commandsText: e.target.value })}
                                style={{ ...styles.input, fontFamily: "monospace", fontSize: 11 }}
                              />
                            </div>
                          )}
                        </div>
                      )}

                      {activeNode.type === 'notificationNode' && (
                        <div style={styles.fieldWrap}>
                          <label style={styles.label}>Webhook integration URL</label>
                          <input 
                            type="text"
                            value={activeNode.data.webhook || ""}
                            onChange={(e) => activeNode.data.updateNodeData({ webhook: e.target.value })}
                            placeholder="https://m365.webhook.office.com/..."
                            style={styles.input}
                          />
                        </div>
                      )}

                      {activeNode.type === 'delayNode' && (
                        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                          <div style={styles.fieldWrap}>
                            <label style={styles.label}>Wait Duration</label>
                            <input 
                              type="number"
                              min="1"
                              value={activeNode.data.delayTime || 10}
                              onChange={(e) => activeNode.data.updateNodeData({ delayTime: parseInt(e.target.value) || 1 })}
                              style={styles.input}
                            />
                          </div>
                          <div style={styles.fieldWrap}>
                            <label style={styles.label}>Time Unit</label>
                            <select 
                              value={activeNode.data.delayUnit || "minutes"}
                              onChange={(e) => activeNode.data.updateNodeData({ delayUnit: e.target.value })}
                              style={styles.input}
                            >
                              <option value="seconds">Seconds</option>
                              <option value="minutes">Minutes</option>
                              <option value="hours">Hours</option>
                            </select>
                          </div>
                        </div>
                      )}

                      {activeNode.type === 'logicNode' && (
                        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                          <div style={styles.fieldWrap}>
                            <label style={styles.label}>Logical Operator</label>
                            <select 
                              value={activeNode.data.operator || "IF"}
                              onChange={(e) => activeNode.data.updateNodeData({ operator: e.target.value })}
                              style={styles.input}
                            >
                              <option value="IF">IF Condition</option>
                              <option value="AND">AND (All Upstream True)</option>
                              <option value="OR">OR (Any Upstream True)</option>
                            </select>
                          </div>
                        </div>
                      )}

                      {activeNode.type === 'customNode' && (
                        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                          <div style={styles.fieldWrap}>
                            <label style={styles.label}>Node Title</label>
                            <input 
                              type="text"
                              value={activeNode.data.title || ""}
                              onChange={(e) => activeNode.data.updateNodeData({ title: e.target.value })}
                              style={styles.input}
                            />
                          </div>
                          <div style={styles.fieldWrap}>
                            <label style={styles.label}>Node Description</label>
                            <textarea 
                              rows={4}
                              value={activeNode.data.description || ""}
                              onChange={(e) => activeNode.data.updateNodeData({ description: e.target.value })}
                              style={styles.input}
                            />
                          </div>
                          <div style={styles.fieldWrap}>
                            <label style={styles.label}>Emoji Icon</label>
                            <input 
                              type="text"
                              value={activeNode.data.icon || ""}
                              onChange={(e) => activeNode.data.updateNodeData({ icon: e.target.value })}
                              style={styles.input}
                            />
                          </div>
                          <div style={styles.fieldWrap}>
                            <label style={styles.label}>Card Color Hex</label>
                            <input 
                              type="color"
                              value={activeNode.data.color || "#6366f1"}
                              onChange={(e) => activeNode.data.updateNodeData({ color: e.target.value })}
                              style={{ ...styles.input, height: 40, padding: 2 }}
                            />
                          </div>
                          
                          {activeNode.data.parameters && Object.keys(activeNode.data.parameters).length > 0 && (
                            <div style={{ marginTop: 8, borderTop: `1px solid ${colors.border}`, paddingTop: 8 }}>
                              <label style={{ ...styles.label, fontSize: 10, fontWeight: 700, color: colors.gray, letterSpacing: 0.5 }}>PARAMETERS</label>
                              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 6 }}>
                                {Object.entries(activeNode.data.parameters).map(([key, val]) => (
                                  <div key={key} style={styles.fieldWrap}>
                                    <label style={{ ...styles.label, textTransform: 'none', fontSize: 10 }}>{key}</label>
                                    <input 
                                      type="text"
                                      value={val}
                                      onChange={(e) => {
                                        const updatedParams = {
                                          ...(activeNode.data.parameters || {}),
                                          [key]: e.target.value
                                        };
                                        activeNode.data.updateNodeData({ parameters: updatedParams });
                                      }}
                                      style={styles.input}
                                    />
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {activeNode.type === 'aiAgentNode' && (
                        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                          <div style={styles.fieldWrap}>
                            <label style={styles.label}>System Task / Goal Prompt</label>
                            <textarea 
                              rows={6}
                              value={activeNode.data.promptGoal || ""}
                              onChange={(e) => activeNode.data.updateNodeData({ promptGoal: e.target.value })}
                              placeholder="e.g. Audit the configuration diffs and generate a safety score."
                              style={{ ...styles.input, fontFamily: "monospace", fontSize: 11 }}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div style={styles.emptyState}>
                      Select a node card on the visual grid to configure its parameters
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* 4. Saved Workflows templates list tab view */}
      {activeTab === "templates" && (() => {
        const getTemplateCategory = (flow) => {
          const id = (flow.id || '').toLowerCase();
          if (id.includes('solidserver_ipam')) return 'SolidServer IPAM';
          if (id.includes('solidserver_dns')) return 'SolidServer DNS';
          return 'Other';
        };
        const templateCategories = ['All', ...Array.from(new Set(workflows.map(getTemplateCategory))).sort()];
        const searchLower = templateSearch.trim().toLowerCase();
        const filteredWorkflows = workflows.filter(flow => {
          const matchesCategory = templateCategory === 'All' || getTemplateCategory(flow) === templateCategory;
          const matchesSearch = !searchLower
            || (flow.id || '').toLowerCase().includes(searchLower)
            || (flow.name || '').toLowerCase().includes(searchLower);
          return matchesCategory && matchesSearch;
        });

        return (
        <div style={styles.panel}>
          <h3 style={styles.sectionTitle}>Saved Workflows Templates</h3>
          <p style={styles.subtitle}>List of all available workflow templates saved. Load any template to the designer canvas.</p>

          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginTop: 16 }}>
            <input
              type="text"
              placeholder="🔎 Filter by Template ID or name…"
              value={templateSearch}
              onChange={e => setTemplateSearch(e.target.value)}
              style={{
                flex: "1 1 280px", padding: "8px 12px", fontSize: 13,
                borderRadius: 6, border: `1px solid ${colors.border}`,
                background: colors.dark, color: colors.light, outline: "none"
              }}
            />
            <select
              value={templateCategory}
              onChange={e => setTemplateCategory(e.target.value)}
              style={{
                padding: "8px 12px", fontSize: 13, borderRadius: 6,
                border: `1px solid ${colors.border}`, background: colors.dark,
                color: colors.light, cursor: "pointer"
              }}
            >
              {templateCategories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
            </select>
            {(templateSearch || templateCategory !== 'All') && (
              <button
                onClick={() => { setTemplateSearch(''); setTemplateCategory('All'); }}
                style={{ ...styles.buttonSecondary, padding: "7px 14px", fontSize: 12 }}
              >
                ↺ Clear filters
              </button>
            )}
            <span style={{ fontSize: 12, color: colors.gray, marginLeft: "auto" }}>
              {filteredWorkflows.length} of {workflows.length} templates
            </span>
          </div>

          <div style={{ marginTop: 20, overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 800 }}>
              <thead>
                <tr style={{ borderBottom: `1.5px solid ${colors.border}`, textAlign: "left" }}>
                  <th style={{ padding: "12px 16px", color: colors.gray, fontSize: 12, fontWeight: 700 }}>TEMPLATE ID</th>
                  <th style={{ padding: "12px 16px", color: colors.gray, fontSize: 12, fontWeight: 700 }}>WORKFLOW NAME</th>
                  <th style={{ padding: "12px 16px", color: colors.gray, fontSize: 12, fontWeight: 700 }}>STEPS COUNT</th>
                  <th style={{ padding: "12px 16px", color: colors.gray, fontSize: 12, fontWeight: 700 }}>LAST UPDATED</th>
                  <th style={{ padding: "12px 16px", color: colors.gray, fontSize: 12, fontWeight: 700 }}>ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                {filteredWorkflows.map(flow => (
                  <tr key={flow.id} style={{ borderBottom: `1px solid ${colors.border}`, fontSize: 13 }}>
                    <td style={{ padding: "14px 16px", fontFamily: "monospace", fontWeight: 700, color: colors.light }}>{flow.id}</td>
                    <td style={{ padding: "14px 16px", color: colors.light }}>{flow.name}</td>
                    <td style={{ padding: "14px 16px", color: colors.gray }}>{flow.nodes?.length || 0} nodes</td>
                    <td style={{ padding: "14px 16px", color: colors.gray }}>{new Date(flow.updated_at || Date.now()).toLocaleString()}</td>
                    <td style={{ padding: "14px 16px", display: "flex", gap: 8 }}>
                      <button 
                        onClick={() => {
                          handleLoadWorkflow(flow.id);
                          setActiveTab("designer");
                        }}
                        style={{ ...styles.buttonSecondary, display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 12px" }}
                      >
                        📂 Load to Canvas
                      </button>
                      <button 
                        onClick={(e) => handleDeleteWorkflowTemplate(flow.id, flow.name, e)}
                        disabled={isViewer}
                        style={{ ...styles.buttonSecondary, padding: "5px 10px", borderColor: `${colors.danger}40`, color: colors.danger }}
                      >
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
                {filteredWorkflows.length === 0 && (
                  <tr>
                    <td colSpan={5} style={{ padding: 40, textAlign: "center", color: colors.gray }}>
                      {workflows.length === 0
                        ? "No templates saved. Draw a flow on the designer canvas and save it."
                        : "No templates match the current filters."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
        );
      })()}

      {/* 4b. Executions list dashboard tab view */}
      {activeTab === "history" && (
        <div style={styles.panel}>
          <h3 style={styles.sectionTitle}>Workflow Template Runs history</h3>
          <p style={styles.subtitle}>Audit past CLI deployments and review diagnostic status logs</p>
          
          <div style={{ marginTop: 20, overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 800 }}>
              <thead>
                <tr style={{ borderBottom: `1.5px solid ${colors.border}`, textAlign: "left" }}>
                  <th style={{ padding: "12px 16px", color: colors.gray, fontSize: 12, fontWeight: 700 }}>TASK RUN ID</th>
                  <th style={{ padding: "12px 16px", color: colors.gray, fontSize: 12, fontWeight: 700 }}>WORKFLOW NAME</th>
                  <th style={{ padding: "12px 16px", color: colors.gray, fontSize: 12, fontWeight: 700 }}>TARGET DEVICES</th>
                  <th style={{ padding: "12px 16px", color: colors.gray, fontSize: 12, fontWeight: 700 }}>START TIME</th>
                  <th style={{ padding: "12px 16px", color: colors.gray, fontSize: 12, fontWeight: 700 }}>STATUS</th>
                  <th style={{ padding: "12px 16px", color: colors.gray, fontSize: 12, fontWeight: 700 }}>ACTIONS</th>
                </tr>
                {/* Column-specific spreadsheet-like filters */}
                <tr className="no-print" style={{ background: isDark ? "rgba(2, 6, 23, 0.2)" : "rgba(248, 250, 252, 0.8)" }}>
                  <td style={{ padding: "6px 16px" }}>
                    <input 
                      type="text" 
                      placeholder="Filter Run ID..." 
                      value={filterTaskId}
                      onChange={e => setFilterTaskId(e.target.value)}
                      style={{ ...styles.input, padding: "4px 8px", fontSize: 11 }}
                    />
                  </td>
                  <td style={{ padding: "6px 16px" }}>
                    <input 
                      type="text" 
                      placeholder="Filter Name..." 
                      value={filterWorkflowName}
                      onChange={e => setFilterWorkflowName(e.target.value)}
                      style={{ ...styles.input, padding: "4px 8px", fontSize: 11 }}
                    />
                  </td>
                  <td style={{ padding: "6px 16px" }}>
                    <input 
                      type="text" 
                      placeholder="Filter Devices..." 
                      value={filterTargetDevices}
                      onChange={e => setFilterTargetDevices(e.target.value)}
                      style={{ ...styles.input, padding: "4px 8px", fontSize: 11 }}
                    />
                  </td>
                  <td style={{ padding: "6px 16px" }}>
                    <input 
                      type="text" 
                      placeholder="Filter Start Time..." 
                      value={filterStartTime}
                      onChange={e => setFilterStartTime(e.target.value)}
                      style={{ ...styles.input, padding: "4px 8px", fontSize: 11 }}
                    />
                  </td>
                  <td style={{ padding: "6px 16px" }}>
                    <select 
                      value={filterStatus} 
                      onChange={e => setFilterStatus(e.target.value)} 
                      style={{ ...styles.input, padding: "4px 8px", fontSize: 11 }}
                    >
                      <option value="All">All</option>
                      <option value="success">Success</option>
                      <option value="failed">Failed</option>
                      <option value="running">Running</option>
                      <option value="error">Error</option>
                    </select>
                  </td>
                  <td style={{ padding: "6px 16px" }}>
                    <button 
                      onClick={() => {
                        setFilterTaskId("");
                        setFilterWorkflowName("");
                        setFilterTargetDevices("");
                        setFilterStartTime("");
                        setFilterStatus("All");
                      }}
                      style={{ ...styles.buttonSecondary, padding: "4px 10px", fontSize: 11, width: "100%" }}
                    >
                      Reset
                    </button>
                  </td>
                </tr>
              </thead>
              <tbody>
                {filteredHistoryList.map(run => {
                  return (
                    <tr key={run.task_id} style={{ borderBottom: `1px solid ${colors.border}`, fontSize: 13 }}>
                      <td style={{ padding: "14px 16px", fontFamily: "monospace", fontWeight: 700, color: colors.light }}>{run.task_id}</td>
                      <td style={{ padding: "14px 16px", color: colors.light }}>{run.flow_name}</td>
                      <td style={{ padding: "14px 16px", color: colors.gray }}>{run.devices_count} devices</td>
                      <td style={{ padding: "14px 16px", color: colors.gray }}>{new Date(run.started_at).toLocaleString()}</td>
                      <td style={{ padding: "14px 16px" }}>
                        <span style={getBadgeStyle(run.status, colors)}>{run.status}</span>
                      </td>
                      <td style={{ padding: "14px 16px", display: "flex", gap: 8 }}>
                        <button 
                          onClick={async () => {
                            try {
                              const apiKey = sessionStorage.getItem('app_password') || '';
                              const res = await axios.get(`${API}/executions/${run.task_id}`, {
                                headers: { 'x-api-key': apiKey }
                              });
                              if (res.data) {
                                setConsoleModalData(res.data);
                                if (res.data.devices && res.data.devices.length > 0) {
                                  setConsoleSelectedDevice(res.data.devices[0]);
                                }
                                setConsoleActiveTab("logs");
                                setConsoleModalOpen(true);
                              }
                            } catch (e) {
                              alert("Failed to load execution logs: " + e.message);
                            }
                          }}
                          style={{ ...styles.buttonSecondary, display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 12px" }}
                        >
                          🖥️ View Console Logs
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {filteredHistoryList.length === 0 && (
                  <tr>
                    <td colSpan={6} style={{ padding: 40, textAlign: "center", color: colors.gray }}>
                      {historyList.length === 0 ? "No visual automation executions recorded yet." : "No matching visual automation executions found."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 5. Device Select Grid Modal Dialog */}
      {isGridModalOpen && selectedNode && (
        <div style={styles.modalBackdrop}>
          <div style={{ ...styles.modalCard, width: 900 }}>
            <div style={styles.modalHeader}>
              <h4 style={styles.modalTitle}>Device Select Node Config Grid</h4>
              <button onClick={() => setIsGridModalOpen(false)} style={styles.closeButton}>×</button>
            </div>
            <div style={styles.modalBody}>
              {/* Filter controls */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12, marginBottom: 16 }}>
                <div style={styles.fieldWrap}>
                  <label style={styles.label}>Router name</label>
                  <input type="text" value={searchName} onChange={(e) => setSearchName(e.target.value)} style={styles.input} />
                </div>
                <div style={styles.fieldWrap}>
                  <label style={styles.label}>IP Address</label>
                  <input type="text" value={searchIp} onChange={(e) => setSearchIp(e.target.value)} style={styles.input} />
                </div>
                <div style={styles.fieldWrap}>
                  <label style={styles.label}>Device Group</label>
                  <select value={filterGroup} onChange={(e) => setFilterGroup(e.target.value)} style={styles.input}>
                    <option value="">-- All --</option>
                    {deviceGroups.map(g => (
                      <option key={g.group} value={g.group}>{g.group}</option>
                    ))}
                  </select>
                </div>
                <div style={styles.fieldWrap}>
                  <label style={styles.label}>Vendor</label>
                  <select value={filterVendor} onChange={(e) => setFilterVendor(e.target.value)} style={styles.input}>
                    <option value="">-- All --</option>
                    <option value="cisco">CISCO</option>
                    <option value="cisco_xr">CISCO_XR</option>
                    <option value="huawei">HUAWEI</option>
                    <option value="juniper_junos">JUNIPER_JUNOS</option>
                  </select>
                </div>
              </div>

              {/* Grid table */}
              <div style={{ maxHeight: 350, overflowY: "auto", border: `1px solid ${colors.border}`, borderRadius: 12 }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: colors.darker, borderBottom: `1.5px solid ${colors.border}`, textAlign: "left" }}>
                      <th style={{ padding: "10px 14px" }}>
                        <input 
                          type="checkbox" 
                          checked={filteredInventoryList.length > 0 && filteredInventoryList.every(d => tickedDevices.includes(d.id))}
                          onChange={selectAllFiltered}
                          style={{ accentColor: colors.primary, cursor: "pointer" }}
                        />
                      </th>
                      <th style={{ padding: "10px 14px", color: colors.gray }}>Hostname</th>
                      <th style={{ padding: "10px 14px", color: colors.gray }}>IP Address</th>
                      <th style={{ padding: "10px 14px", color: colors.gray }}>Group</th>
                      <th style={{ padding: "10px 14px", color: colors.gray }}>Vendor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredInventoryList.map(dev => (
                      <tr key={dev.id} style={{ borderBottom: `1px solid ${colors.border}` }}>
                        <td style={{ padding: "10px 14px" }}>
                          <input 
                            type="checkbox" 
                            checked={tickedDevices.includes(dev.id)}
                            onChange={() => toggleDeviceSelection(dev.id)}
                            style={{ accentColor: colors.primary, cursor: "pointer" }}
                          />
                        </td>
                        <td style={{ padding: "10px 14px", fontWeight: 700, color: colors.light }}>{dev.hostname}</td>
                        <td style={{ padding: "10px 14px", color: colors.light }}>{dev.ip_address}</td>
                        <td style={{ padding: "10px 14px", color: colors.gray }}>{dev.group || dev.group_file}</td>
                        <td style={{ padding: "10px 14px" }}>
                          {(() => {
                            const normVendor = displayVendor(dev.vendor);
                            const badgeType = (normVendor === 'CISCO' || normVendor === 'CISCO_XR') ? 'info' : normVendor === 'HUAWEI' ? 'success' : 'warning';
                            return (
                              <span style={getBadgeStyle(badgeType, colors)}>{normVendor}</span>
                            );
                          })()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div style={{ padding: "14px 24px", borderTop: `1px solid ${colors.border}`, display: "flex", justifySpace: "between", background: colors.darker }}>
              <div style={{ fontSize: 12, color: colors.gray, display: "flex", alignItems: "center" }}>
                🎯 Selected {tickedDevices.length} node(s) overall
              </div>
              <button 
                onClick={() => setIsGridModalOpen(false)}
                style={{ ...styles.buttonPrimary, padding: "8px 24px" }}
              >
                Apply Selection
              </button>
            </div>
          </div>
        </div>
      )}
      {renderConsoleModal()}

      {/* Custom Node Builder Modal Dialog */}
      {isCustomNodeModalOpen && (
        <div style={styles.modalBackdrop}>
          <div style={{ ...styles.modalCard, width: 450 }}>
            <div style={styles.modalHeader}>
              <h4 style={styles.modalTitle}>Create Custom Node</h4>
              <button 
                type="button"
                onClick={() => setIsCustomNodeModalOpen(false)} 
                style={styles.closeButton}
              >
                ×
              </button>
            </div>
            <form onSubmit={handleCreateCustomNodeSubmit}>
              <div style={styles.modalBody}>
                <div style={{ ...styles.fieldWrap, marginBottom: 12 }}>
                  <label style={styles.label}>Node Name / Title</label>
                  <input 
                    type="text" 
                    value={customNodeForm.title} 
                    onChange={(e) => setCustomNodeForm({ ...customNodeForm, title: e.target.value })} 
                    placeholder="e.g. Save Settings, Run Script"
                    required
                    style={styles.input} 
                  />
                </div>
                <div style={{ ...styles.fieldWrap, marginBottom: 12 }}>
                  <label style={styles.label}>Description</label>
                  <textarea 
                    value={customNodeForm.description} 
                    onChange={(e) => setCustomNodeForm({ ...customNodeForm, description: e.target.value })} 
                    placeholder="Describe what this node represents..."
                    style={{ ...styles.input, minHeight: 60, resize: 'vertical' }} 
                  />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                  <div style={styles.fieldWrap}>
                    <label style={styles.label}>Icon / Emoji</label>
                    <select 
                      value={customNodeForm.icon} 
                      onChange={(e) => setCustomNodeForm({ ...customNodeForm, icon: e.target.value })} 
                      style={styles.input}
                    >
                      <option value="🛠️">🛠️ Tools</option>
                      <option value="⚙️">⚙️ Settings</option>
                      <option value="💾">💾 Save</option>
                      <option value="🔌">🔌 Connector</option>
                      <option value="🧪">🧪 Test</option>
                      <option value="📁">📁 File</option>
                      <option value="📡">📡 Network</option>
                      <option value="🔒">🔒 Secure</option>
                      <option value="🔑">🔑 Key</option>
                      <option value="🌍">🌍 Web</option>
                      <option value="📨">📨 Message</option>
                      <option value="🚀">🚀 Launch</option>
                    </select>
                  </div>
                  <div style={styles.fieldWrap}>
                    <label style={styles.label}>Card Color</label>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <input 
                        type="color" 
                        value={customNodeForm.color} 
                        onChange={(e) => setCustomNodeForm({ ...customNodeForm, color: e.target.value })} 
                        style={{ width: 32, height: 26, padding: 0, border: 'none', cursor: 'pointer', background: 'transparent' }} 
                      />
                      <input 
                        type="text" 
                        value={customNodeForm.color} 
                        onChange={(e) => setCustomNodeForm({ ...customNodeForm, color: e.target.value })} 
                        style={{ ...styles.input, flex: 1 }} 
                      />
                    </div>
                  </div>
                </div>
                
                {/* Parameters configuration */}
                <div style={{ marginTop: 12, borderTop: `1px solid ${colors.border}`, paddingTop: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <label style={{ ...styles.label, fontWeight: 700 }}>Custom Parameters</label>
                    <button 
                      type="button" 
                      onClick={handleAddFormParameter}
                      style={{ ...styles.buttonSecondary, fontSize: 9, padding: '2px 6px' }}
                    >
                      ➕ Add Parameter
                    </button>
                  </div>
                  {(customNodeForm.parameters || []).map((param, index) => (
                    <div key={index} style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center' }}>
                      <input 
                        type="text" 
                        placeholder="Param Name" 
                        value={param.key} 
                        onChange={(e) => handleUpdateFormParameter(index, 'key', e.target.value)}
                        style={{ ...styles.input, flex: 1, fontSize: 11 }}
                        required
                      />
                      <input 
                        type="text" 
                        placeholder="Default Value" 
                        value={param.value} 
                        onChange={(e) => handleUpdateFormParameter(index, 'value', e.target.value)}
                        style={{ ...styles.input, flex: 1, fontSize: 11 }}
                      />
                      <button 
                        type="button" 
                        onClick={() => handleRemoveFormParameter(index)}
                        style={{ background: 'none', border: 'none', color: colors.danger, cursor: 'pointer', fontSize: 12 }}
                      >
                        🗑️
                      </button>
                    </div>
                  ))}
                </div>
              </div>
              <div style={{ padding: "14px 24px", borderTop: `1px solid ${colors.border}`, display: "flex", justifyContent: "flex-end", gap: 12, background: colors.darker }}>
                <button 
                  type="button"
                  onClick={() => setIsCustomNodeModalOpen(false)}
                  style={styles.buttonSecondary}
                >
                  Cancel
                </button>
                <button 
                  type="submit"
                  style={styles.buttonPrimary}
                >
                  Create Element
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 4c. Ansible Flows tab — upload playbooks, install vendor collections.
          List/upload/install only — no run action exists in this UI, matching
          the backend's deliberate lack of an execution endpoint. */}
      {activeTab === "ansible" && (
        <div style={styles.panel}>
          <h3 style={styles.sectionTitle}>Ansible Flows &amp; Vendor Libraries</h3>
          <p style={styles.subtitle}>
            Upload custom playbooks and install additional vendor collections for the Ansible automation layer.
            Every device interaction those flows make goes through NETAct_backend's sanitized gateway — nothing here
            connects to a device directly, and nothing here can be triggered to run against a device from this page.
          </p>

          {ansibleMessage && (
            <div style={{
              marginTop: 12, padding: "10px 14px", borderRadius: 8,
              background: `${ansibleMessage.type === "error" ? colors.danger : colors.success}20`,
              border: `1px solid ${ansibleMessage.type === "error" ? colors.danger : colors.success}`,
              color: ansibleMessage.type === "error" ? colors.danger : colors.success,
              fontSize: 13,
            }}>
              {ansibleMessage.text}
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginTop: 20 }}>
            {/* Upload playbook */}
            <div style={{ ...styles.panel, padding: 16 }}>
              <h4 style={{ ...styles.sectionTitle, fontSize: 14 }}>Upload a Custom Flow (Playbook)</h4>
              <p style={{ ...styles.subtitle, fontSize: 12 }}>
                Validated with --syntax-check before being saved — a playbook that fails is rejected, not stored.
              </p>
              <input
                type="file"
                accept=".yml,.yaml"
                onChange={(e) => setSelectedPlaybookFile(e.target.files?.[0] || null)}
                style={{ ...styles.input, marginTop: 8 }}
              />
              <button
                onClick={handleUploadPlaybook}
                disabled={!selectedPlaybookFile || ansibleLoading}
                style={{ ...styles.buttonPrimary, marginTop: 12, opacity: (!selectedPlaybookFile || ansibleLoading) ? 0.5 : 1 }}
              >
                <Upload size={14} style={{ marginRight: 6 }} /> Upload &amp; Validate
              </button>
            </div>

            {/* Install collection */}
            <div style={{ ...styles.panel, padding: 16 }}>
              <h4 style={{ ...styles.sectionTitle, fontSize: 14 }}>Install a Vendor Collection</h4>
              <p style={{ ...styles.subtitle, fontSize: 12 }}>
                e.g. <code>cisco.nxos</code>, <code>arista.eos</code> — persisted to requirements.yml so it survives a rebuild.
              </p>
              <input
                type="text"
                placeholder="namespace.collection (e.g. cisco.ios)"
                value={newCollectionName}
                onChange={(e) => setNewCollectionName(e.target.value)}
                style={{ ...styles.input, marginTop: 8 }}
              />
              <input
                type="text"
                placeholder="version (optional)"
                value={newCollectionVersion}
                onChange={(e) => setNewCollectionVersion(e.target.value)}
                style={{ ...styles.input, marginTop: 8 }}
              />
              <button
                onClick={handleInstallCollection}
                disabled={!newCollectionName.trim() || ansibleLoading}
                style={{ ...styles.buttonPrimary, marginTop: 12, opacity: (!newCollectionName.trim() || ansibleLoading) ? 0.5 : 1 }}
              >
                <Plus size={14} style={{ marginRight: 6 }} /> Install Collection
              </button>
            </div>
          </div>

          {/* Existing flows list */}
          <div style={{ marginTop: 24 }}>
            <h4 style={{ ...styles.sectionTitle, fontSize: 14 }}>Existing Flows</h4>
            <div style={{ marginTop: 8, overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: `1.5px solid ${colors.border}`, textAlign: "left" }}>
                    <th style={{ padding: "10px 14px", color: colors.gray, fontSize: 12, fontWeight: 700 }}>NAME</th>
                    <th style={{ padding: "10px 14px", color: colors.gray, fontSize: 12, fontWeight: 700 }}>SIZE</th>
                    <th style={{ padding: "10px 14px", color: colors.gray, fontSize: 12, fontWeight: 700 }}>ACTIONS</th>
                  </tr>
                </thead>
                <tbody>
                  {ansibleFlows.length > 0 ? ansibleFlows.map((f) => (
                    <tr key={f.name} style={{ borderBottom: `1px solid ${colors.border}` }}>
                      <td style={{ padding: "10px 14px", fontFamily: "monospace", fontSize: 13 }}>{f.name}</td>
                      <td style={{ padding: "10px 14px", fontSize: 13 }}>{f.size_bytes} bytes</td>
                      <td style={{ padding: "10px 14px", display: "flex", gap: 8 }}>
                        <button onClick={() => handleViewFlow(f.name)} style={{ ...styles.buttonSecondary, padding: "4px 10px", fontSize: 12 }}>
                          <FileText size={12} style={{ marginRight: 4 }} /> View
                        </button>
                        <button onClick={() => handleSyntaxCheckFlow(f.name)} style={{ ...styles.buttonSecondary, padding: "4px 10px", fontSize: 12 }}>
                          <CheckCircle size={12} style={{ marginRight: 4 }} /> Syntax Check
                        </button>
                      </td>
                    </tr>
                  )) : (
                    <tr>
                      <td colSpan={3} style={{ padding: "16px 14px", color: colors.gray, fontSize: 13 }}>
                        No flows found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {flowContentPreview && (
            <div style={{ marginTop: 20 }}>
              <h4 style={{ ...styles.sectionTitle, fontSize: 14 }}>
                {flowContentPreview.name}
                <button
                  onClick={() => setFlowContentPreview(null)}
                  style={{ ...styles.buttonSecondary, padding: "2px 8px", fontSize: 11, marginLeft: 10 }}
                >
                  <X size={11} />
                </button>
              </h4>
              <pre style={{
                background: colors.dark, border: `1px solid ${colors.border}`, borderRadius: 8,
                padding: 14, fontSize: 12, overflowX: "auto", maxHeight: 400, overflowY: "auto",
              }}>
                {flowContentPreview.content}
              </pre>
            </div>
          )}

          {/* Installed collections */}
          <div style={{ marginTop: 24 }}>
            <h4 style={{ ...styles.sectionTitle, fontSize: 14 }}>Installed Vendor Collections</h4>
            <pre style={{
              marginTop: 8, background: colors.dark, border: `1px solid ${colors.border}`, borderRadius: 8,
              padding: 14, fontSize: 12, overflowX: "auto", maxHeight: 300, overflowY: "auto",
            }}>
              {ansibleCollections || "Loading..."}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

// Inline custom glowing animation styles for Canvas Node Cards
if (typeof document !== 'undefined') {
  const styles = document.createElement('style');
  styles.innerHTML = `
    @keyframes pulseGlow {
      0% { opacity: 0.95; }
      50% { opacity: 0.8; }
      100% { opacity: 0.95; }
    }
    .flowing-dash {
      stroke-dasharray: 8;
      animation: dash 1s linear infinite;
    }
    @keyframes dash {
      to {
        stroke-dashoffset: -16;
      }
    }
    .react-flow__controls {
      box-shadow: 0 8px 32px rgba(0,0,0,0.3) !important;
      border: 1px solid var(--theme-border, #334155) !important;
      border-radius: 8px !important;
      overflow: hidden !important;
      background: var(--theme-dark, #0f172a) !important;
    }
    .react-flow__controls-button {
      background: var(--theme-dark, #0f172a) !important;
      border: none !important;
      border-bottom: 1px solid var(--theme-border, #334155) !important;
      color: var(--theme-light, #f8fafc) !important;
    }
    .react-flow__controls-button:last-child {
      border-bottom: none !important;
    }
    .react-flow__controls-button:hover {
      background: var(--theme-border, #334155) !important;
    }
    .react-flow__controls-button svg {
      fill: var(--theme-light, #f8fafc) !important;
    }
  `;
  document.head.appendChild(styles);
}
