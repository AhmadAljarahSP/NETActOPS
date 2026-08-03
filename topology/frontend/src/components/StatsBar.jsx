import React from 'react'

export default function StatsBar({
  topology,
  lastRefresh,
  statusFilter,
  setStatusFilter,
  showOspf,
  setShowOspf,
  showLldp,
  setShowLldp,
  showBgp,
  setShowBgp,
  setFilter,
  setSelectedGroup,
}) {
  if (!topology) return null
  const { nodes, edges, device_count, healthcheck_count } = topology
  const statusCounts = nodes.reduce((acc, n) => {
    acc[n.status] = (acc[n.status] || 0) + 1
    return acc
  }, {})
  const ospfCount = edges.filter(e => e.protocol === 'ospf').length
  const lldpCount = edges.filter(e => e.protocol === 'lldp').length
  const bgpCount = edges.filter(e => e.protocol === 'bgp').length

  const style = {
    display: 'flex',
    gap: 10,
    alignItems: 'center',
    padding: '8px 16px',
    background: 'var(--surface)',
    borderBottom: '1px solid var(--border)',
    fontSize: 11,
    flexWrap: 'wrap',
  }

  const dot = (color) => (
    <span style={{
      width: 7,
      height: 7,
      borderRadius: '50%',
      background: color,
      display: 'inline-block',
      boxShadow: `0 0 5px ${color}`
    }} />
  )

  const handleResetAll = () => {
    if (setStatusFilter) setStatusFilter('All')
    if (setFilter) setFilter('')
    if (setSelectedGroup) setSelectedGroup('All Groups')
  }

  return (
    <div style={style}>
      <button className="stats-bar-btn stats-bar-reset-btn" onClick={handleResetAll} title="Reset all filters and search">
        <span>Devices in git:</span> <strong style={{ color: 'var(--text)' }}>{device_count}</strong>
      </button>
      <div className="stats-bar-btn" style={{ cursor: 'default' }}>
        <span>Healthchecks:</span> <strong style={{ color: 'var(--text)' }}>{healthcheck_count}</strong>
      </div>
      <button className="stats-bar-btn stats-bar-reset-btn" onClick={handleResetAll} title="Reset all filters and search">
        <span>Nodes:</span> <strong style={{ color: 'var(--text)' }}>{nodes.length}</strong>
      </button>
      <div className="stats-bar-btn" style={{ cursor: 'default' }}>
        <span>Links:</span> <strong style={{ color: 'var(--text)' }}>{edges.length}</strong>
      </div>

      {/* OK Filter */}
      <button
        className={`stats-bar-btn ${statusFilter === 'ok' ? 'active-ok' : ''}`}
        onClick={() => setStatusFilter(statusFilter === 'ok' ? 'All' : 'ok')}
        title="Toggle show only OK nodes"
      >
        {dot('#3fb950')}
        <span>OK:</span>
        <strong style={{ color: '#3fb950' }}>{statusCounts.ok || 0}</strong>
      </button>

      {/* Warn Filter */}
      <button
        className={`stats-bar-btn ${statusFilter === 'warning' ? 'active-warning' : ''}`}
        onClick={() => setStatusFilter(statusFilter === 'warning' ? 'All' : 'warning')}
        title="Toggle show only Warning nodes"
      >
        {dot('#d29922')}
        <span>Warn:</span>
        <strong style={{ color: '#d29922' }}>{statusCounts.warning || 0}</strong>
      </button>

      {/* Error Filter */}
      <button
        className={`stats-bar-btn ${statusFilter === 'error' ? 'active-error' : ''}`}
        onClick={() => setStatusFilter(statusFilter === 'error' ? 'All' : 'error')}
        title="Toggle show only Error nodes"
      >
        {dot('#f85149')}
        <span>Error:</span>
        <strong style={{ color: '#f85149' }}>{(statusCounts.error || 0) + (statusCounts.auth_fail || 0)}</strong>
      </button>

      {/* OSPF Links Toggle */}
      <button
        className={`stats-bar-btn ${showOspf ? 'active-ospf' : 'inactive'}`}
        onClick={() => setShowOspf(v => !v)}
        title="Toggle OSPF links visibility"
      >
        {dot('#58a6ff')}
        <span>OSPF links:</span>
        <strong style={{ color: '#58a6ff' }}>{ospfCount}</strong>
      </button>

      {/* LLDP Links Toggle */}
      <button
        className={`stats-bar-btn ${showLldp ? 'active-lldp' : 'inactive'}`}
        onClick={() => setShowLldp(v => !v)}
        title="Toggle LLDP links visibility"
      >
        {dot('#3fb950')}
        <span>LLDP links:</span>
        <strong style={{ color: '#3fb950' }}>{lldpCount}</strong>
      </button>
      
      {/* BGP Links Toggle */}
      <button
        className={`stats-bar-btn ${showBgp ? 'active-bgp' : 'inactive'}`}
        onClick={() => setShowBgp(v => !v)}
        title="Toggle BGP links visibility"
      >
        {dot('#d859ff')}
        <span>BGP links:</span>
        <strong style={{ color: '#d859ff' }}>{bgpCount}</strong>
      </button>

      {lastRefresh && <span style={{ color: 'var(--text-muted)', marginLeft: 'auto', fontSize: 10 }}>Last refresh: {lastRefresh}</span>}
    </div>
  )
}

