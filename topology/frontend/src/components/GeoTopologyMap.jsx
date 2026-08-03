import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react'
import { getSpfPath, getTePaths } from '../hooks/useApi'

const STATUS_COLOR = {
  ok:        '#3fb950',
  warning:   '#d29922',
  error:     '#f85149',
  auth_fail: '#f85149',
  unknown:   '#6e7681',
}

const PROTOCOL_COLOR = {
  ospf:    '#58a6ff',
  lldp:    '#3fb950',
  bgp:     '#d859ff',
  unknown: '#6e7681',
}

const getBrandLetter = (vendor) => {
  const v = (vendor || 'cisco').toLowerCase()
  return v.includes('huawei') ? 'H' : 'C'
}

const checkIfSwitch = (deviceType, label) => {
  const t = (deviceType || '').toLowerCase()
  const lbl = (label || '').toLowerCase()
  return t.includes('switch') || t.includes('sw') || lbl.includes('switch') || lbl.includes('tor') || lbl.includes('eor') || lbl.includes('leaf') || lbl.includes('spine')
}

const getDeviceSymbol = (vendor, deviceType, label) => {
  const isSwitch = checkIfSwitch(deviceType, label)
  const brand = getBrandLetter(vendor)
  return brand === 'H' ? (isSwitch ? 'ⒽS' : 'ⒽR') : (isSwitch ? 'ⒸS' : 'ⒸR')
}

// Unified SVG markup generator for 3D-apparent isometric map markers
const getDeviceSVGMarkup = (vendor, deviceType, label, statusColor, isSelected, size = 32) => {
  const brand = getBrandLetter(vendor)
  const isSwitch = checkIfSwitch(deviceType, label)
  const color = statusColor
  const cleanColor = color.replace('#', '')

  if (isSwitch) {
    return `
      <svg width="${size}" height="${size}" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
        <!-- Top Face -->
        <polygon points="16,4 28,10 16,16 4,10" fill="#161b22" stroke="${color}" stroke-width="${isSelected ? 2.5 : 1.2}" />
        <!-- Left Face -->
        <polygon points="4,10 16,16 16,26 4,20" fill="#090d13" stroke="${color}" stroke-width="${isSelected ? 2.5 : 1.2}" />
        <!-- Right Face -->
        <polygon points="16,16 28,10 28,20 16,26" fill="#040609" stroke="${color}" stroke-width="${isSelected ? 2.5 : 1.2}" />
        <!-- Text Brand Label on Top Face -->
        <text x="16" y="11.5" text-anchor="middle" dominant-baseline="central" font-size="6.5" font-weight="900" font-family="sans-serif" fill="${color}" transform="rotate(-15 16 11.5) skewX(-20)">${brand}</text>
        <!-- Port indicator dots on side faces -->
        <circle cx="8" cy="16" r="0.8" fill="${color}" opacity="0.85" />
        <circle cx="12" cy="18" r="0.8" fill="${color}" opacity="0.85" />
        <circle cx="20" cy="18" r="0.8" fill="${color}" opacity="0.85" />
        <circle cx="24" cy="16" r="0.8" fill="${color}" opacity="0.85" />
      </svg>
    `
  } else {
    return `
      <svg width="${size}" height="${size}" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="cylinderGrad-${cleanColor}" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stop-color="#090d13" />
            <stop offset="30%" stop-color="#161b22" />
            <stop offset="70%" stop-color="#090d13" />
            <stop offset="100%" stop-color="#040609" />
          </linearGradient>
        </defs>
        <!-- Cylinder Side Body -->
        <path d="M 4,11 A 12,6 0 0,0 28,11 L 28,21 A 12,6 0 0,1 4,21 Z" fill="url(#cylinderGrad-${cleanColor})" stroke="${color}" stroke-width="${isSelected ? 2.5 : 1.2}" />
        <!-- Top Face Oval -->
        <ellipse cx="16" cy="11" rx="12" ry="6" fill="#161b22" stroke="${color}" stroke-width="${isSelected ? 2.5 : 1.2}" />
        <!-- Indicator lights on top face -->
        <circle cx="11" cy="11" r="1.0" fill="${color}" />
        <circle cx="15" cy="13" r="1.0" fill="${color}" />
        <!-- Brand text on top face -->
        <text x="16" y="9" text-anchor="middle" dominant-baseline="central" font-size="7.5" font-weight="900" font-family="sans-serif" fill="${color}">${brand}</text>
        <!-- Dynamic route direction arrow markings on bottom cylinder skirt -->
        <path d="M 9,19 L 14,19 M 12,17 L 14,19 L 12,21 M 23,19 L 18,19 M 20,17 L 18,19 L 20,21" stroke="${color}" stroke-width="0.8" fill="none" opacity="0.8" />
      </svg>
    `
  }
}

// Generates coordinates along a quadratic Bezier curve in lat/lng space for multi-link visual separation
const getBezierPoints = (lat1, lng1, lat2, lng2, index, count) => {
  const points = []
  const steps = 15 // smooth rendering path segments
  if (count <= 1 || index === undefined) {
    return [[lat1, lng1], [lat2, lng2]]
  }

  // Adjust curvature offset on map based on node scale / spacing
  const curvature = (index - (count - 1) / 2) * 0.12

  // Determine alphabetical coordinate sorting to prevent curve flipping on direction swap
  const isReversed = lat1 > lat2 || (lat1 === lat2 && lng1 > lng2)
  const q_lat1 = isReversed ? lat2 : lat1
  const q_lng1 = isReversed ? lng2 : lng1
  const q_lat2 = isReversed ? lat1 : lat2
  const q_lng2 = isReversed ? lng1 : lng2

  const dLat = q_lat2 - q_lat1
  const dLng = q_lng2 - q_lng1
  const L = Math.sqrt(dLat * dLat + dLng * dLng) || 0.001

  // Perpendicular normal vector
  const nLat = -dLng / L
  const nLng = dLat / L

  // Midpoint coordinates
  const lat_m = (lat1 + lat2) / 2
  const lng_m = (lng1 + lng2) / 2

  // Curved Control Point (scaled by distance L to look consistent across zoom levels)
  const lat_c = lat_m + curvature * L * nLat
  const lng_c = lng_m + curvature * L * nLng

  // Generate points along the quadratic Bezier curve
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const u = 1 - t
    const lat = u * u * lat1 + 2 * u * t * lat_c + t * t * lat2
    const lng = u * u * lng1 + 2 * u * t * lng_c + t * t * lng2
    points.push([lat, lng])
  }
  return points
}

// SVG cloud icon for BGP upstream AS peers
const getBGPCloudSVGMarkup = (asNumber, color, size = 44) => {
  const w = size
  const h = Math.round(size * 0.7)
  return `
    <svg width="${w}" height="${h}" viewBox="0 0 50 35" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <filter id="cloud-glow-${asNumber}">
          <feGaussianBlur stdDeviation="1.5" result="blur"/>
          <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>
      <path d="M 10,28 Q 2,28 2,21 Q 2,14 9,13 Q 8,4 18,4 Q 23,1 28,5 Q 33,3 37,7 Q 44,7 46,13 Q 50,13 50,20 Q 50,28 42,28 Z"
            fill="#0d1117" stroke="${color}" stroke-width="1.5"
            filter="url(#cloud-glow-${asNumber})" />
      <text x="26" y="18" text-anchor="middle" dominant-baseline="central"
            font-size="8" font-weight="900" font-family="monospace" fill="${color}"
            letter-spacing="0.5">AS${asNumber}</text>
      <path d="M 6,19 L 6,24 M 4,21 L 6,19 L 8,21" stroke="${color}" stroke-width="1" fill="none" opacity="0.7"/>
    </svg>
  `
}

// Dynamically load Leaflet CDN assets
const loadLeaflet = () => {
  return new Promise((resolve, reject) => {
    if (window.L) {
      resolve(window.L)
      return
    }
    // Add stylesheet
    if (!document.getElementById('leaflet-css')) {
      const link = document.createElement('link')
      link.rel = 'stylesheet'
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
      link.id = 'leaflet-css'
      document.head.appendChild(link)
    }
    // Add script
    if (!document.getElementById('leaflet-js')) {
      const script = document.createElement('script')
      script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
      script.id = 'leaflet-js'
      script.onload = () => resolve(window.L)
      script.onerror = (err) => reject(err)
      document.body.appendChild(script)
    } else {
      // Script is already added but maybe not loaded yet, poll briefly
      const timer = setInterval(() => {
        if (window.L) {
          clearInterval(timer)
          resolve(window.L)
        }
      }, 100)
    }
  })
}

// Dynamically load Google Maps SDK
const loadGoogleMaps = (apiKey) => {
  return new Promise((resolve, reject) => {
    if (window.google && window.google.maps) {
      resolve(window.google.maps)
      return
    }
    // Remove any incomplete maps scripts
    const existing = document.getElementById('google-maps-js')
    if (existing) {
      existing.remove()
    }
    const script = document.createElement('script')
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}`
    script.id = 'google-maps-js'
    script.onload = () => resolve(window.google.maps)
    script.onerror = (err) => reject(err)
    document.body.appendChild(script)
  })
}

export default function GeoTopologyMap({
  nodes,
  edges,
  showOspf,
  showLldp,
  showBgp,
  showBgpClouds = true,
  selectedNode,
  onSelectNode,
  onNodeMoved,
  onUnplaceNode,
  provider, // 'osm' | 'google'
  googleApiKey,
  linkViewMode,
  mapTheme,
  asRegistry = {},
  onRegistryUpdate,
}) {
  const mapContainerRef = useRef(null)
  const [mapLoaded, setMapLoaded] = useState(false)
  const [loadError, setLoadError] = useState(null)
  const [unplacedNodes, setUnplacedNodes] = useState([])
  
  // Custom JPG/PNG icon state loaded from localStorage
  const [customRouterIcon, setCustomRouterIcon] = useState(() => {
    return localStorage.getItem('topology_custom_router_icon') || ''
  })
  const [customSwitchIcon, setCustomSwitchIcon] = useState(() => {
    return localStorage.getItem('topology_custom_switch_icon') || ''
  })

  const handleFileChange = (e, type) => {
    const file = e.target.files[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (event) => {
      const base64 = event.target.result
      if (type === 'router') {
        setCustomRouterIcon(base64)
        localStorage.setItem('topology_custom_router_icon', base64)
      } else {
        setCustomSwitchIcon(base64)
        localStorage.setItem('topology_custom_switch_icon', base64)
      }
    }
    reader.readAsDataURL(file)
  }

  const handleResetIcons = () => {
    setCustomRouterIcon('')
    setCustomSwitchIcon('')
    localStorage.removeItem('topology_custom_router_icon')
    localStorage.removeItem('topology_custom_switch_icon')
  }

  const getCustomIcon = (deviceType, label) => {
    const isSwitch = checkIfSwitch(deviceType, label)
    return isSwitch ? customSwitchIcon : customRouterIcon
  }

  // Node scale factor state with persistence
  const [nodeScale, setNodeScale] = useState(() => {
    return parseFloat(localStorage.getItem('topology_node_scale') || '1.0')
  })

  const handleScaleChange = (val) => {
    setNodeScale(val)
    localStorage.setItem('topology_node_scale', val.toString())
  }

  // Collapsible panel states
  const [collapsedNodeSize, setCollapsedNodeSize] = useState(() =>
    localStorage.getItem('geo_collapsed_nodesize') === 'true')
  const [collapsedUnplaced, setCollapsedUnplaced] = useState(false)
  const [showAsPanel, setShowAsPanel] = useState(true)

  // BGP AS filter — which AS numbers are visible. null = not yet initialised.
  const [asFilter, setAsFilter] = useState(null)
  // Registry inline editor state
  const [registryEditing, setRegistryEditing] = useState(false)
  const [registryDraft, setRegistryDraft] = useState({})

  // ---------------------------------------------------------------------------
  // OSPF Path + TE Tunnel visualization state
  // ---------------------------------------------------------------------------
  const [showPathPanel, setShowPathPanel]   = useState(false)
  const [pathSrc, setPathSrc]               = useState('')
  const [pathDst, setPathDst]               = useState('')
  const [pathResult, setPathResult]         = useState(null)   // {path:[rid,...], total_cost, hops}
  const [pathLoading, setPathLoading]       = useState(false)
  const [pathError, setPathError]           = useState(null)
  const [showTeTunnels, setShowTeTunnels]   = useState(false)
  const [teTunnels, setTeTunnels]           = useState([])
  const [teTunnelsLoading, setTeTunnelsLoading] = useState(false)
  const [activeTunnel, setActiveTunnel]     = useState(null)   // tunnel name highlighted
  const pathPolylinesRef    = useRef([])
  const teTunnelLinesRef    = useRef([])

  // Map router_id → placed node so we can convert LSDB hops to lat/lng
  const routerIdToNode = useMemo(() => {
    const m = {}
    nodes.forEach(n => {
      if (n.router_id) m[n.router_id] = n
      // also index by device name as fallback
      if (n.id) m[n.id] = n
    })
    return m
  }, [nodes])

  const getLatLngByRouterId = useCallback((rid) => {
    const n = routerIdToNode[rid]
    if (n && n.latitude != null && n.longitude != null) return [n.latitude, n.longitude]
    return null
  }, [routerIdToNode])

  // Load TE tunnels when toggle is switched on
  useEffect(() => {
    if (!showTeTunnels) { setTeTunnels([]); return }
    setTeTunnelsLoading(true)
    getTePaths()
      .then(d => setTeTunnels(d.tunnels || []))
      .catch(() => setTeTunnels([]))
      .finally(() => setTeTunnelsLoading(false))
  }, [showTeTunnels])

  // Draw / clear SPF path overlay
  useEffect(() => {
    // Clear old overlays
    pathPolylinesRef.current.forEach(p => {
      if (p.remove) p.remove()           // Leaflet
      else if (p.setMap) p.setMap(null)  // Google
    })
    pathPolylinesRef.current = []

    if (!pathResult || !mapLoaded || !mapInstanceRef.current) return
    const hops = pathResult.path || []
    if (hops.length < 2) return

    const coords = hops.map(getLatLngByRouterId).filter(Boolean)
    if (coords.length < 2) return

    if (provider === 'osm' && window.L) {
      const pl = window.L.polyline(coords, {
        color: '#f0a500', weight: 6, opacity: 0.95, dashArray: '10 5',
        className: 'spf-path-line',
      }).addTo(mapInstanceRef.current)
      pl.bindTooltip(`SPF: ${hops.length - 1} hops · cost ${pathResult.total_cost}`, { sticky: true })
      pathPolylinesRef.current.push(pl)
    } else if (provider === 'google' && window.google) {
      const pl = new window.google.maps.Polyline({
        path: coords.map(([lat, lng]) => ({ lat, lng })),
        strokeColor: '#f0a500', strokeOpacity: 0.95, strokeWeight: 6,
        geodesic: true, map: mapInstanceRef.current,
        icons: [{ icon: { path: window.google.maps.SymbolPath.FORWARD_OPEN_ARROW }, offset: '50%' }],
      })
      pathPolylinesRef.current.push(pl)
    }
  }, [pathResult, mapLoaded, provider, getLatLngByRouterId])

  // Draw / clear TE tunnel overlays
  useEffect(() => {
    teTunnelLinesRef.current.forEach(p => {
      if (p.remove) p.remove()
      else if (p.setMap) p.setMap(null)
    })
    teTunnelLinesRef.current = []

    if (!showTeTunnels || !mapLoaded || !mapInstanceRef.current) return

    const TUNNEL_COLORS = ['#58a6ff','#3fb950','#d859ff','#f0a500','#f85149','#79c0ff','#7ee787']

    teTunnels.forEach((tunnel, idx) => {
      const hops = tunnel.hops || []
      if (hops.length < 2) return
      const coords = hops.map(getLatLngByRouterId).filter(Boolean)
      if (coords.length < 2) return
      const color = TUNNEL_COLORS[idx % TUNNEL_COLORS.length]
      const isActive = activeTunnel === tunnel.name
      const label = `${tunnel.name} · ${tunnel.bw_kbps || '?'}kbps · ${tunnel.admin || '?'}/${tunnel.oper || '?'}`

      if (provider === 'osm' && window.L) {
        const pl = window.L.polyline(coords, {
          color, weight: isActive ? 5 : 3,
          opacity: isActive ? 1 : 0.6,
          dashArray: tunnel.oper === 'up' ? null : '6 4',
        }).addTo(mapInstanceRef.current)
        pl.bindTooltip(label, { sticky: true })
        pl.on('click', () => setActiveTunnel(t => t === tunnel.name ? null : tunnel.name))
        teTunnelLinesRef.current.push(pl)
      } else if (provider === 'google' && window.google) {
        const pl = new window.google.maps.Polyline({
          path: coords.map(([lat, lng]) => ({ lat, lng })),
          strokeColor: color, strokeOpacity: isActive ? 1 : 0.6,
          strokeWeight: isActive ? 5 : 3,
          geodesic: true, map: mapInstanceRef.current,
        })
        teTunnelLinesRef.current.push(pl)
      }
    })
  }, [teTunnels, showTeTunnels, activeTunnel, mapLoaded, provider, getLatLngByRouterId])

  // Placed routers with a known router_id (for path source/dest dropdowns)
  const placedRoutersForPath = useMemo(() => {
    return nodes.filter(n =>
      n.node_type !== 'bgp_cloud' &&
      n.router_id &&
      n.latitude != null && n.longitude != null
    ).sort((a, b) => (a.label || a.id).localeCompare(b.label || b.id))
  }, [nodes])

  const handleCalculatePath = useCallback(async () => {
    if (!pathSrc || !pathDst) return
    setPathLoading(true)
    setPathError(null)
    setPathResult(null)
    try {
      const result = await getSpfPath(pathSrc, pathDst)
      setPathResult(result)
    } catch (e) {
      const msg = e?.response?.data?.detail || e?.message || 'Path not found'
      setPathError(msg)
    } finally {
      setPathLoading(false)
    }
  }, [pathSrc, pathDst])

  // Shared inline styles
  const selectStyle = {
    width: '100%', padding: '4px 6px', fontSize: 10,
    background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)',
    color: '#e6edf3', borderRadius: 6, outline: 'none', cursor: 'pointer',
  }

  // Store active map instances, markers, and polylines
  const mapInstanceRef = useRef(null)
  const markersRef = useRef({})
  const polylinesRef = useRef([])

  // Store selectedNode in a mutable ref to prevent stale event closures
  const selectedNodeRef = useRef(selectedNode)
  useEffect(() => {
    selectedNodeRef.current = selectedNode
  }, [selectedNode])

  // Extract placed & unplaced nodes (bgp_cloud nodes get virtual positions, skip them here)
  useEffect(() => {
    const placed = []
    const unplaced = []
    nodes.forEach(n => {
      if (n.node_type === 'bgp_cloud') return
      if (n.latitude != null && n.longitude != null && !isNaN(n.latitude) && !isNaN(n.longitude)) {
        placed.push(n)
      } else {
        unplaced.push(n)
      }
    })
    setUnplacedNodes(unplaced)
  }, [nodes])

  // Initialise AS filter when topology changes: show "main" ASes by default,
  // or all AS numbers if no "main" entries are configured.
  useEffect(() => {
    const clouds = nodes.filter(n => n.node_type === 'bgp_cloud')
    if (clouds.length === 0) return
    const allNums = [...new Set(clouds.map(n => n.remote_as).filter(Boolean))]
    // Only run first-time init; subsequent topology refreshes should not reset user choices
    setAsFilter(prev => {
      if (prev !== null) return prev  // already initialised — keep user's selection
      const mainNums = allNums.filter(as => asRegistry[String(as)]?.main)
      return new Set(mainNums.length > 0 ? mainNums : allNums)
    })
  }, [nodes, asRegistry])

  // Get active edges based on protocol filters and coordinates existence
  const getActiveEdges = () => {
    const placedIds = new Set(
      nodes
        .filter(n => n.latitude != null && n.longitude != null && !isNaN(n.latitude) && !isNaN(n.longitude))
        .map(n => n.id)
    )

    return edges.filter(e => {
      const matchesFilter =
        (showOspf && e.protocol === 'ospf') ||
        (showLldp && e.protocol === 'lldp') ||
        (showBgp && e.protocol === 'bgp') ||
        (e.protocol === 'unknown')
      return matchesFilter && placedIds.has(e.source) && placedIds.has(e.target)
    })
  }

  // Effect to initialize the Map depending on the provider
  useEffect(() => {
    if (!mapContainerRef.current) return
    setMapLoaded(false)
    setLoadError(null)

    // Cleanup previous map instances
    cleanupMap()

    const defaultCenter = [24.7136, 46.6753] // Default: Riyadh, Saudi Arabia
    const defaultZoom = 6

    // Dynamically calculate average center of placed nodes
    const placed = nodes.filter(n => n.latitude != null && n.longitude != null && !isNaN(n.latitude) && !isNaN(n.longitude))
    let mapCenter = defaultCenter
    if (placed.length > 0) {
      const avgLat = placed.reduce((sum, n) => sum + n.latitude, 0) / placed.length
      const avgLng = placed.reduce((sum, n) => sum + n.longitude, 0) / placed.length
      mapCenter = [avgLat, avgLng]
    }

    if (provider === 'google') {
      if (!googleApiKey) {
        setLoadError('Please set your Google Maps API Key in the settings input above.')
        return
      }
      loadGoogleMaps(googleApiKey)
        .then((googleMaps) => {
          const googleStyles = mapTheme === 'light' ? [] : [
            { elementType: 'geometry', stylers: [{ color: '#242f3e' }] },
            { elementType: 'labels.text.stroke', stylers: [{ color: '#242f3e' }] },
            { elementType: 'labels.text.fill', stylers: [{ color: '#746855' }] },
            {
              featureType: 'administrative.locality',
              elementType: 'labels.text.fill',
              stylers: [{ color: '#d59563' }],
            },
            {
              featureType: 'road',
              elementType: 'geometry',
              stylers: [{ color: '#38414e' }],
            },
            {
              featureType: 'road',
              elementType: 'geometry.stroke',
              stylers: [{ color: '#212a37' }],
            },
            {
              featureType: 'water',
              elementType: 'geometry',
              stylers: [{ color: '#17263c' }],
            },
          ]
          const map = new googleMaps.Map(mapContainerRef.current, {
            center: { lat: mapCenter[0], lng: mapCenter[1] },
            zoom: defaultZoom,
            styles: googleStyles,
            disableDefaultUI: false,
          })
          mapInstanceRef.current = { type: 'google', map }
          setMapLoaded(true)
        })
        .catch(err => {
          console.error(err)
          setLoadError('Failed to load Google Maps SDK. Please check your network or API key.')
        })
    } else {
      // Default: Leaflet / OpenStreetMap
      loadLeaflet()
        .then((L) => {
          const map = L.map(mapContainerRef.current, { attributionControl: false }).setView(mapCenter, defaultZoom)
          // Add a slick dark mode map styling using CartoDB Dark Matter tiles or colorful OSM tiles
          const tileUrl = mapTheme === 'light'
            ? 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
            : 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
          L.tileLayer(tileUrl, {
            attribution: '&copy; CartoDB &copy; OpenStreetMap contributors',
            maxZoom: 20,
          }).addTo(map)

          mapInstanceRef.current = { type: 'osm', map }
          setMapLoaded(true)
        })
        .catch(err => {
          console.error(err)
          setLoadError('Failed to load OpenStreetMap/Leaflet components.')
        })
    }

    return () => cleanupMap()
  }, [provider, googleApiKey, mapTheme]) // eslint-disable-line

  // Cleanup helper
  const cleanupMap = () => {
    // Clear markers
    markersRef.current = {}

    // Clear polylines
    if (mapInstanceRef.current) {
      if (mapInstanceRef.current.type === 'osm') {
        try {
          mapInstanceRef.current.map.remove()
        } catch (e) {
          console.warn('Map destroy failed', e)
        }
      }
      mapInstanceRef.current = null
    }
  }

  // Draw nodes & edges on map whenever topology updates
  useEffect(() => {
    if (!mapLoaded || !mapInstanceRef.current) return

    const { type, map } = mapInstanceRef.current
    let activeEdges = getActiveEdges()

    // Handle logical vs physical links mode for map
    if (linkViewMode === 'logical') {
      const mergedMap = new Map()
      activeEdges.forEach(e => {
        const key = [e.source, e.target].sort().join('-')
        if (!mergedMap.has(key)) {
          mergedMap.set(key, { ...e, pairCount: 1, pairIndex: 0 })
        } else {
          const existing = mergedMap.get(key)
          if (e.status === 'down') {
            existing.status = 'down'
          }
          if (e.local_interface && !existing.local_interface.includes(e.local_interface)) {
            existing.local_interface = existing.local_interface + ', ' + e.local_interface
          }
        }
      })
      activeEdges = Array.from(mergedMap.values())
    } else {
      // Group by node-pair keys to set pairIndex and pairCount for physical view curves
      const edgesByPair = {}
      activeEdges.forEach(e => {
        const key = [e.source, e.target].sort().join('-')
        if (!edgesByPair[key]) edgesByPair[key] = []
        edgesByPair[key].push(e)
      })
      activeEdges.forEach(e => {
        const key = [e.source, e.target].sort().join('-')
        const list = edgesByPair[key]
        e.pairIndex = list.indexOf(e)
        e.pairCount = list.length
      })
    }

    // 1. CLEAR PREVIOUS RENDER ELEMENTS
    if (type === 'osm') {
      // Clear previous polylines
      polylinesRef.current.forEach(p => p.remove())
      polylinesRef.current = []

      // Keep track of existing markers to avoid redraw flash
      const nextMarkers = {}
      const L = window.L
      const hasHighlight = nodes.some(n => n.highlight)

      nodes.forEach(node => {
        if (node.node_type === 'bgp_cloud') return // rendered separately below
        if (node.latitude == null || node.longitude == null || isNaN(node.latitude) || isNaN(node.longitude)) {
          // Remove if it was previously placed but now is unplaced
          if (markersRef.current[node.id]) {
            markersRef.current[node.id].remove()
          }
          return
        }

        const pos = [node.latitude, node.longitude]
        let marker = markersRef.current[node.id]

        const color = STATUS_COLOR[node.status] || STATUS_COLOR.unknown
        const isSelected = selectedNode === node.id
        const isHighlighted = node.highlight
        const size = Math.round(32 * nodeScale)
        const halfSize = Math.round(size / 2)
        const nodeOpacity = hasHighlight ? (isHighlighted ? 1 : 0.4) : 1

        const customIconData = getCustomIcon(node.device_type, node.label)
        let innerIconMarkup
        if (customIconData) {
          innerIconMarkup = `
            <div style="
              width: 100%;
              height: 100%;
              border: 2px solid ${color};
              border-radius: ${checkIfSwitch(node.device_type, node.label) ? '6px' : '50%'};
              background: #0d1117;
              overflow: hidden;
              box-shadow: 0 0 8px ${color}80;
              box-sizing: border-box;
            ">
              <img src="${customIconData}" style="width: 100%; height: 100%; object-fit: cover;" />
            </div>
          `
        } else {
          innerIconMarkup = getDeviceSVGMarkup(node.vendor, node.device_type, node.label, color, isSelected, size)
        }

        const iconHtml = `
          <div style="
            position: relative;
            width: ${size}px;
            height: ${size}px;
            display: flex;
            align-items: center;
            justify-content: center;
            filter: drop-shadow(0px 0px 6px ${color}${isHighlighted ? 'A0' : '40'});
            transition: transform 0.2s ease, opacity 0.2s ease;
            opacity: ${nodeOpacity};
          ">
            ${innerIconMarkup}
          </div>
          <div style="
            position: absolute;
            top: ${size}px;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(13, 17, 23, 0.85);
            border: 1px solid var(--border);
            border-radius: 4px;
            padding: 1px 6px;
            color: #e6edf3;
            font-size: 9px;
            white-space: nowrap;
            pointer-events: none;
            box-shadow: 0 2px 4px rgba(0,0,0,0.5);
            opacity: ${nodeOpacity};
            transition: opacity 0.2s ease;
          ">${node.label}</div>
        `

        const customIcon = L.divIcon({
          className: 'custom-topology-marker',
          html: iconHtml,
          iconSize: [size, size],
          iconAnchor: [halfSize, halfSize],
        })

        if (marker) {
          // Update location and icon
          marker.setLatLng(pos)
          marker.setIcon(customIcon)
        } else {
          // Create marker
          marker = L.marker(pos, {
            draggable: true,
            icon: customIcon,
          }).addTo(map)

          marker.on('click', (e) => {
            onSelectNode(node.id === selectedNodeRef.current ? null : node.id)
          })

          marker.on('dragend', (e) => {
            const newLatLng = e.target.getLatLng()
            onNodeMoved(node.id, newLatLng.lat, newLatLng.lng)
          })
        }

        nextMarkers[node.id] = marker
      })

      // ── BGP Cloud Nodes (ISP upstream AS peers) ──────────────────────────
      // Each cloud node already knows its router_id; group by router to spread radially.
      const _visibleClouds = nodes.filter(n =>
        n.node_type === 'bgp_cloud' &&
        showBgpClouds &&
        (asFilter == null || asFilter.has(n.remote_as))
      )
      const _routerCloudGroups = {}
      _visibleClouds.forEach(cloudNode => {
        const rid = cloudNode.router_id
        if (!rid) return
        if (!_routerCloudGroups[rid]) _routerCloudGroups[rid] = []
        _routerCloudGroups[rid].push(cloudNode)
      })
      const bgpCloudVirtualPos = {}
      Object.entries(_routerCloudGroups).forEach(([routerId, cloudNodes]) => {
        const router = nodes.find(n => n.id === routerId)
        if (!router || router.latitude == null || router.longitude == null) return
        cloudNodes.forEach((cloudNode, idx) => {
          const angle = (idx / Math.max(cloudNodes.length, 1)) * 2 * Math.PI - Math.PI / 2
          bgpCloudVirtualPos[cloudNode.id] = {
            latitude: router.latitude + 1.6 * Math.cos(angle),
            longitude: router.longitude + 2.8 * Math.sin(angle),
          }
        })
      })

      // Render BGP cloud markers
      _visibleClouds.forEach(cloudNode => {
        const vPos = bgpCloudVirtualPos[cloudNode.id]
        if (!vPos) return

        const pos = [vPos.latitude, vPos.longitude]
        let marker = markersRef.current[cloudNode.id]
        // Color: green = established, red = degraded
        const cloudColor = cloudNode.bgp_status === 'established' ? '#3fb950' : '#f85149'
        const asNum = cloudNode.remote_as || '?'
        const companyName = cloudNode.company_name || asRegistry[String(asNum)]?.name || ''
        const cloudSize = Math.round(44 * nodeScale)
        const cloudH = Math.round(cloudSize * 0.7)
        const statusLabel = cloudNode.bgp_status === 'established' ? '● Up' : '● Down'

        const iconHtml = `
          <div style="position: relative; display: inline-block;">
            ${getBGPCloudSVGMarkup(asNum, cloudColor, cloudSize)}
            <div style="
              position: absolute;
              top: ${cloudH + 2}px;
              left: 50%;
              transform: translateX(-50%);
              background: rgba(13,17,23,0.9);
              border: 1px solid ${cloudColor}66;
              border-radius: 4px;
              padding: 1px 5px;
              color: ${cloudColor};
              font-size: 8px;
              font-weight: 700;
              white-space: nowrap;
              font-family: monospace;
              pointer-events: none;
              max-width: 80px;
              overflow: hidden;
              text-overflow: ellipsis;
              text-align: center;
            ">${companyName || ('AS' + asNum)}</div>
          </div>
        `
        const cloudIcon = L.divIcon({
          className: 'custom-topology-marker bgp-cloud-marker',
          html: iconHtml,
          iconSize: [cloudSize, cloudH + 22],
          iconAnchor: [Math.round(cloudSize / 2), Math.round(cloudH / 2)],
        })

        if (marker) {
          marker.setLatLng(pos)
          marker.setIcon(cloudIcon)
        } else {
          marker = L.marker(pos, { icon: cloudIcon, draggable: false }).addTo(map)
          marker.bindTooltip(
            `AS${asNum}${companyName ? ' — ' + companyName : ''}\nRouter: ${cloudNode.router_id}\nStatus: ${cloudNode.bgp_status}`,
            { sticky: true, className: 'leaflet-conn-tooltip' }
          )
          marker.on('click', () => {
            onSelectNode(cloudNode.id === selectedNodeRef.current ? null : cloudNode.id)
          })
        }
        nextMarkers[cloudNode.id] = marker
      })

      // Remove obsolete markers
      Object.keys(markersRef.current).forEach(id => {
        if (!nextMarkers[id]) {
          markersRef.current[id].remove()
        }
      })
      markersRef.current = nextMarkers

      // Draw BGP cloud edges (dashed lines, color = bgp_status)
      if (showBgp && showBgpClouds) {
        edges
          .filter(e => e.protocol === 'bgp')
          .forEach(edge => {
            const cloudNode = nodes.find(n => n.node_type === 'bgp_cloud' && (n.id === edge.source || n.id === edge.target))
            if (!cloudNode) return
            if (asFilter != null && !asFilter.has(cloudNode.remote_as)) return
            const vPos = bgpCloudVirtualPos[cloudNode.id]
            if (!vPos) return
            const routerId = cloudNode.id === edge.source ? edge.target : edge.source
            const routerNode = nodes.find(n => n.id === routerId)
            if (!routerNode || routerNode.latitude == null || routerNode.longitude == null) return

            const edgeColor = (edge.bgp_status || cloudNode.bgp_status) === 'established' ? '#3fb950' : '#f85149'
            const pl = L.polyline(
              [[routerNode.latitude, routerNode.longitude], [vPos.latitude, vPos.longitude]],
              { color: edgeColor, weight: 2, opacity: 0.8, dashArray: '6, 4' }
            ).addTo(map)
            pl.bindTooltip(
              `BGP AS${cloudNode.remote_as} ← ${routerNode.label || routerId} [${cloudNode.bgp_status}]`,
              { sticky: true, className: 'leaflet-conn-tooltip' }
            )
            polylinesRef.current.push(pl)
          })
      }

      // Draw Edges (Polylines)
      activeEdges.forEach(edge => {
        const sourceNode = nodes.find(n => n.id === edge.source)
        const targetNode = nodes.find(n => n.id === edge.target)
        if (!sourceNode || !targetNode) return

        const p1 = [sourceNode.latitude, sourceNode.longitude]
        const p2 = [targetNode.latitude, targetNode.longitude]

        const isEdgeConnectedToHighlight = sourceNode.highlight || targetNode.highlight
        const opacity = hasHighlight ? (isEdgeConnectedToHighlight ? 0.95 : 0.2) : 0.75
        const weight = hasHighlight ? (isEdgeConnectedToHighlight ? 3.5 : 1.5) : 2
        const color = edge.status === 'down' ? '#f85149' : (PROTOCOL_COLOR[edge.protocol] || PROTOCOL_COLOR.unknown)

        // Get Bezier points if multiple links exist, else straight line
        const polylinePoints = getBezierPoints(p1[0], p1[1], p2[0], p2[1], edge.pairIndex, edge.pairCount)

        const pl = L.polyline(polylinePoints, {
          color,
          weight,
          opacity,
          dashArray: edge.protocol === 'lldp' ? '4, 4' : null,
        }).addTo(map)

        // Simple tooltip on connection hover
        pl.bindTooltip(`${edge.protocol.toUpperCase()}: ${edge.local_interface || ''} ➔ ${edge.remote_port || ''}`, {
          sticky: true,
          className: 'leaflet-conn-tooltip',
        })

        polylinesRef.current.push(pl)
      })

    } else if (type === 'google') {
      const googleMaps = window.google.maps

      // Clear previous lines
      polylinesRef.current.forEach(p => p.setMap(null))
      polylinesRef.current = []

      const nextMarkers = {}
      const hasHighlight = nodes.some(n => n.highlight)

      nodes.forEach(node => {
        if (node.node_type === 'bgp_cloud') return // rendered separately below
        if (node.latitude == null || node.longitude == null || isNaN(node.latitude) || isNaN(node.longitude)) {
          if (markersRef.current[node.id]) {
            markersRef.current[node.id].setMap(null)
          }
          return
        }

        const pos = { lat: node.latitude, lng: node.longitude }
        let markerItem = markersRef.current[node.id]

        const color = STATUS_COLOR[node.status] || STATUS_COLOR.unknown
        const isSelected = selectedNode === node.id
        const isHighlighted = node.highlight
        const size = Math.round(32 * nodeScale)
        const halfSize = Math.round(size / 2)
        const nodeOpacity = hasHighlight ? (isHighlighted ? 1.0 : 0.4) : 1.0

        const customIconData = getCustomIcon(node.device_type, node.label)
        let svgIcon
        if (customIconData) {
          svgIcon = {
            url: customIconData,
            size: new googleMaps.Size(size, size),
            anchor: new googleMaps.Point(halfSize, halfSize),
            scaledSize: new googleMaps.Size(size, size),
          }
        } else {
          const svgMarkup = getDeviceSVGMarkup(node.vendor, node.device_type, node.label, color, isSelected, size)
          const dataUrl = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svgMarkup)}`
          svgIcon = {
            url: dataUrl,
            size: new googleMaps.Size(size, size),
            anchor: new googleMaps.Point(halfSize, halfSize),
            scaledSize: new googleMaps.Size(size, size),
          }
        }

        if (markerItem) {
          markerItem.setPosition(pos)
          markerItem.setIcon(svgIcon)
          markerItem.setLabel(null)
          markerItem.setTitle(node.label)
          markerItem.setOpacity(nodeOpacity)
        } else {
          markerItem = new googleMaps.Marker({
            position: pos,
            map,
            draggable: true,
            icon: svgIcon,
            title: node.label,
            opacity: nodeOpacity,
          })

          markerItem.addListener('click', () => {
            onSelectNode(node.id === selectedNodeRef.current ? null : node.id)
          })

          markerItem.addListener('dragend', () => {
            const newPos = markerItem.getPosition()
            onNodeMoved(node.id, newPos.lat(), newPos.lng())
          })
        }

        nextMarkers[node.id] = markerItem
      })

      // ── BGP Cloud Nodes for Google Maps ──────────────────────────────────
      const _gVisibleClouds = nodes.filter(n =>
        n.node_type === 'bgp_cloud' &&
        showBgpClouds &&
        (asFilter == null || asFilter.has(n.remote_as))
      )
      const _gRouterCloudGroups = {}
      _gVisibleClouds.forEach(cloudNode => {
        const rid = cloudNode.router_id
        if (!rid) return
        if (!_gRouterCloudGroups[rid]) _gRouterCloudGroups[rid] = []
        _gRouterCloudGroups[rid].push(cloudNode)
      })
      const gBgpCloudVirtualPos = {}
      Object.entries(_gRouterCloudGroups).forEach(([routerId, cloudNodes]) => {
        const router = nodes.find(n => n.id === routerId)
        if (!router || router.latitude == null || router.longitude == null) return
        cloudNodes.forEach((cloudNode, idx) => {
          const angle = (idx / Math.max(cloudNodes.length, 1)) * 2 * Math.PI - Math.PI / 2
          gBgpCloudVirtualPos[cloudNode.id] = {
            lat: router.latitude + 1.6 * Math.cos(angle),
            lng: router.longitude + 2.8 * Math.sin(angle),
          }
        })
      })

      _gVisibleClouds.forEach(cloudNode => {
        const vPos = gBgpCloudVirtualPos[cloudNode.id]
        if (!vPos) return
        const asNum = cloudNode.remote_as || '?'
        const companyName = cloudNode.company_name || asRegistry[String(asNum)]?.name || ''
        const cloudColor = cloudNode.bgp_status === 'established' ? '#3fb950' : '#f85149'
        const cloudSize = Math.round(44 * nodeScale)
        const cloudH = Math.round(cloudSize * 0.7)
        const svgMarkup = getBGPCloudSVGMarkup(asNum, cloudColor, cloudSize)
        const dataUrl = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svgMarkup)}`

        let markerItem = markersRef.current[cloudNode.id]
        const gIcon = {
          url: dataUrl,
          size: new googleMaps.Size(cloudSize, cloudH),
          anchor: new googleMaps.Point(Math.round(cloudSize / 2), Math.round(cloudH / 2)),
          scaledSize: new googleMaps.Size(cloudSize, cloudH),
        }
        if (markerItem) {
          markerItem.setPosition(vPos)
          markerItem.setIcon(gIcon)
        } else {
          markerItem = new googleMaps.Marker({
            position: vPos,
            map,
            draggable: false,
            icon: gIcon,
            title: `AS${asNum}${companyName ? ' — ' + companyName : ''} [${cloudNode.bgp_status}]`,
          })
          markerItem.addListener('click', () => {
            onSelectNode(cloudNode.id === selectedNodeRef.current ? null : cloudNode.id)
          })
        }
        nextMarkers[cloudNode.id] = markerItem

        // Draw dashed BGP cloud edge (colored by bgp_status)
        if (showBgp && showBgpClouds) {
          edges
            .filter(e => e.protocol === 'bgp' && (e.source === cloudNode.id || e.target === cloudNode.id))
            .forEach(e => {
              const routerId = e.source === cloudNode.id ? e.target : e.source
              const routerNode = nodes.find(n => n.id === routerId)
              if (!routerNode || routerNode.latitude == null) return
              const edgeColor = (e.bgp_status || cloudNode.bgp_status) === 'established' ? '#3fb950' : '#f85149'
              const pl = new googleMaps.Polyline({
                path: [
                  { lat: routerNode.latitude, lng: routerNode.longitude },
                  vPos,
                ],
                geodesic: true,
                strokeColor: edgeColor,
                strokeOpacity: 0.8,
                strokeWeight: 2,
                icons: [{
                  icon: { path: 'M 0,-1 0,1', strokeOpacity: 1, scale: 2 },
                  offset: '0',
                  repeat: '10px',
                }],
              })
              pl.setMap(map)
              polylinesRef.current.push(pl)
            })
        }
      })

      // Clean obsolete Google markers
      Object.keys(markersRef.current).forEach(id => {
        if (!nextMarkers[id]) {
          markersRef.current[id].setMap(null)
        }
      })
      markersRef.current = nextMarkers

      // Render Edges
      activeEdges.forEach(edge => {
        const sourceNode = nodes.find(n => n.id === edge.source)
        const targetNode = nodes.find(n => n.id === edge.target)
        if (!sourceNode || !targetNode) return

        const p1 = [sourceNode.latitude, sourceNode.longitude]
        const p2 = [targetNode.latitude, targetNode.longitude]

        const isEdgeConnectedToHighlight = sourceNode.highlight || targetNode.highlight
        const opacity = hasHighlight ? (isEdgeConnectedToHighlight ? 0.95 : 0.2) : 0.8
        const weight = hasHighlight ? (isEdgeConnectedToHighlight ? 3.5 : 2) : 2
        const color = edge.status === 'down' ? '#f85149' : (PROTOCOL_COLOR[edge.protocol] || PROTOCOL_COLOR.unknown)

        // Get Bezier points if multiple links exist, else straight line
        const polylinePoints = getBezierPoints(p1[0], p1[1], p2[0], p2[1], edge.pairIndex, edge.pairCount)
        const googlePath = polylinePoints.map(pt => ({ lat: pt[0], lng: pt[1] }))

        const pl = new googleMaps.Polyline({
          path: googlePath,
          geodesic: true,
          strokeColor: color,
          strokeOpacity: opacity,
          strokeWeight: weight,
          icons: edge.protocol === 'lldp' ? [{
            icon: { path: 'M 0,-1 0,1', strokeOpacity: 1, scale: 2 },
            offset: '0',
            repeat: '10px',
          }] : [],
        })

        pl.setMap(map)

        // Connection Info hover popup in Google Maps
        const infoWindow = new googleMaps.InfoWindow({
          content: `<div style="color: #0d1117; font-family: sans-serif; font-size: 11px; padding: 4px;">
            <strong>${edge.protocol.toUpperCase()} Connection</strong><br/>
            Source Interface: ${edge.local_interface || 'N/A'}<br/>
            Target Interface: ${edge.remote_port || 'N/A'}
          </div>`
        })

        pl.addListener('mouseover', (e) => {
          infoWindow.setPosition(e.latLng)
          infoWindow.open(map)
        })
        pl.addListener('mouseout', () => {
          infoWindow.close()
        })

        polylinesRef.current.push(pl)
      })
    }
  }, [mapLoaded, nodes, edges, showOspf, showLldp, showBgp, showBgpClouds, asFilter, asRegistry, selectedNode, nodeScale, linkViewMode, customRouterIcon, customSwitchIcon]) // eslint-disable-line

  // Click handler to position unplaced devices
  const handlePlaceNode = (node) => {
    if (!mapInstanceRef.current || !mapLoaded) return

    const { type, map } = mapInstanceRef.current
    let centerLat, centerLng

    if (type === 'osm') {
      const center = map.getCenter()
      centerLat = center.lat
      centerLng = center.lng
    } else {
      const center = map.getCenter()
      centerLat = center.lat()
      centerLng = center.lng()
    }

    // Assign temporary local center coordinates and notify backend to save
    onNodeMoved(node.id, centerLat, centerLng)
  }

  // Derive unique AS groups for the filter panel (sorted by company name)
  const asCloudGroups = useMemo(() => {
    const byAs = {}
    nodes.filter(n => n.node_type === 'bgp_cloud').forEach(n => {
      const as = n.remote_as
      if (!as) return
      if (!byAs[as]) byAs[as] = { remote_as: as, company_name: n.company_name || asRegistry[String(as)]?.name || '', anyEstablished: false, count: 0 }
      byAs[as].count++
      if (n.bgp_status === 'established') byAs[as].anyEstablished = true
    })
    return Object.values(byAs).sort((a, b) => {
      const na = (a.company_name || 'AS' + a.remote_as).toLowerCase()
      const nb = (b.company_name || 'AS' + b.remote_as).toLowerCase()
      return na.localeCompare(nb)
    })
  }, [nodes, asRegistry])

  // Dynamic Styles
  const sidebarStyle = {
    position: 'absolute',
    top: 16,
    right: 16,
    width: 280,
    maxHeight: 'calc(100% - 32px)',
    background: 'rgba(13, 17, 23, 0.85)',
    border: '1px solid var(--border)',
    borderRadius: 12,
    padding: 16,
    display: 'flex',
    flexDirection: 'column',
    zIndex: 1000,
    boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
    backdropFilter: 'blur(12px)',
  }

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}>
      {loadError && (
        <div style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justify: 'center',
          background: 'var(--bg)',
          color: 'var(--danger)',
          padding: 24,
          textAlign: 'center',
          zIndex: 2000,
        }}>
          <div style={{ maxWidth: 400, margin: 'auto' }}>
            <span style={{ fontSize: 48 }}>⚠</span>
            <div style={{ marginTop: 16, fontSize: 14, fontWeight: 600 }}>{loadError}</div>
          </div>
        </div>
      )}

      {/* Map container DOM element */}
      <div
        ref={mapContainerRef}
        style={{ width: '100%', height: '100%', background: '#1c2128' }}
      />

      {/* Node Size Scale & Icon Controller — collapsible */}
      {mapLoaded && (
        <div style={{
          position: 'absolute',
          top: 16,
          left: 60,
          background: 'rgba(13, 17, 23, 0.85)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          zIndex: 1000,
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
          backdropFilter: 'blur(12px)',
          width: collapsedNodeSize ? 'auto' : 260,
          overflow: 'hidden',
        }}>
          {/* Header / collapse toggle */}
          <div
            onClick={() => {
              const next = !collapsedNodeSize
              setCollapsedNodeSize(next)
              localStorage.setItem('geo_collapsed_nodesize', String(next))
            }}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '8px 12px',
              cursor: 'pointer',
              userSelect: 'none',
            }}
          >
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)', whiteSpace: 'nowrap' }}>
              📐 Node Size: {nodeScale.toFixed(1)}x
            </span>
            <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 8 }}>
              {collapsedNodeSize ? '▶' : '▼'}
            </span>
          </div>

          {!collapsedNodeSize && (
            <div style={{ padding: '0 12px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <input
                type="range"
                min="0.8"
                max="2.5"
                step="0.1"
                value={nodeScale}
                onChange={(e) => handleScaleChange(parseFloat(e.target.value))}
                style={{
                  width: '100%',
                  accentColor: 'var(--accent)',
                  cursor: 'pointer',
                  height: 4,
                  borderRadius: 2,
                  background: 'rgba(255,255,255,0.1)',
                  outline: 'none',
                }}
              />

              <div style={{ height: 1, background: 'rgba(255,255,255,0.1)' }} />

              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 10, fontWeight: 600, color: '#e6edf3' }}>Router Icon:</span>
                  <label style={{
                    padding: '3px 8px', fontSize: 9, fontWeight: 700, color: 'var(--accent)',
                    border: '1px solid var(--border)', borderRadius: 6,
                    background: 'rgba(255,255,255,0.03)', cursor: 'pointer', textAlign: 'center', whiteSpace: 'nowrap',
                  }}>
                    {customRouterIcon ? '✓ Uploaded' : '📁 Upload JPG'}
                    <input type="file" accept="image/*" onChange={(e) => handleFileChange(e, 'router')} style={{ display: 'none' }} />
                  </label>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 10, fontWeight: 600, color: '#e6edf3' }}>Switch Icon:</span>
                  <label style={{
                    padding: '3px 8px', fontSize: 9, fontWeight: 700, color: 'var(--accent)',
                    border: '1px solid var(--border)', borderRadius: 6,
                    background: 'rgba(255,255,255,0.03)', cursor: 'pointer', textAlign: 'center', whiteSpace: 'nowrap',
                  }}>
                    {customSwitchIcon ? '✓ Uploaded' : '📁 Upload JPG'}
                    <input type="file" accept="image/*" onChange={(e) => handleFileChange(e, 'switch')} style={{ display: 'none' }} />
                  </label>
                </div>
                {(customRouterIcon || customSwitchIcon) && (
                  <button onClick={handleResetIcons} style={{
                    marginTop: 4, padding: '4px 8px', fontSize: 9, fontWeight: 700,
                    color: 'var(--danger)', border: '1px solid rgba(248, 81, 73, 0.4)',
                    borderRadius: 6, background: 'rgba(248, 81, 73, 0.05)', cursor: 'pointer', width: '100%',
                  }}>
                    🧹 Reset Custom Icons
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* BGP AS Filter Panel */}
      {mapLoaded && showBgp && asCloudGroups.length > 0 && (
        <div style={{
          position: 'absolute',
          bottom: 16,
          left: 60,
          width: 300,
          maxHeight: 420,
          background: 'rgba(13, 17, 23, 0.88)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          zIndex: 1000,
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
          backdropFilter: 'blur(12px)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}>
          {/* Panel header */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '8px 12px',
            borderBottom: showAsPanel ? '1px solid rgba(255,255,255,0.08)' : 'none',
            cursor: 'pointer',
            userSelect: 'none',
          }} onClick={() => setShowAsPanel(v => !v)}>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#d859ff' }}>
              ☁ BGP Peers ({asCloudGroups.length})
              {asFilter != null && asFilter.size < asCloudGroups.length && (
                <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}> · {asFilter.size} shown</span>
              )}
            </span>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              {showAsPanel && (
                <>
                  <button onClick={e => { e.stopPropagation(); setAsFilter(new Set(asCloudGroups.map(g => g.remote_as))) }}
                    style={{ fontSize: 9, padding: '2px 6px', background: 'transparent', border: '1px solid #ffffff22', color: '#aaa', borderRadius: 4, cursor: 'pointer' }}>
                    All
                  </button>
                  <button onClick={e => {
                    e.stopPropagation()
                    const mainNums = asCloudGroups.filter(g => asRegistry[String(g.remote_as)]?.main).map(g => g.remote_as)
                    setAsFilter(new Set(mainNums.length > 0 ? mainNums : asCloudGroups.map(g => g.remote_as)))
                  }}
                    style={{ fontSize: 9, padding: '2px 6px', background: 'transparent', border: '1px solid #ffffff22', color: '#aaa', borderRadius: 4, cursor: 'pointer' }}>
                    Main
                  </button>
                  <button onClick={e => { e.stopPropagation(); setAsFilter(new Set()) }}
                    style={{ fontSize: 9, padding: '2px 6px', background: 'transparent', border: '1px solid #ffffff22', color: '#aaa', borderRadius: 4, cursor: 'pointer' }}>
                    None
                  </button>
                  {!registryEditing ? (
                    <button onClick={e => { e.stopPropagation(); setRegistryDraft({...asRegistry}); setRegistryEditing(true) }}
                      style={{ fontSize: 9, padding: '2px 6px', background: 'transparent', border: '1px solid #d859ff44', color: '#d859ff', borderRadius: 4, cursor: 'pointer' }}>
                      Edit
                    </button>
                  ) : (
                    <button onClick={e => { e.stopPropagation(); onRegistryUpdate && onRegistryUpdate(registryDraft); setRegistryEditing(false) }}
                      style={{ fontSize: 9, padding: '2px 6px', background: 'rgba(63,185,80,0.15)', border: '1px solid #3fb95066', color: '#3fb950', borderRadius: 4, cursor: 'pointer' }}>
                      Save
                    </button>
                  )}
                </>
              )}
              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{showAsPanel ? '▼' : '▶'}</span>
            </div>
          </div>

          {showAsPanel && (
            <div style={{ overflowY: 'auto', flex: 1, padding: '4px 0' }}>
              {asCloudGroups.map(group => {
                const asKey = String(group.remote_as)
                const isVisible = asFilter == null || asFilter.has(group.remote_as)
                const regEntry = asRegistry[asKey] || {}
                const isMain = registryEditing ? (registryDraft[asKey]?.main || false) : (regEntry.main || false)
                const displayName = registryEditing
                  ? (registryDraft[asKey]?.name ?? group.company_name)
                  : (group.company_name || '')
                const statusColor = group.anyEstablished ? '#3fb950' : '#f85149'

                return (
                  <div key={group.remote_as} style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '5px 12px',
                    background: isVisible ? 'rgba(255,255,255,0.03)' : 'transparent',
                    opacity: isVisible ? 1 : 0.4,
                    borderBottom: '1px solid rgba(255,255,255,0.04)',
                  }}>
                    <input type="checkbox" checked={isVisible} onChange={() => {
                      setAsFilter(prev => {
                        const next = new Set(prev || asCloudGroups.map(g => g.remote_as))
                        if (next.has(group.remote_as)) next.delete(group.remote_as)
                        else next.add(group.remote_as)
                        return next
                      })
                    }} style={{ accentColor: '#d859ff', cursor: 'pointer', flexShrink: 0 }} />
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: statusColor, flexShrink: 0, boxShadow: `0 0 4px ${statusColor}` }} />
                    <span style={{ fontSize: 9, fontWeight: 700, color: '#d859ff', fontFamily: 'monospace', flexShrink: 0, width: 46 }}>
                      AS{group.remote_as}
                    </span>
                    {registryEditing ? (
                      <input
                        value={registryDraft[asKey]?.name ?? group.company_name}
                        onChange={e => setRegistryDraft(d => ({
                          ...d,
                          [asKey]: { ...(d[asKey] || {}), name: e.target.value }
                        }))}
                        onClick={e => e.stopPropagation()}
                        placeholder="Company name"
                        style={{
                          flex: 1, fontSize: 9, background: 'rgba(255,255,255,0.07)',
                          border: '1px solid rgba(255,255,255,0.15)', borderRadius: 4,
                          color: '#e6edf3', padding: '1px 4px', outline: 'none',
                        }}
                      />
                    ) : (
                      <span style={{ flex: 1, fontSize: 10, color: '#c9d1d9', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {displayName || <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>Unknown</span>}
                      </span>
                    )}
                    {registryEditing ? (
                      <label onClick={e => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center', gap: 3, cursor: 'pointer', flexShrink: 0 }}>
                        <input type="checkbox" checked={isMain} onChange={e => setRegistryDraft(d => ({
                          ...d,
                          [asKey]: { ...(d[asKey] || {}), main: e.target.checked }
                        }))} style={{ accentColor: '#3fb950', cursor: 'pointer' }} />
                        <span style={{ fontSize: 8, color: '#3fb950' }}>Main</span>
                      </label>
                    ) : isMain ? (
                      <span style={{ fontSize: 8, color: '#3fb950', fontWeight: 700, flexShrink: 0 }}>★</span>
                    ) : null}
                    <span style={{ fontSize: 8, color: 'var(--text-muted)', flexShrink: 0 }}>{group.count}r</span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Floating Unplaced Devices Drawer — collapsible */}
      {mapLoaded && unplacedNodes.length > 0 && (
        <div style={{ ...sidebarStyle, overflow: 'hidden', padding: 0 }}>
          <div
            onClick={() => setCollapsedUnplaced(v => !v)}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '10px 16px',
              cursor: 'pointer',
              userSelect: 'none',
              borderBottom: collapsedUnplaced ? 'none' : '1px solid rgba(255,255,255,0.08)',
            }}
          >
            <h4 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: 'var(--accent)' }}>
              📍 Unplaced Devices ({unplacedNodes.length})
            </h4>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{collapsedUnplaced ? '▶' : '▼'}</span>
          </div>

          {!collapsedUnplaced && (
            <div style={{ padding: '12px 16px 16px' }}>
              <p style={{ margin: '0 0 10px 0', fontSize: 11, color: 'var(--text-muted)' }}>
                No coordinates in YAML. Click Place to drop at map center, then drag.
              </p>
              <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 240 }}>
                {unplacedNodes.map(node => (
                  <div key={node.id} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '6px 10px',
                    background: 'rgba(255, 255, 255, 0.03)',
                    borderRadius: 8,
                    border: '1px solid rgba(255,255,255,0.05)',
                  }}>
                    <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: '#e6edf3', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {node.label}
                      </span>
                      <span style={{ fontSize: 9, color: STATUS_COLOR[node.status] || STATUS_COLOR.unknown }}>
                        ● {node.status.toUpperCase()}
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                      <button
                        onClick={() => handlePlaceNode(node)}
                        style={{
                          padding: '4px 8px', fontSize: 10, fontWeight: 700,
                          color: 'var(--accent)', border: '1px solid var(--accent)',
                          borderRadius: 6, background: 'transparent', cursor: 'pointer',
                        }}
                      >Place</button>
                      {onUnplaceNode && (
                        <button
                          onClick={() => onUnplaceNode(node.id)}
                          style={{
                            padding: '4px 6px', fontSize: 10, fontWeight: 700,
                            color: 'var(--danger)', border: '1px solid rgba(248,81,73,0.4)',
                            borderRadius: 6, background: 'transparent', cursor: 'pointer',
                          }}
                          title="Remove coordinates"
                        >✕</button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ---- OSPF Path + TE Tunnel Panel (bottom-right) ---- */}
      {mapLoaded && (
        <div style={{
          position: 'absolute', bottom: 20, right: 16, zIndex: 1000,
          width: showPathPanel ? 280 : 'auto',
          background: 'rgba(13, 17, 23, 0.90)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
          backdropFilter: 'blur(12px)',
          overflow: 'hidden',
        }}>
          <div
            onClick={() => setShowPathPanel(v => !v)}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '8px 12px', cursor: 'pointer', userSelect: 'none',
              borderBottom: showPathPanel ? '1px solid rgba(255,255,255,0.08)' : 'none',
            }}
          >
            <span style={{ fontSize: 11, fontWeight: 700, color: '#f0a500' }}>
              🛣 Path &amp; TE
            </span>
            <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 8 }}>
              {showPathPanel ? '▼' : '▶'}
            </span>
          </div>

          {showPathPanel && (
            <div style={{ padding: '10px 12px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>

              <div style={{ fontSize: 10, fontWeight: 700, color: '#f0a500', marginBottom: 2 }}>
                SPF Path Calculator
              </div>

              <select value={pathSrc} onChange={e => { setPathSrc(e.target.value); setPathResult(null); setPathError(null) }} style={selectStyle}>
                <option value="">Source router…</option>
                {placedRoutersForPath.map(n => (
                  <option key={n.id} value={n.router_id}>{n.label || n.id} ({n.router_id})</option>
                ))}
              </select>

              <select value={pathDst} onChange={e => { setPathDst(e.target.value); setPathResult(null); setPathError(null) }} style={selectStyle}>
                <option value="">Destination router…</option>
                {placedRoutersForPath.filter(n => n.router_id !== pathSrc).map(n => (
                  <option key={n.id} value={n.router_id}>{n.label || n.id} ({n.router_id})</option>
                ))}
              </select>

              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  onClick={handleCalculatePath}
                  disabled={!pathSrc || !pathDst || pathLoading}
                  style={{
                    flex: 1, padding: '5px 0', fontSize: 10, fontWeight: 700,
                    background: 'rgba(240,165,0,0.15)', border: '1px solid rgba(240,165,0,0.5)',
                    color: '#f0a500', borderRadius: 6, cursor: 'pointer',
                    opacity: (!pathSrc || !pathDst || pathLoading) ? 0.5 : 1,
                  }}
                >
                  {pathLoading ? 'Calculating…' : 'Calculate Path'}
                </button>
                {pathResult && (
                  <button
                    onClick={() => { setPathResult(null); setPathError(null) }}
                    style={{
                      padding: '5px 8px', fontSize: 10, background: 'transparent',
                      border: '1px solid rgba(255,255,255,0.15)', color: '#aaa',
                      borderRadius: 6, cursor: 'pointer',
                    }}
                  >✕</button>
                )}
              </div>

              {pathError && (
                <div style={{ fontSize: 10, color: '#f85149', background: 'rgba(248,81,73,0.1)', borderRadius: 6, padding: '4px 8px' }}>
                  {pathError}
                </div>
              )}

              {pathResult && (
                <div style={{ background: 'rgba(240,165,0,0.08)', border: '1px solid rgba(240,165,0,0.25)', borderRadius: 8, padding: '6px 8px' }}>
                  <div style={{ fontSize: 9, color: '#f0a500', fontWeight: 700, marginBottom: 4 }}>
                    {pathResult.hops} hop{pathResult.hops !== 1 ? 's' : ''} · cost {pathResult.total_cost}
                  </div>
                  {pathResult.path.map((rid, i) => {
                    const node = routerIdToNode[rid]
                    return (
                      <div key={rid} style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
                        {i > 0 && <span style={{ fontSize: 8, color: '#f0a500', marginLeft: 8 }}>↓</span>}
                        <span style={{ fontSize: 9, color: '#e6edf3', fontFamily: 'monospace' }}>
                          {node ? (node.label || node.id) : rid}
                        </span>
                        {node && node.label && <span style={{ fontSize: 8, color: 'var(--text-muted)' }}>({rid})</span>}
                      </div>
                    )
                  })}
                </div>
              )}

              <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', margin: '2px 0' }} />

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: '#58a6ff' }}>
                  MPLS-TE Tunnels {teTunnelsLoading ? '⏳' : teTunnels.length > 0 ? `(${teTunnels.length})` : ''}
                </span>
                <button
                  onClick={() => setShowTeTunnels(v => !v)}
                  style={{
                    fontSize: 9, padding: '2px 8px',
                    background: showTeTunnels ? 'rgba(88,166,255,0.15)' : 'transparent',
                    border: `1px solid ${showTeTunnels ? 'rgba(88,166,255,0.5)' : 'rgba(255,255,255,0.15)'}`,
                    color: showTeTunnels ? '#58a6ff' : '#aaa',
                    borderRadius: 4, cursor: 'pointer',
                  }}
                >
                  {showTeTunnels ? 'On' : 'Off'}
                </button>
              </div>

              {showTeTunnels && teTunnels.length > 0 && (
                <div style={{ overflowY: 'auto', maxHeight: 180, display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {teTunnels.map((t, idx) => {
                    const COLORS = ['#58a6ff','#3fb950','#d859ff','#f0a500','#f85149','#79c0ff','#7ee787']
                    const color = COLORS[idx % COLORS.length]
                    const isActive = activeTunnel === t.name
                    return (
                      <div
                        key={t.name}
                        onClick={() => setActiveTunnel(n => n === t.name ? null : t.name)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 6,
                          padding: '4px 6px', borderRadius: 6, cursor: 'pointer',
                          background: isActive ? `${color}18` : 'rgba(255,255,255,0.02)',
                          border: `1px solid ${isActive ? color + '44' : 'transparent'}`,
                        }}
                      >
                        <span style={{ width: 8, height: 8, borderRadius: 2, background: color, flexShrink: 0 }} />
                        <span style={{ fontSize: 9, color: '#e6edf3', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {t.name}
                        </span>
                        <span style={{
                          fontSize: 8, padding: '1px 4px', borderRadius: 3,
                          background: t.oper === 'up' ? 'rgba(63,185,80,0.15)' : 'rgba(248,81,73,0.15)',
                          color: t.oper === 'up' ? '#3fb950' : '#f85149',
                        }}>
                          {t.oper || '?'}
                        </span>
                        <span style={{ fontSize: 8, color: 'var(--text-muted)', flexShrink: 0 }}>
                          {t.bw_kbps ? `${t.bw_kbps}k` : ''}
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}

            </div>
          )}
        </div>
      )}

      {/* Tooltip styles */}
      <style>{`
        .leaflet-conn-tooltip {
          background: #161b22 !important;
          border: 1px solid var(--border) !important;
          color: #e6edf3 !important;
          border-radius: 6px !important;
          font-size: 10px !important;
          box-shadow: 0 4px 12px rgba(0,0,0,0.5) !important;
          padding: 4px 8px !important;
        }
        .leaflet-conn-tooltip::before {
          border-top-color: #161b22 !important;
        }
        .google-marker-label {
          margin-top: -34px !important;
          background: rgba(13, 17, 23, 0.85) !important;
          border: 1px solid #30363d !important;
          border-radius: 4px !important;
          padding: 1px 6px !important;
          box-shadow: 0 2px 4px rgba(0,0,0,0.5) !important;
        }
        .spf-path-line {
          animation: dashDraw 0.5s ease-out;
        }
        @keyframes dashDraw {
          from { stroke-dashoffset: 100; }
          to   { stroke-dashoffset: 0; }
        }
      `}</style>
    </div>
  )
}
