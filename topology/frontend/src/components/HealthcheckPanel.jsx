import React, { useEffect, useState } from 'react'
import { getDeviceHC, getNeighbors } from '../hooks/useApi.js'

const STATUS_COLORS = {
  ok:       'var(--accent2)',
  warning:  'var(--warning)',
  error:    'var(--danger)',
  critical: 'var(--danger)',
  unknown:  'var(--text-muted)',
}

function KPIBar({ label, value, max = 100, status }) {
  const pct = Math.min(100, Math.max(0, typeof value === 'number' ? value : 0))
  const color = STATUS_COLORS[status] || STATUS_COLORS.ok
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
        <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{label}</span>
        <span style={{ color, fontSize: 11, fontWeight: 600 }}>{pct.toFixed(0)}%</span>
      </div>
      <div style={{ background: 'var(--surface)', borderRadius: 3, height: 5 }}>
        <div style={{ width: `${pct}%`, background: color, height: '100%', borderRadius: 3, transition: 'width 0.4s' }} />
      </div>
    </div>
  )
}

export default function HealthcheckPanel({ deviceName, onClose, isPlaced, onUnplaceNode }) {
  const [hc, setHc]  = useState(null)
  const [nbr, setNbr] = useState(null)
  const [tab, setTab] = useState('kpi')
  const [loading, setLoading] = useState(true)
  const [error, setError]  = useState(null)

  useEffect(() => {
    if (!deviceName) return
    setLoading(true)
    setError(null)
    setHc(null)
    setNbr(null)

    Promise.all([
      getDeviceHC(deviceName).catch(e => ({ _error: e.message })),
      getNeighbors(deviceName).catch(() => ({ neighbors: [] })),
    ]).then(([hcData, nbrData]) => {
      if (hcData._error) {
        setError(hcData._error)
      } else {
        setHc(hcData)
        setNbr(nbrData)
      }
      setLoading(false)
    })
  }, [deviceName])

  if (!deviceName) return null

  const panelStyle = {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: 340,
    background: 'var(--surface)',
    borderLeft: '1px solid var(--border)',
    display: 'flex',
    flexDirection: 'column',
    zIndex: 2000,
  }

  const headerStyle = {
    padding: '12px 14px',
    borderBottom: '1px solid var(--border)',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  }

  return (
    <div style={panelStyle}>
      <div style={headerStyle}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 13 }}>{deviceName}</div>
          {hc && <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>{hc.ip}</div>}
        </div>
        <button onClick={onClose} style={{ padding: '2px 8px' }}>✕</button>
      </div>

      {isPlaced && (
        <div style={{
          padding: '8px 14px',
          background: 'rgba(248, 81, 73, 0.08)',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ color: 'var(--accent2)' }}>📍</span> Placed on Map
          </span>
          <button
            onClick={() => onUnplaceNode && onUnplaceNode(deviceName)}
            style={{
              padding: '4px 10px',
              fontSize: 10,
              fontWeight: 700,
              cursor: 'pointer',
              background: 'var(--danger)',
              border: 'none',
              borderRadius: 6,
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              boxShadow: '0 2px 4px rgba(248, 81, 73, 0.2)',
              transition: 'background 0.2s',
            }}
            onMouseOver={(e) => e.target.style.background = '#d83a34'}
            onMouseOut={(e) => e.target.style.background = 'var(--danger)'}
          >
            Unplace Node
          </button>
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', gap: 0 }}>
        {['kpi', 'neighbors', 'raw'].map(t => (
          <button
            key={t}
            className={tab === t ? 'active' : ''}
            onClick={() => setTab(t)}
            style={{ flex: 1, borderRadius: 0, borderTop: 'none', borderLeft: 'none', borderRight: 'none' }}
          >
            {t.toUpperCase()}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 14 }}>
        {loading && <div style={{ color: 'var(--text-muted)' }}>Loading…</div>}
        {error && <div style={{ color: 'var(--danger)' }}>Error: {error}</div>}

        {!loading && !error && hc && tab === 'kpi' && (
          <div>
            {/* Timestamp */}
            <div style={{ color: 'var(--text-muted)', fontSize: 11, marginBottom: 14 }}>
              Collected: {new Date(hc.timestamp * 1000).toLocaleString()}
            </div>

            {/* KPI cards */}
            {Object.entries(hc.analysis).map(([cmd, a]) => {
              const isCpu = cmd.toLowerCase().includes('cpu')
              const isMem = cmd.toLowerCase().includes('mem')
              return (
                <div key={cmd} style={{
                  background: 'var(--surface2)',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  padding: '10px 12px',
                  marginBottom: 8,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                      {cmd.length > 30 ? '…' + cmd.slice(-28) : cmd}
                    </span>
                    <span className={`badge badge-${a.status}`}>{a.status}</span>
                  </div>

                  {(isCpu || isMem) && typeof a.value === 'number' && (
                    <KPIBar label={isCpu ? 'CPU Usage' : 'Memory Usage'} value={a.value} status={a.status} />
                  )}

                  {a.summary && (
                    <div style={{ fontSize: 12, color: 'var(--text)', marginTop: 4 }}>{a.summary}</div>
                  )}

                  {typeof a.value === 'object' && a.value?.up !== undefined && (
                    <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
                      <span style={{ color: 'var(--accent2)', fontSize: 11 }}>▲ {a.value.up} UP</span>
                      <span style={{ color: a.value.down > 0 ? 'var(--danger)' : 'var(--text-muted)', fontSize: 11 }}>
                        ▼ {a.value.down} DOWN
                      </span>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {!loading && !error && tab === 'neighbors' && nbr && (
          <div>
            <div style={{ color: 'var(--text-muted)', fontSize: 11, marginBottom: 10 }}>
              {nbr.count} neighbors found
            </div>
            {nbr.neighbors.length === 0 && (
              <div style={{ color: 'var(--text-muted)' }}>No OSPF/LLDP neighbors parsed.</div>
            )}
            {nbr.neighbors.map((n, i) => (
              <div key={i} style={{
                background: 'var(--surface2)',
                border: '1px solid var(--border)',
                borderRadius: 6,
                padding: '8px 10px',
                marginBottom: 6,
                fontSize: 11,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                  <span style={{ fontWeight: 600, color: 'var(--text)' }}>{n.neighbor_id}</span>
                  <span className={`badge badge-${n.protocol}`}>{n.protocol.toUpperCase()}</span>
                </div>
                <div style={{ color: 'var(--text-muted)' }}>
                  Local: <code style={{ color: 'var(--accent)' }}>{n.local_interface}</code>
                  {n.remote_port && <> → Remote: <code style={{ color: 'var(--accent2)' }}>{n.remote_port}</code></>}
                </div>
                {n.neighbor_ip && <div style={{ color: 'var(--text-muted)' }}>IP: {n.neighbor_ip}</div>}
              </div>
            ))}
          </div>
        )}

        {!loading && !error && hc && tab === 'raw' && (
          <pre style={{
            fontSize: 10,
            color: 'var(--text-muted)',
            fontFamily: 'monospace',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
            lineHeight: 1.5,
          }}>
            {hc.raw_preview}
          </pre>
        )}
      </div>
    </div>
  )
}
