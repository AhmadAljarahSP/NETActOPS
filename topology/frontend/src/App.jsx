import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import TopologyGraph from './components/TopologyGraph.jsx'
import Topology3D, { GALAXY_THEMES } from './components/Topology3D.jsx'
import GeoTopologyMap from './components/GeoTopologyMap.jsx'
import TopologySankey from './components/TopologySankey.jsx'
import MplsTopologyMap from './components/MplsTopologyMap.jsx'
import HealthcheckPanel from './components/HealthcheckPanel.jsx'
import StatsBar from './components/StatsBar.jsx'
import { getTopology, saveCoord, saveCoordGeo, bulkSaveCoords, deleteCoord, getBgpRegistry, saveBgpRegistry } from './hooks/useApi.js'

const LOGO_TEXT = '⬡ NETAct Topology'

// Node types that must never appear outside the Geographic Map view.
// bgp_cloud  = AS peer cloud icons (virtual, positioned around their router)
// isp_target = ISP ping target IPs (e.g. 203.0.113.10) added from isp_ping_targets.json
const GEO_ONLY_NODE_TYPES = new Set(['bgp_cloud', 'isp_target'])

export default function App() {
  const [topology, setTopology]     = useState(null)
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState(null)
  const [selectedNode, setSelectedNode] = useState(null)
  const [showOspf, setShowOspf]     = useState(true)
  const [showLldp, setShowLldp]     = useState(true)
  const [showBgp, setShowBgp]       = useState(true)
  const [asRegistry, setAsRegistry] = useState({})
  const [showBgpClouds, setShowBgpClouds] = useState(true)
  const [lastRefresh, setLastRefresh] = useState(null)
  const [mapMode, setMapMode]       = useState(false)
  const [mapImage, setMapImage]     = useState(null)
  const [filter, setFilter]         = useState('')
  const [selectedGroup, setSelectedGroup] = useState('All Groups')
  const [statusFilter, setStatusFilter] = useState('All')
  const [autoRefresh, setAutoRefresh] = useState(false)
  const timerRef = useRef(null)
  const fileInputRef = useRef(null)

  // OSPF Ping historical range states
  const [ospfTimeRange, setOspfTimeRange] = useState('latest')
  const [customStart, setCustomStart]     = useState('')
  const [customEnd, setCustomEnd]         = useState('')

  // 3D-specific UI state
  const [showNodeList,  setShowNodeList]  = useState(false)
  const [labelMode,     setLabelMode]     = useState('name') // 'name' | 'name_ip' | 'hidden'
  const [galaxyTheme,   setGalaxyTheme]   = useState('cosmic')
  const [focusNodeId,   setFocusNodeId]   = useState(null)

  // Geographical Map Settings
  const [layoutMode, setLayoutMode] = useState('3d') // '3d' | 'force' | 'image' | 'geo'
  const [geoProvider, setGeoProvider] = useState(() => localStorage.getItem('geo_provider') || 'osm')
  const [googleMapsKey, setGoogleMapsKey] = useState(() => localStorage.getItem('google_maps_key') || '')
  const [showKeyInput, setShowKeyInput] = useState(false)
  
  // Link view mode and map theme controls
  const [linkViewMode, setLinkViewMode] = useState(() => localStorage.getItem('link_view_mode') || 'logical')
  const [mapTheme, setMapTheme] = useState(() => localStorage.getItem('map_theme') || 'dark')

  // Fullscreen and Auto-hide Toolbar settings
  const containerRef = useRef(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [showToolbarInFullscreen, setShowToolbarInFullscreen] = useState(false)
  const [fullscreenTipOpacity, setFullscreenTipOpacity] = useState(0)

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement)
    }
    document.addEventListener('fullscreenchange', handleFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange)
  }, [])

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isFullscreen) return
      if (e.clientY < 50) {
        setShowToolbarInFullscreen(true)
      } else if (e.clientY > 100) {
        setShowToolbarInFullscreen(false)
      }
    }
    if (isFullscreen) {
      window.addEventListener('mousemove', handleMouseMove)
    }
    return () => window.removeEventListener('mousemove', handleMouseMove)
  }, [isFullscreen])

  useEffect(() => {
    if (isFullscreen) {
      setFullscreenTipOpacity(1)
      const t1 = setTimeout(() => setFullscreenTipOpacity(0.9), 2000)
      const t2 = setTimeout(() => setFullscreenTipOpacity(0), 3000)
      return () => {
        clearTimeout(t1)
        clearTimeout(t2)
      }
    } else {
      setFullscreenTipOpacity(0)
    }
  }, [isFullscreen])

  const toggleFullscreen = () => {
    if (!containerRef.current) return
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen()
        .then(() => {
          setIsFullscreen(true)
          setShowToolbarInFullscreen(false)
        })
        .catch(err => console.warn('Fullscreen request failed:', err))
    } else {
      document.exitFullscreen()
        .then(() => setIsFullscreen(false))
        .catch(err => console.warn('Fullscreen exit failed:', err))
    }
  }

  const fetchTopology = useCallback((range = ospfTimeRange, start = customStart, end = customEnd) => {
    setLoading(true)
    setError(null)
    const actualRange = (range && typeof range === 'string') ? range : ospfTimeRange
    const params = { time_range: actualRange }
    if (actualRange === 'custom') {
      const sVal = (start && typeof start === 'string') ? start : customStart
      const eVal = (end && typeof end === 'string') ? end : customEnd
      if (sVal) params.start_time = new Date(sVal).getTime() / 1000
      if (eVal) params.end_time = new Date(eVal).getTime() / 1000
    }
    getTopology(params)
      .then(data => {
        setTopology(data)
        setLastRefresh(new Date().toLocaleTimeString())
        setLoading(false)
      })
      .catch(e => {
        setError(e.message || 'Failed to fetch topology')
        setLoading(false)
      })
  }, [ospfTimeRange, customStart, customEnd])

  useEffect(() => {
    fetchTopology()
  }, [fetchTopology])

  // Fetch BGP AS registry once on mount
  useEffect(() => {
    getBgpRegistry().then(data => setAsRegistry(data)).catch(() => {})
  }, [])

  useEffect(() => {
    if (autoRefresh) {
      timerRef.current = setInterval(() => fetchTopology(), 60000)
    } else {
      clearInterval(timerRef.current)
    }
    return () => clearInterval(timerRef.current)
  }, [autoRefresh, fetchTopology])

  const handleNodeMoved = useCallback((deviceId, x, y) => {
    saveCoord(deviceId, x, y).catch(err => console.warn('Save coord failed:', err))
  }, [])

  const handleGeoNodeMoved = useCallback((deviceId, lat, lng) => {
    saveCoordGeo(deviceId, lat, lng)
      .then(() => {
        // Optimistically update coordinates locally in topology state
        setTopology(prev => {
          if (!prev) return null
          return {
            ...prev,
            nodes: prev.nodes.map(n => {
              if (n.id === deviceId) {
                return { ...n, latitude: lat, longitude: lng }
              }
              return n
            })
          }
        })
      })
      .catch(err => console.warn('Save geo coord failed:', err))
  }, [])

  const handleUnplaceNode = useCallback((deviceId) => {
    deleteCoord(deviceId)
      .then(() => {
        setTopology(prev => {
          if (!prev) return null
          return {
            ...prev,
            nodes: prev.nodes.map(n => {
              if (n.id === deviceId) {
                return { ...n, latitude: null, longitude: null, x: null, y: null }
              }
              return n
            })
          }
        })
        setSelectedNode(null)
      })
      .catch(err => console.warn('Unplace node failed:', err))
  }, [])

  const handleMapUpload = (e) => {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => setMapImage(ev.target.result)
    reader.readAsDataURL(file)
    setMapMode(true)
  }

  // Memoize topology filtered only by group so that stats counts remain stable
  const groupFilteredTopology = useMemo(() => {
    if (!topology) return null
    if (selectedGroup === 'All Groups') return topology

    if (layoutMode !== 'sankey') {
      const groupNodes = topology.nodes.filter(n =>
        n.groups && n.groups.includes(selectedGroup)
      )
      const groupNodeIds = new Set(groupNodes.map(n => n.id))
      const groupEdges = topology.edges.filter(e =>
        groupNodeIds.has(e.source) && groupNodeIds.has(e.target)
      )
      return {
        ...topology,
        nodes: groupNodes,
        edges: groupEdges,
      }
    } else {
      // For sankey layout, keep edges if the source belongs to the selected group
      const groupNodes = topology.nodes.filter(n =>
        n.groups && n.groups.includes(selectedGroup)
      )
      const groupNodeIds = new Set(groupNodes.map(n => n.id))
      const groupEdges = topology.edges.filter(e =>
        e.protocol === 'isp' && groupNodeIds.has(e.source)
      )
      
      // Also keep all target nodes for these edges, even if they aren't in the selected group
      const keptNodeIds = new Set(groupNodeIds)
      groupEdges.forEach(e => {
        keptNodeIds.add(e.source)
        keptNodeIds.add(e.target)
      })
      
      const keptNodes = topology.nodes.filter(n => keptNodeIds.has(n.id))
      return {
        ...topology,
        nodes: keptNodes,
        edges: groupEdges,
      }
    }
  }, [topology, selectedGroup, layoutMode])

  // Filter nodes & edges — memoised so a selectedNode change never recreates these arrays
  const { filteredNodes, filteredEdges } = useMemo(() => {
    if (!groupFilteredTopology) return { filteredNodes: [], filteredEdges: [] }

    // 1. Strip geo-only node types (bgp_cloud, isp_target). The geo view re-adds
    //    them via geoNodes/geoEdges below so 3D/force/MPLS never see them.
    const statusFilteredNodes = groupFilteredTopology.nodes.filter(n => {
      if (GEO_ONLY_NODE_TYPES.has(n.node_type)) return false
      if (statusFilter === 'All') return true
      if (statusFilter === 'ok') return n.status === 'ok'
      if (statusFilter === 'warning') return n.status === 'warning'
      if (statusFilter === 'error') return n.status === 'error' || n.status === 'auth_fail'
      return true
    })
    const activeNodeIds = new Set(statusFilteredNodes.map(n => n.id))

    // 2. Find nodes that directly match the search filter (within the matched status/group)
    const searchLower = filter.toLowerCase()
    const directMatchNodes = statusFilteredNodes.filter(n =>
      !filter ||
      n.label.toLowerCase().includes(searchLower) ||
      (n.ip || '').includes(filter)
    )
    const directMatchIds = new Set(directMatchNodes.map(n => n.id))

    if (filter) {
      const connectedEdges = groupFilteredTopology.edges.filter(e =>
        activeNodeIds.has(e.source) && activeNodeIds.has(e.target) &&
        (directMatchIds.has(e.source) || directMatchIds.has(e.target))
      )
      const neighborIds = new Set()
      connectedEdges.forEach(e => { neighborIds.add(e.source); neighborIds.add(e.target) })
      return {
        filteredNodes: statusFilteredNodes.filter(n => neighborIds.has(n.id)).map(n => ({
          ...n, highlight: directMatchIds.has(n.id),
        })),
        filteredEdges: connectedEdges,
      }
    } else {
      return {
        filteredNodes: statusFilteredNodes.map(n => ({ ...n, highlight: false })),
        filteredEdges: groupFilteredTopology.edges.filter(e => activeNodeIds.has(e.source) && activeNodeIds.has(e.target)),
      }
    }
  }, [groupFilteredTopology, filter, statusFilter])

  // ISP group device IDs — used to filter bgp_cloud nodes in geo view
  const ispDeviceIds = useMemo(() => {
    if (!groupFilteredTopology) return new Set()
    return new Set(
      groupFilteredTopology.nodes
        .filter(n => n.groups?.includes('ISP') && n.node_type !== 'bgp_cloud')
        .map(n => n.id)
    )
  }, [groupFilteredTopology])

  // For geo (ISP Topology) view:
  //   - isp_target nodes: added back unchanged (keep existing behaviour)
  //   - bgp_cloud nodes: only for routers in the ISP group
  const geoNodes = useMemo(() => {
    if (layoutMode !== 'geo' || !groupFilteredTopology) return filteredNodes
    const ispTargets = groupFilteredTopology.nodes.filter(n => n.node_type === 'isp_target')
    const ispClouds  = groupFilteredTopology.nodes.filter(n =>
      n.node_type === 'bgp_cloud' && ispDeviceIds.has(n.router_id)
    )
    return [...filteredNodes, ...ispTargets, ...ispClouds]
  }, [layoutMode, filteredNodes, groupFilteredTopology, ispDeviceIds])

  const geoEdges = useMemo(() => {
    if (layoutMode !== 'geo' || !groupFilteredTopology) return filteredEdges
    const visibleIds = new Set(geoNodes.map(n => n.id))
    return groupFilteredTopology.edges.filter(e =>
      visibleIds.has(e.source) && visibleIds.has(e.target)
    )
  }, [layoutMode, geoNodes, groupFilteredTopology, filteredEdges])

  // 3D Motion: only devices that have a healthcheck file
  const threeDNodes = useMemo(() =>
    filteredNodes.filter(n => n.hc_file != null),
    [filteredNodes]
  )
  const threeDEdges = useMemo(() => {
    const ids = new Set(threeDNodes.map(n => n.id))
    return filteredEdges.filter(e => ids.has(e.source) && ids.has(e.target))
  }, [threeDNodes, filteredEdges])

  // Layout
  const headerStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '8px 16px',
    background: 'var(--surface)',
    borderBottom: '1px solid var(--border)',
    flexShrink: 0,
    flexWrap: 'wrap',
  }

  const activeHeaderStyle = {
    ...headerStyle,
    ...(isFullscreen ? {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      zIndex: 9999,
      transform: showToolbarInFullscreen ? 'translateY(0)' : 'translateY(-100%)',
      transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
      boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
    } : {})
  }

  const mainStyle = {
    flex: 1,
    position: 'relative',
    overflow: 'hidden',
  }

  return (
    <div ref={containerRef} style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden', position: 'relative' }}>
      {/* Fullscreen HUD Tip */}
      {fullscreenTipOpacity > 0 && (
        <div style={{
          position: 'absolute',
          top: 24,
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'rgba(13, 17, 23, 0.95)',
          border: '1px solid var(--accent)',
          borderRadius: 8,
          padding: '10px 20px',
          fontSize: 12,
          color: '#e6edf3',
          zIndex: 10000,
          pointerEvents: 'none',
          boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
          backdropFilter: 'blur(8px)',
          opacity: fullscreenTipOpacity,
          transition: 'opacity 0.5s ease-in-out',
        }}>
          🖥 Fullscreen Mode Enabled · Move cursor to the top edge to show the toolbar.
        </div>
      )}

      {/* Header toolbar */}
      <div style={activeHeaderStyle}>
        <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--accent)', letterSpacing: 0.5, marginRight: 8 }}>
          {LOGO_TEXT}
        </span>

        {/* Protocol filters */}
        <button className={showOspf ? 'active' : ''} onClick={() => setShowOspf(v => !v)}>
          OSPF
        </button>
        <button
          className={showLldp ? 'active' : ''}
          onClick={() => setShowLldp(v => !v)}
          style={showLldp ? { background: 'var(--accent2)', borderColor: 'var(--accent2)' } : {}}
        >
          LLDP
        </button>
        <button
          className={showBgp ? 'active' : ''}
          onClick={() => setShowBgp(v => !v)}
          style={showBgp ? { background: 'var(--bgp)', borderColor: 'var(--bgp)' } : {}}
        >
          BGP
        </button>
        <div style={{ width: 1, height: 20, background: 'var(--border)', margin: '0 4px' }} />

        {/* Layout Modes */}
        <select
          value={layoutMode}
          onChange={e => {
            const mode = e.target.value
            setLayoutMode(mode)
            if (mode === 'image') {
              setMapMode(true)
            } else {
              setMapMode(false)
            }
          }}
          style={{
            background: 'var(--surface2)',
            border: '1px solid var(--border)',
            color: 'var(--text)',
            borderRadius: 6,
            padding: '4px 10px',
            fontSize: 12,
            width: 140,
            cursor: 'pointer',
            outline: 'none',
          }}
        >
          <option value="3d">🌌 3D Motion Topology</option>
          <option value="force">🔗 Network Topology</option>
          <option value="sankey">📊 ISP Link Delay</option>
          <option value="image">🖼 Site Map Image</option>
          <option value="geo">🌐 ISP Topology</option>
          <option value="mpls">🔀 MPLS Map</option>
        </select>

        {/* Link View Mode Toggle */}
        <select
          id="linkViewModeSelect"
          name="linkViewModeSelect"
          value={linkViewMode}
          onChange={e => {
            const val = e.target.value
            setLinkViewMode(val)
            localStorage.setItem('link_view_mode', val)
          }}
          style={{
            background: 'var(--surface2)',
            border: '1px solid var(--border)',
            color: 'var(--text)',
            borderRadius: 6,
            padding: '4px 10px',
            fontSize: 12,
            width: 140,
            cursor: 'pointer',
            outline: 'none',
          }}
        >
          <option value="logical">🔗 Logical Links</option>
          <option value="physical">🔌 Physical Links</option>
        </select>

        {layoutMode === 'image' && (
          <>
            <button onClick={() => fileInputRef.current?.click()} title="Upload background map image">
              ↑ Upload Image
            </button>
            <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleMapUpload} />
            {mapImage && (
              <button className="danger" onClick={() => { setMapImage(null); setLayoutMode('force'); setMapMode(false) }}>
                ✕ Clear Image
              </button>
            )}
          </>
        )}

        {layoutMode === 'geo' && (
          <>
            <select
              value={geoProvider}
              onChange={e => {
                const prov = e.target.value
                setGeoProvider(prov)
                localStorage.setItem('geo_provider', prov)
              }}
              style={{
                background: 'var(--surface2)',
                border: '1px solid var(--border)',
                color: 'var(--text)',
                borderRadius: 6,
                padding: '4px 10px',
                fontSize: 12,
                width: 135,
                cursor: 'pointer',
                outline: 'none',
              }}
            >
              <option value="osm">🛰 OSM (Free)</option>
              <option value="google">🗺 Google Maps</option>
            </select>

            <select
              id="mapThemeSelect"
              name="mapThemeSelect"
              value={mapTheme}
              onChange={e => {
                const val = e.target.value
                setMapTheme(val)
                localStorage.setItem('map_theme', val)
              }}
              style={{
                background: 'var(--surface2)',
                border: '1px solid var(--border)',
                color: 'var(--text)',
                borderRadius: 6,
                padding: '4px 10px',
                fontSize: 12,
                width: 130,
                cursor: 'pointer',
                outline: 'none',
              }}
            >
              <option value="dark">🌑 Dark Theme</option>
              <option value="light">🎨 Normal Color</option>
            </select>
            
            {geoProvider === 'google' && (
              <button
                onClick={() => setShowKeyInput(v => !v)}
                style={googleMapsKey ? { borderColor: 'var(--accent)' } : { color: 'var(--danger)' }}
              >
                ⚙ API Key
              </button>
            )}
          </>
        )}

        {/* Group selector */}
        <select
          value={selectedGroup}
          onChange={e => setSelectedGroup(e.target.value)}
          style={{
            background: 'var(--surface2)',
            border: '1px solid var(--border)',
            color: 'var(--text)',
            borderRadius: 6,
            padding: '4px 10px',
            fontSize: 12,
            width: 150,
            cursor: 'pointer',
            outline: 'none',
          }}
        >
          <option value="All Groups">📁 All Groups</option>
          {topology?.groups?.map(g => (
            <option key={g} value={g}>
              📁 {g}
            </option>
          ))}
        </select>

        <div style={{ width: 1, height: 20, background: 'var(--border)', margin: '0 4px' }} />

        {/* Search */}
        <input
          type="text"
          placeholder="Filter devices…"
          value={filter}
          onChange={e => setFilter(e.target.value)}
          style={{
            background: 'var(--surface2)',
            border: '1px solid var(--border)',
            color: 'var(--text)',
            borderRadius: 6,
            padding: '4px 10px',
            fontSize: 12,
            width: 180,
          }}
        />

        <div style={{ width: 1, height: 20, background: 'var(--border)', margin: '0 4px' }} />

        <button onClick={() => fetchTopology()} disabled={loading}>
          {loading ? '⟳ Loading…' : '⟳ Refresh'}
        </button>
        <button
          className={autoRefresh ? 'active' : ''}
          onClick={() => setAutoRefresh(v => !v)}
          title="Auto-refresh every 60s"
        >
          ⏱ Auto
        </button>
        <button
          className={isFullscreen ? 'active' : ''}
          onClick={toggleFullscreen}
          title="Toggle Fullscreen Mode (Hover top of screen to show toolbar)"
          style={isFullscreen ? { background: 'var(--accent)', borderColor: 'var(--accent)' } : {}}
        >
          {isFullscreen ? '✕ Exit Fullscreen' : '🖥 Fullscreen'}
        </button>

        {/* ── 3D-only controls ───────────────────────────────────────── */}
        {layoutMode === '3d' && (
          <>
            <div style={{ width: 1, height: 20, background: 'var(--border)', margin: '0 4px' }} />
            {/* Node list toggle */}
            <button
              className={showNodeList ? 'active' : ''}
              onClick={() => setShowNodeList(v => !v)}
              title="Node list"
            >☰ Nodes</button>

            {/* Label style selector */}
            <select
              value={labelMode}
              onChange={e => setLabelMode(e.target.value)}
              style={{
                background: 'var(--surface2)', border: '1px solid var(--border)',
                color: 'var(--text)', borderRadius: 6, padding: '4px 10px',
                fontSize: 12, width: 150, cursor: 'pointer', outline: 'none',
              }}
              title="Select label visibility mode"
            >
              <option value="name">🏷 Router Name</option>
              <option value="name_ip">🏷 Name & IP</option>
              <option value="hidden">🏷 Hide Labels</option>
            </select>

            {/* Galaxy theme */}
            <select
              value={galaxyTheme}
              onChange={e => setGalaxyTheme(e.target.value)}
              style={{
                background: 'var(--surface2)', border: '1px solid var(--border)',
                color: 'var(--text)', borderRadius: 6, padding: '4px 10px',
                fontSize: 12, width: 165, cursor: 'pointer', outline: 'none',
              }}
            >
              {Object.entries(GALAXY_THEMES).map(([key, th]) => (
                <option key={key} value={key}>🌌 {th.label}</option>
              ))}
            </select>
          </>
        )}

        {/* Legend */}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 12, alignItems: 'center', fontSize: 11, color: 'var(--text-muted)' }}>
          <span>◈ Spine</span>
          <span>◉ Core</span>
          <span>◇ Leaf</span>
          <span>⬡ VRR/XTC</span>
          <span>□ Other</span>
        </div>
      </div>

      {/* Google Maps API Key Input Overlay */}
      {layoutMode === 'geo' && geoProvider === 'google' && showKeyInput && (
        <div style={{
          background: 'var(--surface)',
          borderBottom: '1px solid var(--border)',
          padding: '8px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          zIndex: 1001,
        }}>
          <span style={{ fontSize: 12, color: 'var(--text)' }}>Google Maps API Key:</span>
          <input
            type="password"
            placeholder="AIzaSy..."
            value={googleMapsKey}
            onChange={e => {
              const val = e.target.value
              setGoogleMapsKey(val)
              localStorage.setItem('google_maps_key', val)
            }}
            style={{
              background: 'var(--surface2)',
              border: '1px solid var(--border)',
              color: 'var(--text)',
              borderRadius: 6,
              padding: '4px 10px',
              fontSize: 12,
              width: 320,
              outline: 'none',
            }}
          />
          <button onClick={() => setShowKeyInput(false)} style={{ padding: '4px 10px', fontSize: 11 }}>
            Save & Close
          </button>
        </div>
      )}

      {/* Stats bar */}
      {topology && (
        <StatsBar
          topology={groupFilteredTopology}
          lastRefresh={lastRefresh}
          statusFilter={statusFilter}
          setStatusFilter={setStatusFilter}
          showOspf={showOspf}
          setShowOspf={setShowOspf}
          showLldp={showLldp}
          setShowLldp={setShowLldp}
          showBgp={showBgp}
          setShowBgp={setShowBgp}
          setFilter={setFilter}
          setSelectedGroup={setSelectedGroup}
        />
      )}

      {/* Error banner */}
      {error && (
        <div style={{ background: '#3d100a', color: 'var(--danger)', padding: '6px 16px', fontSize: 12 }}>
          ⚠ {error} — Is the topology backend running? Check <code>http://localhost:8001/health</code>
        </div>
      )}

      {/* Main area */}
      <div style={mainStyle}>
        {loading && !topology && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>⬡</div>
              <div>Loading topology from NETAct_git healthchecks…</div>
            </div>
          </div>
        )}

        {topology && geoNodes.length > 0 && layoutMode === 'geo' && (
          <GeoTopologyMap
            nodes={geoNodes}
            edges={geoEdges}
            showOspf={showOspf}
            showLldp={showLldp}
            showBgp={showBgp}
            showBgpClouds={showBgpClouds}
            selectedNode={selectedNode}
            onSelectNode={setSelectedNode}
            onNodeMoved={handleGeoNodeMoved}
            onUnplaceNode={handleUnplaceNode}
            provider={geoProvider}
            googleApiKey={googleMapsKey}
            linkViewMode={linkViewMode}
            mapTheme={mapTheme}
            asRegistry={asRegistry}
            onRegistryUpdate={(updated) => {
              setAsRegistry(updated)
              saveBgpRegistry(updated).catch(console.warn)
            }}
          />
        )}

        {topology && threeDNodes.length > 0 && layoutMode === '3d' && (
          <div style={{ display: 'flex', height: '100%', position: 'relative' }}>

            {/* ── Node List Sidebar ─────────────────────────────────── */}
            {showNodeList && (
              <div style={{
                width: 260,
                flexShrink: 0,
                background: 'rgba(2,6,16,0.88)',
                borderRight: '1px solid rgba(79,195,247,0.18)',
                backdropFilter: 'blur(12px)',
                WebkitBackdropFilter: 'blur(12px)',
                display: 'flex',
                flexDirection: 'column',
                zIndex: 5,
                overflowY: 'auto',
              }}>
                <div style={{
                  padding: '10px 14px 6px',
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: 1.5,
                  color: '#4fc3f7',
                  textTransform: 'uppercase',
                  borderBottom: '1px solid rgba(79,195,247,0.15)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}>
                  <span>⬡ HC Nodes ({threeDNodes.length})</span>
                  <button
                    onClick={() => { setSelectedNode(null); setFocusNodeId(null) }}
                    style={{ fontSize: 9, padding: '2px 6px', background: 'transparent', border: '1px solid #4fc3f744', color: '#4fc3f7', borderRadius: 4, cursor: 'pointer' }}
                  >Clear</button>
                </div>
                {threeDNodes.map(n => {
                  const statusColor = {
                    ok: '#00e676', warning: '#ffca28', error: '#ff1744',
                    auth_fail: '#ff1744', unknown: '#546e7a'
                  }[n.status] || '#546e7a'
                  const isSelected = selectedNode === n.id
                  return (
                    <div
                      key={n.id}
                      onClick={() => {
                        setSelectedNode(n.id)
                        setFocusNodeId(n.id + '_' + Date.now()) // unique trigger
                      }}
                      style={{
                        padding: '8px 14px',
                        cursor: 'pointer',
                        borderBottom: '1px solid rgba(255,255,255,0.04)',
                        background: isSelected ? 'rgba(79,195,247,0.12)' : 'transparent',
                        borderLeft: isSelected ? '3px solid #4fc3f7' : '3px solid transparent',
                        transition: 'background 0.15s',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 9,
                      }}
                      onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = 'rgba(255,255,255,0.04)' }}
                      onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = 'transparent' }}
                    >
                      <span style={{ width: 7, height: 7, borderRadius: '50%', background: statusColor, flexShrink: 0, boxShadow: `0 0 5px ${statusColor}` }} />
                      <div style={{ overflow: 'hidden' }}>
                        <div style={{ fontSize: 11, fontWeight: 600, color: isSelected ? '#4fc3f7' : '#cde8f8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontFamily: 'Courier New, monospace', letterSpacing: 0.3 }}>
                          {n.label}
                        </div>
                        {n.ip && (
                          <div style={{ fontSize: 9, color: '#4a6a80', marginTop: 1, fontFamily: 'Courier New, monospace' }}>{n.ip}</div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {/* ── 3D Canvas ─────────────────────────────────────────── */}
            <div style={{ flex: 1, position: 'relative' }}>
              <Topology3D
                nodes={threeDNodes}
                edges={threeDEdges}
                showOspf={showOspf}
                showLldp={showLldp}
                showBgp={showBgp}
                selectedNode={selectedNode}
                onSelectNode={setSelectedNode}
                onNodeMoved={handleNodeMoved}
                linkViewMode={linkViewMode}
                galaxyTheme={galaxyTheme}
                labelMode={labelMode}
                focusNodeId={focusNodeId}
              />
            </div>
          </div>
        )}

        {topology && filteredNodes.length > 0 && layoutMode === 'sankey' && (
          <TopologySankey
            nodes={filteredNodes}
            edges={filteredEdges}
            ospfPingTimestamp={topology?.ospf_ping_timestamp}
            onRefreshTopology={fetchTopology}
            ospfTimeRange={ospfTimeRange}
            setOspfTimeRange={setOspfTimeRange}
            customStart={customStart}
            setCustomStart={setCustomStart}
            customEnd={customEnd}
            setCustomEnd={setCustomEnd}
          />
        )}

        {layoutMode === 'mpls' && (
          <div style={{ position: 'absolute', inset: 0 }}>
            <MplsTopologyMap filter={filter} />
          </div>
        )}

        {topology && filteredNodes.length > 0 && layoutMode !== 'geo' && layoutMode !== '3d' && layoutMode !== 'sankey' && layoutMode !== 'mpls' && (
          <TopologyGraph
            nodes={filteredNodes}
            edges={filteredEdges}
            showOspf={showOspf}
            showLldp={showLldp}
            showBgp={showBgp}
            selectedNode={selectedNode}
            onSelectNode={setSelectedNode}
            onNodeMoved={handleNodeMoved}
            mapMode={layoutMode === 'image'}
            mapImage={mapImage}
            linkViewMode={linkViewMode}
          />
        )}

        {topology && filteredNodes.length === 0 && !loading && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
            {filter ? `No devices matching "${filter}"` : 'No healthcheck data found in NETAct_git. Run a healthcheck first.'}
          </div>
        )}

        {/* Healthcheck panel */}
        <HealthcheckPanel
          deviceName={selectedNode}
          onClose={() => setSelectedNode(null)}
          isPlaced={!!(topology?.nodes?.find(n => n.id === selectedNode) && (topology.nodes.find(n => n.id === selectedNode).latitude != null || topology.nodes.find(n => n.id === selectedNode).x != null))}
          onUnplaceNode={handleUnplaceNode}
        />

        {/* Tip overlay */}
        {topology && filteredNodes.length > 0 && !selectedNode && (
          <div style={{
            position: 'absolute',
            bottom: 16,
            left: 16,
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: '8px 12px',
            fontSize: 11,
            color: 'var(--text-muted)',
            pointerEvents: 'none',
          }}>
            {layoutMode === 'geo'
              ? 'ISP Topology · Click a node to inspect healthcheck · Drag markers to relocate · Scroll to zoom'
              : 'Click a node to inspect healthcheck · Drag to pin location · Scroll to zoom · Upload a map image to place routers on it'
            }
          </div>
        )}
      </div>
    </div>
  )
}
