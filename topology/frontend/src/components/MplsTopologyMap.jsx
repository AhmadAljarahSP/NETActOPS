/**
 * MplsTopologyMap — geographic Leaflet map with OSPF/TE overlay
 *
 * Fixes vs previous version:
 *  - /coords returns array now → coords persist across refresh
 *  - filter prop wires to device/router-id search
 *  - Single collapsible right sidebar (Path + Tunnels + Nodes)
 *  - Place button drops node at map center; drag to reposition (saves on dragend)
 *  - Right-click marker to unplace
 */
import React, {
  useEffect, useState, useRef, useMemo, useCallback,
} from 'react'
import {
  getOspfTopology, getSpfPath, getTePaths,
  getCoords, saveCoordGeo, deleteCoord,
} from '../hooks/useApi'

const TUNNEL_COLORS = [
  '#58a6ff','#3fb950','#d859ff','#f0a500',
  '#f85149','#79c0ff','#7ee787','#ffa657',
]

const loadLeaflet = () =>
  new Promise((resolve, reject) => {
    if (window.L) { resolve(window.L); return }
    if (!document.getElementById('leaflet-css')) {
      const link = document.createElement('link')
      link.rel = 'stylesheet'
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
      link.id = 'leaflet-css'
      document.head.appendChild(link)
    }
    if (!document.getElementById('leaflet-js')) {
      const script = document.createElement('script')
      script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
      script.id = 'leaflet-js'
      script.onload = () => resolve(window.L)
      script.onerror = reject
      document.body.appendChild(script)
    } else {
      const t = setInterval(() => { if (window.L) { clearInterval(t); resolve(window.L) } }, 100)
    }
  })

// Stable key for /coords: managed devices use device_name, others use router_id
const nodeKey = (meta, rid) => meta?.device_name || rid

const routerSVG = (color, sel) => `
<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="cg${color.replace('#','')}" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#090d13"/>
      <stop offset="35%" stop-color="#161b22"/>
      <stop offset="70%" stop-color="#090d13"/>
    </linearGradient>
  </defs>
  <path d="M4,11 A12,6 0 0,0 28,11 L28,21 A12,6 0 0,1 4,21 Z"
    fill="url(#cg${color.replace('#','')})" stroke="${color}" stroke-width="${sel?2.5:1.2}"/>
  <ellipse cx="16" cy="11" rx="12" ry="6"
    fill="#161b22" stroke="${color}" stroke-width="${sel?2.5:1.2}"/>
  <text x="16" y="9.5" text-anchor="middle" dominant-baseline="central"
    font-size="7" font-weight="900" font-family="sans-serif" fill="${color}">C</text>
</svg>`

// ── Shared styles ────────────────────────────────────────────────────────────
const S = {
  panel: {
    background: 'rgba(13,17,23,0.96)',
    border: '1px solid #30363d', borderRadius: 10,
    backdropFilter: 'blur(14px)',
    boxShadow: '0 6px 28px rgba(0,0,0,0.65)',
    color: '#e6edf3', fontFamily: 'sans-serif',
    fontSize: 11,
  },
  btn: { cursor:'pointer', border:'none', borderRadius:6, fontWeight:700, fontSize:10 },
  sel: {
    width:'100%', padding:'5px 7px', fontSize:10,
    background:'rgba(255,255,255,0.05)', border:'1px solid #30363d',
    color:'#e6edf3', borderRadius:6, outline:'none', cursor:'pointer',
  },
  tab: (active) => ({
    flex:1, padding:'8px 0', fontSize:10, fontWeight:700, cursor:'pointer',
    background: active ? 'rgba(88,166,255,0.1)' : 'transparent', border:'none',
    borderBottom: active ? '2px solid #58a6ff' : '2px solid transparent',
    color: active ? '#58a6ff' : '#6e7681',
  }),
}

export default function MplsTopologyMap({ filter = '' }) {
  const mapContainerRef = useRef(null)
  const mapRef          = useRef(null)
  const markersRef      = useRef({})
  const ospfLinesRef    = useRef([])
  const pathLinesRef    = useRef([])
  const tunnelLinesRef  = useRef([])

  const [mapReady,     setMapReady]     = useState(false)
  const [ospfData,     setOspfData]     = useState(null)
  const [teTunnels,    setTeTunnels]    = useState([])
  const [rsvpSessions, setRsvpSessions] = useState([])
  const [coordsMap,    setCoordsMap]    = useState({})
  const [loading,      setLoading]      = useState(true)
  const [lastFetch,    setLastFetch]    = useState(null)

  // Sidebar
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [panelTab,    setPanelTab]    = useState('nodes')   // 'nodes' | 'path' | 'tunnels'

  // Path
  const [pathSrc,     setPathSrc]     = useState('')
  const [pathDst,     setPathDst]     = useState('')
  const [pathResult,  setPathResult]  = useState(null)
  const [pathLoading, setPathLoading] = useState(false)
  const [pathError,   setPathError]   = useState(null)

  // Tunnels
  const [showTunnels,    setShowTunnels]    = useState(true)
  const [selectedTunnel, setSelectedTunnel] = useState(null)

  // Node selection
  const [selectedRid, setSelectedRid] = useState(null)

  // ── Fetch ──────────────────────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const [topo, te, coords] = await Promise.all([
        getOspfTopology(), getTePaths(), getCoords(),
      ])
      setOspfData(topo)
      setTeTunnels(te.tunnels || [])
      setRsvpSessions(te.rsvp_sessions || [])

      // /coords now returns [{device, latitude, longitude, x, y}, ...]
      const cm = {}
      ;(Array.isArray(coords) ? coords : Object.entries(coords).map(([device, v]) => ({ device, ...v })))
        .forEach(c => {
          if (c.latitude != null && c.longitude != null) {
            cm[c.device] = { lat: c.latitude, lng: c.longitude }
          }
        })
      setCoordsMap(cm)
      setLastFetch(new Date())
    } catch (e) {
      console.error('MplsTopologyMap fetch', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  // ── Derived: filter by search text ────────────────────────────────────────
  const nodeIds = useMemo(() => {
    const all = Object.keys(ospfData?.nodes || {})
    if (!filter) return all
    const q = filter.toLowerCase()
    return all.filter(rid => {
      const name = ospfData.nodes[rid]?.device_name || ''
      return rid.includes(q) || name.toLowerCase().includes(q)
    })
  }, [ospfData, filter])

  const getLatLng = useCallback((rid) => {
    const k = nodeKey(ospfData?.nodes?.[rid], rid)
    return coordsMap[k] || null
  }, [ospfData, coordsMap])

  const placedIds = useMemo(() =>
    nodeIds.filter(rid => !!getLatLng(rid)), [nodeIds, getLatLng])

  const unplacedIds = useMemo(() =>
    nodeIds.filter(rid => !getLatLng(rid)), [nodeIds, getLatLng])

  const pathNodeSet = useMemo(() => new Set(pathResult?.path || []), [pathResult])

  // ── Init Leaflet ───────────────────────────────────────────────────────────
  useEffect(() => {
    loadLeaflet().then(L => {
      if (mapRef.current || !mapContainerRef.current) return
      const map = L.map(mapContainerRef.current, { attributionControl: false }).setView([25, 55], 6)
      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { maxZoom: 19 }).addTo(map)
      mapRef.current = map
      setMapReady(true)
    }).catch(console.error)
    return () => { if (mapRef.current) { mapRef.current.remove(); mapRef.current = null } }
  }, [])

  // ── Draw OSPF links ────────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current; if (!map || !mapReady || !ospfData) return
    const L = window.L
    ospfLinesRef.current.forEach(l => l.remove()); ospfLinesRef.current = []
    ;(ospfData.links || []).forEach(lnk => {
      const a = getLatLng(lnk.source), b = getLatLng(lnk.target)
      if (!a || !b) return
      const teInfo = (ospfData.te_links || []).find(
        tl => (tl.source === lnk.source && tl.neighbor === lnk.target) ||
              (tl.source === lnk.target && tl.neighbor === lnk.source))
      const w = Math.max(1, Math.min(5, 8 - Math.log10((lnk.cost || 1) + 1) * 2))
      const line = L.polyline([[a.lat,a.lng],[b.lat,b.lng]], {
        color: teInfo ? '#58a6ff' : '#6e7681', weight: w, opacity: 0.55,
      }).addTo(map)
      line.bindTooltip(
        `OSPF: ${lnk.source} ↔ ${lnk.target}<br>Cost: ${lnk.cost}${teInfo?`<br>TE: ${teInfo.te_metric||'N/A'}`:''}`,
        { sticky:true, className:'mpls-tt' })
      ospfLinesRef.current.push(line)
    })
  }, [mapReady, ospfData, coordsMap, getLatLng])

  // ── Draw SPF path ──────────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current; if (!map || !mapReady) return
    const L = window.L
    pathLinesRef.current.forEach(l => l.remove()); pathLinesRef.current = []
    if (!pathResult?.path) return
    const pts = pathResult.path.map(rid => getLatLng(rid)).filter(Boolean).map(ll => [ll.lat,ll.lng])
    if (pts.length >= 2) {
      pathLinesRef.current.push(
        L.polyline(pts, { color:'#f0a500', weight:4, opacity:0.9, dashArray:'12 6' }).addTo(map))
    }
  }, [mapReady, pathResult, coordsMap, getLatLng])

  // ── Draw tunnel overlays ───────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current; if (!map || !mapReady) return
    const L = window.L
    tunnelLinesRef.current.forEach(l => l.remove()); tunnelLinesRef.current = []
    if (!showTunnels) return

    teTunnels.forEach((t, idx) => {
      const color = TUNNEL_COLORS[idx % TUNNEL_COLORS.length]
      const pts = (t.hops||[]).map(ip => getLatLng(ip)).filter(Boolean).map(ll => [ll.lat,ll.lng])
      if (pts.length < 2) return
      const isActive = selectedTunnel === t.name
      const line = L.polyline(pts, { color, weight:isActive?4:2.5, opacity:isActive?1:0.7,
        dashArray:t.oper!=='up'?'8 4':undefined }).addTo(map)
      line.bindTooltip(`<b>${t.name}</b><br>${t.source||'?'} → ${t.dest}<br>${t.oper||'?'}`,
        { sticky:true, className:'mpls-tt' })
      tunnelLinesRef.current.push(line)
    })

    rsvpSessions.forEach((s, idx) => {
      const key = `${s.source}|${s.dest}|${s.tunnel_id}`
      const color = TUNNEL_COLORS[(teTunnels.length + idx) % TUNNEL_COLORS.length]
      const src = getLatLng(s.source), dst = getLatLng(s.dest)
      if (!src || !dst) return
      const isActive = selectedTunnel === key
      const line = L.polyline([[src.lat,src.lng],[dst.lat,dst.lng]], {
        color, weight:isActive?3:1.5, opacity:isActive?0.9:0.45, dashArray:'4 6',
      }).addTo(map)
      line.bindTooltip(`<b>RSVP Tun ${s.tunnel_id}</b><br>${s.source} → ${s.dest}<br>${s.state||'?'}`,
        { sticky:true, className:'mpls-tt' })
      tunnelLinesRef.current.push(line)
    })
  }, [mapReady, teTunnels, rsvpSessions, showTunnels, selectedTunnel, coordsMap, getLatLng])

  // ── Draw / refresh markers ─────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current; if (!map || !mapReady || !ospfData) return
    const L = window.L

    // Remove markers for now-unplaced nodes
    Object.keys(markersRef.current).forEach(rid => {
      if (!getLatLng(rid)) { markersRef.current[rid].remove(); delete markersRef.current[rid] }
    })

    placedIds.forEach(rid => {
      const ll   = getLatLng(rid); if (!ll) return
      const meta = ospfData.nodes?.[rid] || {}
      const isSel    = selectedRid === rid
      const isOnPath = pathNodeSet.has(rid)
      const color = isOnPath ? '#f0a500' : isSel ? '#58a6ff' : '#3fb950'
      const label = meta.device_name || rid

      const icon = L.divIcon({
        className: '',
        html: `<div style="position:relative;width:32px;height:32px;cursor:pointer">
          ${routerSVG(color, isSel)}
          <div style="position:absolute;top:34px;left:50%;transform:translateX(-50%);
            white-space:nowrap;font-size:10px;font-weight:700;color:${color};
            text-shadow:0 0 4px #000,0 0 8px #000;pointer-events:none;font-family:sans-serif">
            ${label.length > 22 ? label.slice(0,20)+'…' : label}
          </div>
          ${meta.device_name ? '' : ''}
        </div>`,
        iconAnchor: [16, 16],
      })

      if (markersRef.current[rid]) {
        markersRef.current[rid].setLatLng([ll.lat, ll.lng]).setIcon(icon)
      } else {
        const m = L.marker([ll.lat, ll.lng], { icon, draggable: true }).addTo(map)
        m.on('click', e => { e.originalEvent?.stopPropagation?.()
          setSelectedRid(prev => prev === rid ? null : rid) })
        m.on('contextmenu', e => { e.originalEvent?.preventDefault?.(); handleUnplace(rid) })
        m.on('dragend', async e => {
          const { lat, lng } = e.target.getLatLng()
          const key = nodeKey(ospfData?.nodes?.[rid], rid)
          try {
            await saveCoordGeo(key, lat, lng)
            setCoordsMap(prev => ({ ...prev, [key]: { lat, lng } }))
          } catch (err) { console.error('Drag save', err) }
        })
        markersRef.current[rid] = m
      }
    })
  }, [mapReady, ospfData, placedIds, coordsMap, selectedRid, pathNodeSet, getLatLng])

  // ── Actions ────────────────────────────────────────────────────────────────
  const handlePlace = useCallback(async (rid) => {
    const map = mapRef.current; if (!map) return
    const c = map.getCenter()
    const lat = c.lat + (Math.random() - 0.5) * 0.4
    const lng = c.lng + (Math.random() - 0.5) * 0.4
    const key = nodeKey(ospfData?.nodes?.[rid], rid)
    try {
      await saveCoordGeo(key, lat, lng)
      setCoordsMap(prev => ({ ...prev, [key]: { lat, lng } }))
    } catch (e) { console.error('Place', e) }
  }, [ospfData])

  const handleUnplace = useCallback(async (rid) => {
    const key = nodeKey(ospfData?.nodes?.[rid], rid)
    try {
      await deleteCoord(key)
      setCoordsMap(prev => { const n={...prev}; delete n[key]; return n })
      if (markersRef.current[rid]) { markersRef.current[rid].remove(); delete markersRef.current[rid] }
      setSelectedRid(prev => prev === rid ? null : prev)
    } catch (e) { console.error('Unplace', e) }
  }, [ospfData])

  const handleCalculatePath = useCallback(async () => {
    if (!pathSrc || !pathDst) return
    setPathLoading(true); setPathError(null); setPathResult(null)
    try {
      const r = await getSpfPath(pathSrc, pathDst)
      setPathResult(r)
      const pts = (r.path||[]).map(rid => getLatLng(rid)).filter(Boolean)
      if (pts.length >= 2 && mapRef.current)
        mapRef.current.fitBounds(pts.map(ll => [ll.lat,ll.lng]), { padding:[50,50] })
    } catch (e) { setPathError(e?.response?.data?.detail || e?.message || 'Path not found') }
    finally { setPathLoading(false) }
  }, [pathSrc, pathDst, getLatLng])

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ position:'relative', width:'100%', height:'100%', background:'#0d1117' }}>

      <div ref={mapContainerRef} style={{ position:'absolute', inset:0, zIndex:0 }} />

      <style>{`
        .mpls-tt { background:rgba(13,17,23,0.93)!important; border:1px solid #30363d!important;
          color:#e6edf3!important; font-size:11px!important; border-radius:6px!important;
          box-shadow:0 4px 14px rgba(0,0,0,0.5)!important; }
        .mpls-tt::before { display:none!important; }
      `}</style>

      {loading && (
        <div style={{ position:'absolute',inset:0,zIndex:1100,display:'flex',
          alignItems:'center',justifyContent:'center',background:'rgba(13,17,23,0.7)' }}>
          <span style={{ color:'#58a6ff',fontSize:13 }}>Loading OSPF topology…</span>
        </div>
      )}

      {/* ── Sidebar toggle button (always visible) ── */}
      <button onClick={() => setSidebarOpen(v => !v)} style={{
        position:'absolute', top:12, right: sidebarOpen ? 292 : 12,
        zIndex:1100, width:28, height:28,
        ...S.btn, background:'rgba(13,17,23,0.9)', border:'1px solid #30363d',
        color:'#6e7681', display:'flex', alignItems:'center', justifyContent:'center',
        transition:'right 0.25s',
      }}>
        {sidebarOpen ? '›' : '‹'}
      </button>

      {/* ── Right sidebar ── */}
      <div style={{
        ...S.panel,
        position:'absolute', top:0, right:0, bottom:0, width:280, zIndex:1000,
        display:'flex', flexDirection:'column',
        transform: sidebarOpen ? 'translateX(0)' : 'translateX(100%)',
        transition: 'transform 0.25s ease',
        borderRadius:'0 0 0 0', borderRight:'none', borderTop:'none', borderBottom:'none',
      }}>
        {/* Tabs */}
        <div style={{ display:'flex', borderBottom:'1px solid #21262d', flexShrink:0, paddingTop:4 }}>
          {[['nodes','📋 Nodes'],['path','🛣 Path'],['tunnels','🚇 Tunnels']].map(([tab,lbl]) => (
            <button key={tab} onClick={() => setPanelTab(tab)} style={S.tab(panelTab===tab)}>{lbl}</button>
          ))}
        </div>

        <div style={{ flex:1, overflowY:'auto', padding:'10px 12px' }}>

          {/* ══ NODES TAB ══════════════════════════════════════════════════ */}
          {panelTab === 'nodes' && (
            <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
              {/* Stats row */}
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:4, marginBottom:6 }}>
                {[['Total', nodeIds.length,'#6e7681'],['Placed', placedIds.length,'#3fb950'],['Unplaced', unplacedIds.length,'#f0a500']].map(([l,v,c]) => (
                  <div key={l} style={{ textAlign:'center', padding:'5px 0', background:'rgba(255,255,255,0.03)',
                    border:'1px solid #21262d', borderRadius:6 }}>
                    <div style={{ fontSize:16, fontWeight:700, color:c }}>{v}</div>
                    <div style={{ fontSize:8, color:'#6e7681' }}>{l}</div>
                  </div>
                ))}
              </div>

              {filter && (
                <div style={{ fontSize:9, color:'#6e7681', marginBottom:4 }}>
                  Filtered: "{filter}" — {nodeIds.length} match
                </div>
              )}

              {/* Placed section */}
              {placedIds.length > 0 && (
                <>
                  <div style={{ fontSize:9, color:'#3fb950', fontWeight:700, textTransform:'uppercase',
                    letterSpacing:'0.05em', marginTop:4, marginBottom:2 }}>
                    Placed ({placedIds.length})
                  </div>
                  {placedIds.map(rid => {
                    const meta  = ospfData?.nodes?.[rid]
                    const label = meta?.device_name || rid
                    const isSel = selectedRid === rid
                    return (
                      <div key={rid}
                        onClick={() => setSelectedRid(prev => prev===rid?null:rid)}
                        style={{ padding:'5px 8px', borderRadius:6, cursor:'pointer',
                          background: isSel ? 'rgba(88,166,255,0.1)' : 'rgba(255,255,255,0.02)',
                          border:`1px solid ${isSel?'rgba(88,166,255,0.4)':'#21262d'}`,
                          display:'flex', alignItems:'center', gap:6, marginBottom:1 }}>
                        <span style={{ width:7,height:7,borderRadius:'50%',background:'#3fb950',flexShrink:0 }}/>
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ fontSize:10, color:'#e6edf3', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{label}</div>
                          {meta?.device_name && <div style={{ fontSize:8, color:'#6e7681', fontFamily:'monospace' }}>{rid}</div>}
                        </div>
                        <button onClick={e => { e.stopPropagation(); handleUnplace(rid) }}
                          style={{ ...S.btn, fontSize:8, padding:'1px 6px',
                            background:'rgba(248,81,73,0.1)', border:'1px solid rgba(248,81,73,0.3)', color:'#f85149' }}>
                          ✕
                        </button>
                      </div>
                    )
                  })}
                </>
              )}

              {/* Unplaced section */}
              {unplacedIds.length > 0 && (
                <>
                  <div style={{ fontSize:9, color:'#f0a500', fontWeight:700, textTransform:'uppercase',
                    letterSpacing:'0.05em', marginTop:8, marginBottom:2 }}>
                    Unplaced ({unplacedIds.length})
                  </div>
                  {unplacedIds.map(rid => {
                    const meta  = ospfData?.nodes?.[rid]
                    const label = meta?.device_name || rid
                    return (
                      <div key={rid} style={{ padding:'5px 8px', borderRadius:6,
                        background:'rgba(255,255,255,0.02)', border:'1px solid #21262d',
                        display:'flex', alignItems:'center', gap:6, marginBottom:1 }}>
                        <span style={{ width:7,height:7,borderRadius:'50%',background:'#f0a500',opacity:0.4,flexShrink:0 }}/>
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ fontSize:10, color:'#6e7681', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{label}</div>
                          {meta?.device_name && <div style={{ fontSize:8, color:'#484f58', fontFamily:'monospace' }}>{rid}</div>}
                        </div>
                        <button onClick={() => handlePlace(rid)}
                          style={{ ...S.btn, fontSize:8, padding:'1px 6px',
                            background:'rgba(88,166,255,0.1)', border:'1px solid rgba(88,166,255,0.3)', color:'#58a6ff' }}>
                          Place
                        </button>
                      </div>
                    )
                  })}
                </>
              )}
            </div>
          )}

          {/* ══ PATH TAB ═══════════════════════════════════════════════════ */}
          {panelTab === 'path' && (
            <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
              <div style={{ fontSize:10, color:'#f0a500', fontWeight:700 }}>SPF Path Calculator</div>

              <select value={pathSrc} style={S.sel}
                onChange={e => { setPathSrc(e.target.value); setPathResult(null) }}>
                <option value="">Source router…</option>
                {nodeIds.map(rid => {
                  const n = ospfData?.nodes?.[rid]
                  return <option key={rid} value={rid}>
                    {getLatLng(rid)?'📍':'○'} {n?.device_name?`${n.device_name} (${rid})`:rid}
                  </option>
                })}
              </select>

              <select value={pathDst} style={S.sel}
                onChange={e => { setPathDst(e.target.value); setPathResult(null) }}>
                <option value="">Destination router…</option>
                {nodeIds.filter(id => id!==pathSrc).map(rid => {
                  const n = ospfData?.nodes?.[rid]
                  return <option key={rid} value={rid}>
                    {getLatLng(rid)?'📍':'○'} {n?.device_name?`${n.device_name} (${rid})`:rid}
                  </option>
                })}
              </select>

              <div style={{ display:'flex', gap:6 }}>
                <button onClick={handleCalculatePath}
                  disabled={!pathSrc||!pathDst||pathLoading}
                  style={{ ...S.btn, flex:1, padding:'6px 0',
                    background:'rgba(240,165,0,0.15)', border:'1px solid rgba(240,165,0,0.5)',
                    color:'#f0a500', opacity:(!pathSrc||!pathDst||pathLoading)?0.5:1 }}>
                  {pathLoading?'Calculating…':'Calculate'}
                </button>
                {pathResult && (
                  <button onClick={() => { setPathResult(null); setPathError(null) }}
                    style={{ ...S.btn, padding:'6px 10px', background:'transparent', border:'1px solid #30363d', color:'#6e7681' }}>✕</button>
                )}
              </div>

              {pathError && (
                <div style={{ fontSize:10, color:'#f85149', background:'rgba(248,81,73,0.1)', borderRadius:6, padding:'6px 8px' }}>{pathError}</div>
              )}

              {pathResult && (
                <div style={{ background:'rgba(240,165,0,0.07)', border:'1px solid rgba(240,165,0,0.25)', borderRadius:8, padding:'8px 10px' }}>
                  <div style={{ fontSize:10, color:'#f0a500', fontWeight:700, marginBottom:6 }}>
                    {pathResult.hops} hop{pathResult.hops!==1?'s':''} · cost {pathResult.total_cost}
                  </div>
                  {pathResult.path.map((rid, i) => {
                    const meta = ospfData?.nodes?.[rid]
                    return (
                      <div key={rid} style={{ display:'flex', gap:6, marginBottom:3, alignItems:'flex-start' }}>
                        <div style={{ display:'flex', flexDirection:'column', alignItems:'center', flexShrink:0, marginTop:2 }}>
                          <div style={{ width:7,height:7,borderRadius:'50%',background:'#f0a500' }}/>
                          {i<pathResult.path.length-1 && <div style={{ width:1,height:14,background:'rgba(240,165,0,0.3)',margin:'2px 0' }}/>}
                        </div>
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ fontSize:10, color:'#e6edf3', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                            {meta?.device_name || rid}
                          </div>
                          {meta?.device_name && <div style={{ fontSize:8, color:'#6e7681', fontFamily:'monospace' }}>{rid}</div>}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              {selectedRid && (
                <div style={{ borderTop:'1px solid #21262d', paddingTop:8 }}>
                  <div style={{ fontSize:9, color:'#6e7681', marginBottom:4 }}>Selected node:</div>
                  <div style={{ fontSize:10, color:'#e6edf3' }}>{ospfData?.nodes?.[selectedRid]?.device_name || selectedRid}</div>
                  <div style={{ display:'flex', gap:4, marginTop:6 }}>
                    <button onClick={() => { setPathSrc(selectedRid); setPathResult(null) }}
                      style={{ ...S.btn, flex:1, padding:'3px 0', fontSize:9,
                        background:'rgba(240,165,0,0.1)', border:'1px solid rgba(240,165,0,0.3)', color:'#f0a500' }}>
                      Set Source
                    </button>
                    <button onClick={() => { setPathDst(selectedRid); setPathResult(null) }}
                      style={{ ...S.btn, flex:1, padding:'3px 0', fontSize:9,
                        background:'rgba(88,166,255,0.1)', border:'1px solid rgba(88,166,255,0.3)', color:'#58a6ff' }}>
                      Set Dest
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ══ TUNNELS TAB ════════════════════════════════════════════════ */}
          {panelTab === 'tunnels' && (
            <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:2 }}>
                <span style={{ fontSize:10, color:'#6e7681' }}>
                  {teTunnels.length} head-end · {rsvpSessions.length} transit
                </span>
                <button onClick={() => setShowTunnels(v => !v)} style={{
                  ...S.btn, fontSize:9, padding:'2px 8px',
                  border:`1px solid ${showTunnels?'rgba(88,166,255,0.5)':'#30363d'}`,
                  background:showTunnels?'rgba(88,166,255,0.15)':'transparent',
                  color:showTunnels?'#58a6ff':'#6e7681',
                }}>{showTunnels?'Hide':'Show'}</button>
              </div>

              {teTunnels.length === 0 && rsvpSessions.length === 0 && (
                <div style={{ fontSize:10, color:'#6e7681', textAlign:'center', padding:'14px 0' }}>
                  No active TE tunnels or RSVP sessions
                </div>
              )}

              {teTunnels.length > 0 && (
                <div style={{ fontSize:9,color:'#6e7681',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.05em',marginTop:4,marginBottom:2 }}>
                  Head-end tunnels
                </div>
              )}
              {teTunnels.map((t, idx) => {
                const color = TUNNEL_COLORS[idx % TUNNEL_COLORS.length]
                const isActive = selectedTunnel === t.name
                return (
                  <div key={t.name} onClick={() => setSelectedTunnel(prev => prev===t.name?null:t.name)}
                    style={{ padding:'6px 8px', borderRadius:7, cursor:'pointer',
                      background:isActive?`${color}18`:'rgba(255,255,255,0.02)',
                      border:`1px solid ${isActive?color+'55':'#21262d'}` }}>
                    <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                      <span style={{ width:8,height:8,borderRadius:2,background:color,flexShrink:0 }}/>
                      <span style={{ fontSize:10,color:'#e6edf3',flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' }}>{t.name}</span>
                      <span style={{ fontSize:8,padding:'1px 5px',borderRadius:3,fontWeight:700,
                        background:t.oper==='up'?'rgba(63,185,80,0.15)':'rgba(248,81,73,0.15)',
                        color:t.oper==='up'?'#3fb950':'#f85149' }}>{t.oper||'?'}</span>
                    </div>
                    {isActive && (
                      <div style={{ marginTop:5,paddingLeft:14,fontSize:9,color:'#6e7681',display:'flex',flexDirection:'column',gap:2 }}>
                        <div><span style={{color:'#e6edf3'}}>Src:</span> {t.source||'?'} → <span style={{color:'#e6edf3'}}>Dst:</span> {t.dest}</div>
                        <div><span style={{color:'#e6edf3'}}>BW:</span> {t.bw_kbps?`${t.bw_kbps} kbps`:'?'}</div>
                        <div style={{fontFamily:'monospace',fontSize:8,lineHeight:1.6}}>{(t.hops||[]).join(' → ')||'N/A'}</div>
                      </div>
                    )}
                  </div>
                )
              })}

              {rsvpSessions.length > 0 && (
                <div style={{ fontSize:9,color:'#6e7681',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.05em',marginTop:6,marginBottom:2 }}>
                  RSVP transit sessions
                </div>
              )}
              {rsvpSessions.map((s, idx) => {
                const key = `${s.source}|${s.dest}|${s.tunnel_id}`
                const color = TUNNEL_COLORS[(teTunnels.length+idx) % TUNNEL_COLORS.length]
                const isActive = selectedTunnel === key
                return (
                  <div key={key} onClick={() => setSelectedTunnel(prev => prev===key?null:key)}
                    style={{ padding:'6px 8px', borderRadius:7, cursor:'pointer',
                      background:isActive?`${color}18`:'rgba(255,255,255,0.02)',
                      border:`1px solid ${isActive?color+'55':'#21262d'}` }}>
                    <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                      <span style={{ width:8,height:8,borderRadius:2,background:color,flexShrink:0,
                        opacity:0.7,backgroundImage:'repeating-linear-gradient(45deg,transparent,transparent 2px,rgba(0,0,0,0.4) 2px,rgba(0,0,0,0.4) 4px)' }}/>
                      <span style={{ fontSize:10,color:'#e6edf3',flex:1,fontFamily:'monospace' }}>Tun {s.tunnel_id}</span>
                      <span style={{ fontSize:8,padding:'1px 5px',borderRadius:3,fontWeight:700,
                        background:s.state?.toLowerCase()==='up'?'rgba(63,185,80,0.15)':'rgba(248,81,73,0.15)',
                        color:s.state?.toLowerCase()==='up'?'#3fb950':'#f85149' }}>{s.state||'?'}</span>
                    </div>
                    {isActive && (
                      <div style={{ marginTop:5,paddingLeft:14,fontSize:9,color:'#6e7681',display:'flex',flexDirection:'column',gap:2 }}>
                        <div><span style={{color:'#e6edf3'}}>Head-end:</span> {s.source}</div>
                        <div><span style={{color:'#e6edf3'}}>Tail-end:</span> {s.dest}</div>
                        <div><span style={{color:'#e6edf3'}}>Out intf:</span> {s.output_intf||'?'}</div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding:'6px 12px', borderTop:'1px solid #21262d', display:'flex',
          justifyContent:'space-between', alignItems:'center', flexShrink:0 }}>
          <span style={{ fontSize:9, color:'#6e7681' }}>{lastFetch?.toLocaleTimeString()||''}</span>
          <button onClick={fetchData} style={{ ...S.btn, padding:'3px 8px', fontSize:9,
            background:'transparent', border:'1px solid #30363d', color:'#6e7681' }}>
            ⟳ Refresh
          </button>
        </div>
      </div>

      {/* Hint */}
      <div style={{ position:'absolute',bottom:10,left:'50%',transform:'translateX(-50%)',
        fontSize:9,color:'rgba(255,255,255,0.18)',pointerEvents:'none',userSelect:'none',whiteSpace:'nowrap' }}>
        Place → drops at center · Drag to reposition · Right-click to unplace · Blue = TE link · Orange = SPF path
      </div>
    </div>
  )
}
