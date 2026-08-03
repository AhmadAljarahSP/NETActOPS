import React, { useEffect, useRef, useCallback } from 'react'
import * as d3 from 'd3'

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

export const getBrandLetter = (vendor) => {
  const v = (vendor || 'cisco').toLowerCase()
  return v.includes('huawei') ? 'H' : 'C'
}

export const checkIfSwitch = (deviceType, label) => {
  const t = (deviceType || '').toLowerCase()
  const lbl = (label || '').toLowerCase()
  return t.includes('switch') || t.includes('sw') || lbl.includes('switch') || lbl.includes('tor') || lbl.includes('eor') || lbl.includes('leaf') || lbl.includes('spine')
}

export const getDeviceSymbol = (vendor, deviceType, label) => {
  const isSwitch = checkIfSwitch(deviceType, label)
  const brand = getBrandLetter(vendor)
  return brand === 'H' ? (isSwitch ? 'ⒽS' : 'ⒽR') : (isSwitch ? 'ⒸS' : 'ⒸR')
}

export default function TopologyGraph({
  nodes,
  edges,
  showOspf,
  showLldp,
  showBgp,
  selectedNode,
  onSelectNode,
  onNodeMoved,
  mapMode,
  mapImage,
  linkViewMode,
}) {
  const svgRef  = useRef(null)
  const simRef  = useRef(null)
  const gRef    = useRef(null)

  const filteredEdges = edges.filter(e =>
    (showOspf && e.protocol === 'ospf') ||
    (showLldp && e.protocol === 'lldp') ||
    (showBgp && e.protocol === 'bgp') ||
    (e.protocol === 'unknown')
  )

  const draw = useCallback(() => {
    if (!svgRef.current || !nodes.length) return

    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()

    const W = svgRef.current.clientWidth
    const H = svgRef.current.clientHeight

    // Zoom / pan
    const zoom = d3.zoom().scaleExtent([0.1, 5]).on('zoom', (event) => {
      g.attr('transform', event.transform)
    })
    svg.call(zoom)

    // Background map image (optional)
    if (mapMode && mapImage) {
      svg.append('image')
        .attr('href', mapImage)
        .attr('width', W)
        .attr('height', H)
        .attr('preserveAspectRatio', 'xMidYMid meet')
        .style('opacity', 0.35)
    }

    const g = svg.append('g')
    gRef.current = g

    // Arrow markers
    svg.append('defs').selectAll('marker')
      .data(['ospf', 'lldp', 'bgp', 'unknown', 'down'])
      .join('marker')
      .attr('id', d => `arrow-${d}`)
      .attr('viewBox', '0 -5 10 10')
      .attr('refX', 22)
      .attr('refY', 0)
      .attr('markerWidth', 6)
      .attr('markerHeight', 6)
      .attr('orient', 'auto')
      .append('path')
      .attr('fill', d => d === 'down' ? '#f85149' : PROTOCOL_COLOR[d])
      .attr('d', 'M0,-5L10,0L0,5')

    // Prepare node map
    const nodeMap = new Map(nodes.map(n => [n.id, { ...n }]))

    // Assign initial positions
    nodeMap.forEach(n => {
      if (n.x != null && n.y != null) {
        n.fx = n.x * W
        n.fy = n.y * H
      } else {
        n.x = W / 2 + (Math.random() - 0.5) * 300
        n.y = H / 2 + (Math.random() - 0.5) * 300
      }
    })

    const nodeArr = Array.from(nodeMap.values())
    let edgeArr = filteredEdges.map(e => ({
      ...e,
      source: nodeMap.get(e.source) || e.source,
      target: nodeMap.get(e.target) || e.target,
    })).filter(e => typeof e.source === 'object' && typeof e.target === 'object')

    // Handle logical vs physical links mode
    if (linkViewMode === 'logical') {
      const mergedMap = new Map()
      edgeArr.forEach(e => {
        const key = [e.source.id, e.target.id].sort().join('-')
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
      edgeArr = Array.from(mergedMap.values())
    } else {
      // Group by node-pair keys to set pairIndex and pairCount for physical view curves
      const edgesByPair = {}
      edgeArr.forEach(e => {
        const key = [e.source.id, e.target.id].sort().join('-')
        if (!edgesByPair[key]) edgesByPair[key] = []
        edgesByPair[key].push(e)
      })
      edgeArr.forEach(e => {
        const key = [e.source.id, e.target.id].sort().join('-')
        const list = edgesByPair[key]
        e.pairIndex = list.indexOf(e)
        e.pairCount = list.length
      })
    }

    // Force simulation
    const sim = d3.forceSimulation(nodeArr)
      .force('link', d3.forceLink(edgeArr).id(d => d.id).distance(120))
      .force('charge', d3.forceManyBody().strength(-300))
      .force('center', d3.forceCenter(W / 2, H / 2))
      .force('collision', d3.forceCollide(35))
    simRef.current = sim

    const hasHighlight = nodeArr.some(n => n.highlight)

    // Edges
    const link = g.append('g').selectAll('path')
      .data(edgeArr)
      .join('path')
      .attr('fill', 'none')
      .attr('stroke', d => d.status === 'down' ? '#f85149' : (PROTOCOL_COLOR[d.protocol] || PROTOCOL_COLOR.unknown))
      .attr('stroke-width', d => hasHighlight ? ((d.source.highlight || d.target.highlight) ? 2.5 : 1) : 1.5)
      .attr('stroke-opacity', d => hasHighlight ? ((d.source.highlight || d.target.highlight) ? 0.95 : 0.2) : 0.7)
      .attr('marker-end', d => `url(#arrow-${d.status === 'down' ? 'down' : d.protocol})`)

    // Edge labels
    const linkLabel = g.append('g').selectAll('text')
      .data(edgeArr)
      .join('text')
      .attr('font-size', 9)
      .attr('fill', '#8b949e')
      .attr('text-anchor', 'middle')
      .text(d => d.local_interface || '')

    // Nodes
    const node = g.append('g').selectAll('g')
      .data(nodeArr)
      .join('g')
      .attr('cursor', 'pointer')
      .style('opacity', d => hasHighlight ? (d.highlight ? 1 : 0.45) : 1)
      .call(d3.drag()
        .on('start', (event, d) => {
          if (!event.active) sim.alphaTarget(0.3).restart()
          d.fx = d.x
          d.fy = d.y
        })
        .on('drag', (event, d) => {
          d.fx = event.x
          d.fy = event.y
        })
        .on('end', (event, d) => {
          if (!event.active) sim.alphaTarget(0)
          // Save normalized coordinates
          onNodeMoved(d.id, d.fx / W, d.fy / H)
        })
      )
      .on('click', (event, d) => {
        event.stopPropagation()
        onSelectNode(d.id === selectedNode ? null : d.id)
      })

    // Node circle and inner shapes based on device type
    node.each(function(d) {
      const el = d3.select(this)
      const color = STATUS_COLOR[d.status] || STATUS_COLOR.unknown
      const isSelected = d.id === selectedNode
      const isHighlighted = d.highlight
      const brand = getBrandLetter(d.vendor)
      const isSwitch = checkIfSwitch(d.device_type, d.label)
      const fillBg = d.status === 'unknown' ? '#21262d' : '#0d1117'
      const dropShadow = isHighlighted ? `drop-shadow(0px 0px 8px ${color})` : null

      if (isSwitch) {
        // Draw Switch rounded rect
        el.append('rect')
          .attr('class', 'outline')
          .attr('x', -14)
          .attr('y', -14)
          .attr('width', 28)
          .attr('height', 28)
          .attr('rx', 4)
          .attr('fill', fillBg)
          .attr('stroke', color)
          .attr('stroke-width', isSelected ? 3.5 : (isHighlighted ? 3.5 : 1.5))
          .style('filter', dropShadow)

        // Draw Switch parallel arrows
        el.append('path')
          .attr('d', 'M -9,-3.5 L 9,-3.5 M 6,-6 L 9,-3.5 L 6,-1 M 9,3.5 L -9,3.5 M -6,1 L -9,3.5 L -6,6')
          .attr('stroke', color)
          .attr('stroke-width', 1.2)
          .attr('fill', 'none')
      } else {
        // Draw Router circle
        el.append('circle')
          .attr('class', 'outline')
          .attr('r', 14)
          .attr('fill', fillBg)
          .attr('stroke', color)
          .attr('stroke-width', isSelected ? 3.5 : (isHighlighted ? 3.5 : 1.5))
          .style('filter', dropShadow)

        // Draw Router 4-way arrows
        el.append('path')
          .attr('d', 'M -9,-9 L -3.5,-3.5 M -6,-3.5 L -3.5,-3.5 M -3.5,-6 L -3.5,-3.5 M 9,9 L 3.5,3.5 M 6,3.5 L 3.5,3.5 M 3.5,6 L 3.5,3.5 M 3.5,-3.5 L 9,-9 M 6,-9 L 9,-9 M 9,-6 L 9,-9 M -3.5,3.5 L -9,9 M -6,9 L -9,9 M -9,6 L -9,9')
          .attr('stroke', color)
          .attr('stroke-width', 1.2)
          .attr('fill', 'none')
      }

      // Draw center brand badge
      el.append('circle')
        .attr('cx', 0)
        .attr('cy', 0)
        .attr('r', 4.5)
        .attr('fill', '#0d1117')
        .attr('stroke', color)
        .attr('stroke-width', 0.75)

      el.append('text')
        .attr('x', 0)
        .attr('y', 0.5)
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'central')
        .attr('font-size', 7)
        .attr('font-weight', '900')
        .attr('font-family', 'sans-serif')
        .attr('fill', color)
        .text(brand)
    })

    // Node label
    node.append('text')
      .attr('y', 24)
      .attr('text-anchor', 'middle')
      .attr('font-size', 9)
      .attr('fill', '#e6edf3')
      .text(d => d.label.length > 20 ? d.label.slice(0, 18) + '…' : d.label)

    // IP label
    node.append('text')
      .attr('y', 34)
      .attr('text-anchor', 'middle')
      .attr('font-size', 8)
      .attr('fill', '#6e7681')
      .text(d => d.ip ? (d.local_as ? `${d.ip} (AS ${d.local_as})` : d.ip) : '')

    // Deselect on canvas click
    svg.on('click', () => onSelectNode(null))

    sim.on('tick', () => {
      link.attr('d', d => {
        const x1 = d.source.x
        const y1 = d.source.y
        const x2 = d.target.x
        const y2 = d.target.y

        if (d.pairCount <= 1 || linkViewMode === 'logical') {
          return `M ${x1} ${y1} L ${x2} ${y2}`
        }

        const curvature = (d.pairIndex - (d.pairCount - 1) / 2) * 0.25
        const isReversed = d.source.id > d.target.id
        const q1 = isReversed ? d.target : d.source
        const q2 = isReversed ? d.source : d.target
        const dx = q2.x - q1.x
        const dy = q2.y - q1.y
        const L = Math.sqrt(dx * dx + dy * dy) || 1
        const nx = -dy / L
        const ny = dx / L

        const xm = (x1 + x2) / 2
        const ym = (y1 + y2) / 2
        const xc = xm + curvature * L * nx
        const yc = ym + curvature * L * ny

        return `M ${x1} ${y1} Q ${xc} ${yc} ${x2} ${y2}`
      })

      linkLabel
        .attr('x', d => {
          const x1 = d.source.x
          const x2 = d.target.x
          if (d.pairCount <= 1 || linkViewMode === 'logical') {
            return (x1 + x2) / 2
          }
          const curvature = (d.pairIndex - (d.pairCount - 1) / 2) * 0.25
          const isReversed = d.source.id > d.target.id
          const q1 = isReversed ? d.target : d.source
          const q2 = isReversed ? d.source : d.target
          const dx = q2.x - q1.x
          const dy = q2.y - q1.y
          const L = Math.sqrt(dx * dx + dy * dy) || 1
          const nx = -dy / L
          const xm = (x1 + x2) / 2
          const xc = xm + curvature * L * nx
          return 0.25 * x1 + 0.5 * xc + 0.25 * x2
        })
        .attr('y', d => {
          const y1 = d.source.y
          const y2 = d.target.y
          if (d.pairCount <= 1 || linkViewMode === 'logical') {
            return (y1 + y2) / 2 - 4
          }
          const curvature = (d.pairIndex - (d.pairCount - 1) / 2) * 0.25
          const isReversed = d.source.id > d.target.id
          const q1 = isReversed ? d.target : d.source
          const q2 = isReversed ? d.source : d.target
          const dx = q2.x - q1.x
          const dy = q2.y - q1.y
          const L = Math.sqrt(dx * dx + dy * dy) || 1
          const ny = dx / L
          const ym = (y1 + y2) / 2
          const yc = ym + curvature * L * ny
          return 0.25 * y1 + 0.5 * yc + 0.25 * y2 - 4
        })

      node.attr('transform', d => `translate(${d.x},${d.y})`)
    })

    return () => sim.stop()
  }, [nodes, filteredEdges, selectedNode, mapMode, mapImage, linkViewMode]) // eslint-disable-line

  useEffect(() => {
    const cleanup = draw()
    return () => {
      simRef.current?.stop()
      if (cleanup) cleanup()
    }
  }, [draw])

  // Highlight selected node
  useEffect(() => {
    if (!gRef.current) return
    gRef.current.selectAll('circle.outline, rect.outline')
      .attr('stroke-width', d => d.id === selectedNode ? 3 : 1.5)
  }, [selectedNode])

  return (
    <svg
      ref={svgRef}
      style={{ width: '100%', height: '100%', background: 'var(--bg)' }}
    />
  )
}
