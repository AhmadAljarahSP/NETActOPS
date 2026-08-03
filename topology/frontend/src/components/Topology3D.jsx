import React, { useEffect, useRef, useCallback, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import gsap from 'gsap'

// ─────────────────────────────────────────────────────────────────────────────
// Constants & Color Palette
// ─────────────────────────────────────────────────────────────────────────────
const PALETTE = {
  bg:       0x020610,
  gridLine: 0x0a2040,
  ospf:     '#00d4ff',
  lldp:     '#00ff9f',
  bgp:      '#d859ff',
  unknown:  '#6e7681',
}

const STATUS_COLOR = {
  ok:        '#00e676',
  warning:   '#ffca28',
  error:     '#ff1744',
  auth_fail: '#ff1744',
  unknown:   '#546e7a',
}

const DEVICE_COLOR = {
  router:   '#00d4ff',
  switch:   '#00e676',
  firewall: '#ff4757',
  ap:       '#d500f9',
  default:  '#448aff',
}

const PROTOCOL_COLOR = {
  ospf:    PALETTE.ospf,
  lldp:    PALETTE.lldp,
  bgp:     PALETTE.bgp,
  unknown: PALETTE.unknown,
}
const DEVICE_ICON = {
  router:   '◈',
  switch:   '◉',
  firewall: '⬡',
  ap:       '◇',
  default:  '□',
}

function latencyToColor(rtt_avg) {
  if (!rtt_avg || rtt_avg <= 0) return null
  if (rtt_avg < 50)  return '#00e676'  // green  — excellent
  if (rtt_avg < 100) return '#69f0ae'  // lt-green — good
  if (rtt_avg < 150) return '#ffca28'  // amber  — warning threshold
  if (rtt_avg < 250) return '#ff9800'  // orange — critical threshold
  return '#ff1744'                      // red    — down/unusable
}


// ─────────────────────────────────────────────────────────────────────────────
// Galaxy Themes — extended palette (8 themes)
// ─────────────────────────────────────────────────────────────────────────────
export const GALAXY_THEMES = {
  cosmic: {
    label: 'Cosmic Nebula',
    c1: '#8a008a', c2: '#0044cc', c3: '#00aacc', // vibrant magenta, blue, teal
    corePrimary: '#e040fb', coreSecondary: '#00e5ff', // magenta and cyan
    star1: ['#ffffff', '#ff80ab'], star2: ['#00ffff', '#ffffff'],
  },
  nebula: {
    label: 'Nebula',
    c1: '#1a0533', c2: '#060d2e', c3: '#001a2e',
    corePrimary: '#4fc3f7', coreSecondary: '#ab47bc',
    star1: ['#ffffff', '#aaccff'], star2: ['#ffddaa', '#ffaaff'],
  },
  aurora: {
    label: 'Aurora',
    c1: '#001a10', c2: '#001528', c3: '#0a002a',
    corePrimary: '#00e676', coreSecondary: '#00b0ff',
    star1: ['#aaffdd', '#00ffcc'], star2: ['#ffffff', '#88ffee'],
  },
  crimson: {
    label: 'Crimson Void',
    c1: '#1a0005', c2: '#0d0010', c3: '#120020',
    corePrimary: '#ff1744', coreSecondary: '#ff6d00',
    star1: ['#ffaaaa', '#ff4466'], star2: ['#ffddaa', '#ffaacc'],
  },
  solar: {
    label: 'Solar Flare',
    c1: '#1a0e00', c2: '#0d0600', c3: '#0a0f00',
    corePrimary: '#ffca28', coreSecondary: '#ff6f00',
    star1: ['#ffffff', '#ffffaa'], star2: ['#ffeeaa', '#ffcc44'],
  },
  arctic: {
    label: 'Arctic',
    c1: '#001428', c2: '#001f30', c3: '#000e1a',
    corePrimary: '#80d8ff', coreSecondary: '#e0f7fa',
    star1: ['#ffffff', '#ccf0ff'], star2: ['#aaddff', '#ffffff'],
  },
  void: {
    label: 'Deep Void',
    c1: '#000000', c2: '#030308', c3: '#050510',
    corePrimary: '#7c4dff', coreSecondary: '#e040fb',
    star1: ['#ccaaff', '#ff88ff'], star2: ['#ffffff', '#aaaaff'],
  },
  matrix: {
    label: 'Matrix',
    c1: '#001500', c2: '#000d00', c3: '#000800',
    corePrimary: '#00e676', coreSecondary: '#76ff03',
    star1: ['#00ff41', '#aaff88'], star2: ['#ffffff', '#88ff88'],
  },
  supernova: {
    label: 'Supernova',
    c1: '#100028', c2: '#200010', c3: '#0a1000',
    corePrimary: '#ff6d00', coreSecondary: '#d500f9',
    star1: ['#ffcc80', '#ff80ab'], star2: ['#ffffff', '#ffddaa'],
  },
  neonTokyo: {
    label: 'Neon Tokyo',
    c1: '#0d0021', c2: '#180030', c3: '#050018',
    corePrimary: '#ff006e', coreSecondary: '#00f5ff',
    star1: ['#ff006e', '#ff80ff'], star2: ['#00f5ff', '#ffffff'],
  },
  abyssal: {
    label: 'Abyssal Ocean',
    c1: '#000d1a', c2: '#001a2e', c3: '#000810',
    corePrimary: '#00e5cc', coreSecondary: '#0091ea',
    star1: ['#00e5cc', '#aaffee'], star2: ['#40c4ff', '#ffffff'],
  },
  toxicWaste: {
    label: 'Toxic Waste',
    c1: '#0a0020', c2: '#080018', c3: '#030012',
    corePrimary: '#c6ff00', coreSecondary: '#76ff03',
    star1: ['#c6ff00', '#eeff41'], star2: ['#b2ff59', '#ffffff'],
  },
  bloodMoon: {
    label: 'Blood Moon',
    c1: '#130000', c2: '#1a0005', c3: '#0a000a',
    corePrimary: '#ff1744', coreSecondary: '#ff6090',
    star1: ['#ffcdd2', '#ff8a80'], star2: ['#ffffff', '#ffccbc'],
  },
  midnightGold: {
    label: 'Midnight Gold',
    c1: '#050400', c2: '#0a0800', c3: '#030300',
    corePrimary: '#ffd600', coreSecondary: '#ff6f00',
    star1: ['#ffd600', '#ffffff'], star2: ['#ffe57f', '#ffecb3'],
  },
  hyperspace: {
    label: 'Hyperspace',
    c1: '#00001a', c2: '#000528', c3: '#00001f',
    corePrimary: '#448aff', coreSecondary: '#e8f5e9',
    star1: ['#ffffff', '#aabbff'], star2: ['#8eb4ff', '#ffffff'],
  },
  phantomGlass: {
    label: 'Phantom Glass',
    c1: '#090910', c2: '#0d0d18', c3: '#060610',
    corePrimary: '#b0bec5', coreSecondary: '#eceff1',
    star1: ['#ffffff', '#cfd8dc'], star2: ['#eceff1', '#90a4ae'],
  },
  obsidianFire: {
    label: 'Obsidian Fire',
    c1: '#0f0800', c2: '#180c00', c3: '#0a0500',
    corePrimary: '#ff3d00', coreSecondary: '#ff9100',
    star1: ['#ff6e40', '#ffccbc'], star2: ['#ffffff', '#ffab91'],
  },
  galacticMint: {
    label: 'Galactic Mint',
    c1: '#001510', c2: '#001a18', c3: '#000d0a',
    corePrimary: '#1de9b6', coreSecondary: '#00bcd4',
    star1: ['#a7ffeb', '#1de9b6'], star2: ['#ffffff', '#b2ebf2'],
  },
  violetStorm: {
    label: 'Violet Storm',
    c1: '#0e0018', c2: '#160022', c3: '#080010',
    corePrimary: '#d500f9', coreSecondary: '#651fff',
    star1: ['#ea80ff', '#ce93d8'], star2: ['#ffffff', '#b39ddb'],
  },
  ironCitadel: {
    label: 'Iron Citadel',
    c1: '#080808', c2: '#0f0f0f', c3: '#050505',
    corePrimary: '#78909c', coreSecondary: '#37474f',
    star1: ['#cfd8dc', '#ffffff'], star2: ['#90a4ae', '#b0bec5'],
  },
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
export const checkIfSwitch = (deviceType, label) => {
  const t   = (deviceType || '').toLowerCase()
  const lbl = (label || '').toLowerCase()
  return t.includes('switch') || t.includes('sw') || lbl.includes('switch') ||
         lbl.includes('tor') || lbl.includes('eor') || lbl.includes('leaf') || lbl.includes('spine')
}

function classifyDevice(n) {
  const t   = (n.device_type || '').toLowerCase()
  const lbl = (n.label || '').toLowerCase()
  if (t.includes('firewall') || t.includes('fw') || lbl.includes('fw') || lbl.includes('asa')) return 'firewall'
  if (t.includes('switch')   || t.includes('sw') || lbl.includes('sw'))                        return 'switch'
  if (t.includes('router')   || t.includes('rt') || lbl.includes('rt') || lbl.includes('rtr')) return 'router'
  if (t.includes('ap')       || t.includes('wifi') || lbl.includes('ap'))                       return 'ap'
  return 'default'
}

function getNodeColor(n, theme) {
  if (n.status === 'warning')   return STATUS_COLOR.warning
  if (n.status === 'error' || n.status === 'auth_fail') return STATUS_COLOR.error
  
  const type = classifyDevice(n)
  if (theme) {
    if (type === 'router') return theme.corePrimary
    if (type === 'switch') return theme.coreSecondary
    return theme.corePrimary
  }
  return DEVICE_COLOR[type] || DEVICE_COLOR.default
}

function makeGlowTexture(hex, size = 128) {
  const canvas = document.createElement('canvas')
  canvas.width  = size
  canvas.height = size
  const ctx  = canvas.getContext('2d')
  const half = size / 2
  const grad = ctx.createRadialGradient(half, half, 0, half, half, half)
  grad.addColorStop(0.00, hex)
  grad.addColorStop(0.12, hex)
  grad.addColorStop(0.35, hex + '66')
  grad.addColorStop(0.65, hex + '18')
  grad.addColorStop(1.00, 'rgba(0,0,0,0)')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, size, size)
  return new THREE.CanvasTexture(canvas)
}

function makeNodeGeometry(type) {
  switch (type) {
    case 'router':   return new THREE.IcosahedronGeometry(1.1, 1)
    case 'switch':   return new THREE.OctahedronGeometry(1.15, 0)
    case 'firewall': return new THREE.TetrahedronGeometry(1.3, 0)
    case 'ap':       return new THREE.SphereGeometry(1.0, 16, 16)
    default:         return new THREE.BoxGeometry(1.4, 0.7, 1.1)
  }
}

function makeNodeMaterial(hex) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime:       { value: 0 },
      uColor:      { value: new THREE.Color(hex) },
      uBrightness: { value: 1.0 },
      uSelected:   { value: 0.0 },
      uHovered:    { value: 0.0 },
    },
    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vWorldPos;
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vNormal = normalize(normalMatrix * normal);
        vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform vec3  uColor;
      uniform float uBrightness;
      uniform float uSelected;
      uniform float uHovered;
      varying vec3 vNormal;
      varying vec3 vWorldPos;
      varying vec2 vUv;
      void main() {
        vec3 viewDir = normalize(cameraPosition - vWorldPos);
        float fresnel = pow(1.0 - clamp(dot(viewDir, vNormal), 0.0, 1.0), 2.8);
        float scan = sin(vWorldPos.y * 18.0 - uTime * 2.5) * 0.5 + 0.5;
        scan = smoothstep(0.35, 0.65, scan) * 0.18;
        vec2 grid = abs(fract(vUv * 6.0) - 0.5);
        float hex = max(grid.x, grid.y);
        float gridPulse = smoothstep(0.46, 0.5, hex) * 0.12;
        vec3 col = uColor * (0.55 + scan + gridPulse);
        col += uColor * fresnel * 1.8;
        col *= uBrightness;
        float selPulse = sin(uTime * 4.0) * 0.5 + 0.5;
        col += uColor * uSelected * selPulse * 1.2;
        col += uColor * uHovered * 0.6;
        float alpha = clamp(0.85 + fresnel * 0.15, 0.0, 1.0);
        gl_FragColor = vec4(col, alpha);
      }
    `,
    transparent: true,
    side: THREE.DoubleSide,
  })
}

function makeLinkMaterial(hex, isDown) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime:    { value: 0 },
      uColor:   { value: new THREE.Color(hex) },
      uOpacity: { value: isDown ? 0.9 : 0.45 },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform vec3  uColor;
      uniform float uOpacity;
      varying vec2  vUv;
      void main() {
        float t    = fract(vUv.x * 5.0 - uTime * 0.7);
        float pulse = smoothstep(0.0, 0.15, t) * smoothstep(0.35, 0.15, t);
        float radial = 1.0 - vUv.y * 2.0;
        float rim    = pow(abs(radial), 1.5);
        vec3 col   = uColor * (0.3 + pulse * 2.0 + rim * 0.4);
        float alpha = uOpacity * (0.5 + pulse * 0.7);
        gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  })
}

function makeNebulaMaterial(theme) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uC1:   { value: new THREE.Color(theme.c1) },
      uC2:   { value: new THREE.Color(theme.c2) },
      uC3:   { value: new THREE.Color(theme.c3) },
    },
    vertexShader: `
      varying vec3 vWorldPos;
      void main() {
        vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform vec3 uC1;
      uniform vec3 uC2;
      uniform vec3 uC3;
      varying vec3 vWorldPos;
      float hash(vec3 p) {
        p = fract(p * vec3(443.897, 441.423, 437.195));
        p += dot(p, p.yzx + 19.19);
        return fract((p.x + p.y) * p.z);
      }
      float noise(vec3 p) {
        vec3 i = floor(p); vec3 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
          mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z
        );
      }
      float fbm(vec3 p) {
        float v = 0.0; float amp = 0.5;
        for (int i = 0; i < 5; i++) { v += amp * noise(p); p *= 2.1; amp *= 0.5; }
        return v;
      }
      void main() {
        vec3 dir = normalize(vWorldPos);
        float t  = uTime * 0.012;
        float n1 = fbm(dir * 2.8 + vec3(t*0.6,t*0.3,t*0.4));
        float n2 = fbm(dir * 4.2 + vec3(-t*0.5,t*0.7,-t*0.3) + 5.3);
        float n3 = fbm(dir * 7.5 + vec3(t*0.2,-t*0.4,t*0.6) + 11.7);
        vec3 c1 = uC1 * smoothstep(0.3, 0.75, n1);
        vec3 c2 = uC2 * smoothstep(0.4, 0.8, n2);
        vec3 c3 = uC3 * smoothstep(0.5, 0.85, n3);
        vec3 col = c1 + c2 + c3;
        col = clamp(col, 0.0, 1.0);
        float vig = smoothstep(0.6, 1.0, abs(dir.y));
        col *= (1.0 - vig * 0.5);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
    side: THREE.BackSide,
    depthWrite: false,
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Node label card (matches screenshot style)
// labelMode: 'name' | 'name_ip' | 'hidden'
// ─────────────────────────────────────────────────────────────────────────────
function createNodeLabel(n, colorHex, labelMode, edgeCount = 0) {
  const div  = document.createElement('div')
  const type = classifyDevice(n)
  const icon = DEVICE_ICON[type] || '■'
  const statusColor = STATUS_COLOR[n.status] || STATUS_COLOR.unknown
  const statusText  = (n.status || 'UNKNOWN').toUpperCase()

  div.style.cssText = `
    font-family: 'Courier New', monospace;
    pointer-events: none;
    user-select: none;
    white-space: nowrap;
    background: rgba(2,6,16,0.88);
    border: 1px solid ${colorHex}88;
    border-radius: 6px;
    padding: 6px 10px;
    min-width: 140px;
    box-shadow: 0 0 14px ${colorHex}33, inset 0 0 8px rgba(0,0,0,0.5);
    backdrop-filter: blur(6px);
  `

  if (labelMode === 'name') {
    const labelText = n.local_as ? `${n.label} (AS ${n.local_as})` : n.label
    div.innerHTML = `
      <div style="display:flex;align-items:center;gap:5px;border-bottom:1px solid ${colorHex}44;padding-bottom:4px;margin-bottom:4px;">
        <span style="color:${colorHex};font-size:13px;line-height:1;">${icon}</span>
        <span style="color:${colorHex};font-weight:bold;font-size:11px;letter-spacing:0.5px;">${labelText}</span>
      </div>
      <div style="display:flex;align-items:center;gap:5px;">
        <span style="width:7px;height:7px;border-radius:50%;background:${statusColor};flex-shrink:0;box-shadow:0 0 5px ${statusColor};"></span>
        <span style="color:${statusColor};font-size:9px;letter-spacing:1px;">${statusText}</span>
      </div>
      <div style="color:#4a6080;font-size:9px;margin-top:3px;letter-spacing:0.8px;">${type.toUpperCase()} · ${edgeCount} LINKS</div>
    `
  } else if (labelMode === 'name_ip') {
    const ipText = n.ip ? (n.local_as ? `⬡ ${n.ip} (AS ${n.local_as})` : `⬡ ${n.ip}`) : ''
    div.innerHTML = `
      <div style="display:flex;align-items:center;gap:5px;border-bottom:1px solid ${colorHex}44;padding-bottom:4px;margin-bottom:4px;">
        <span style="color:${colorHex};font-size:13px;line-height:1;">${icon}</span>
        <span style="color:${colorHex};font-weight:bold;font-size:11px;letter-spacing:0.5px;">${n.label}</span>
      </div>
      ${ipText ? `<div style="color:#7ecfff;font-size:9px;margin-bottom:3px;letter-spacing:0.5px;">${ipText}</div>` : ''}
      <div style="display:flex;align-items:center;gap:5px;">
        <span style="width:7px;height:7px;border-radius:50%;background:${statusColor};flex-shrink:0;box-shadow:0 0 5px ${statusColor};"></span>
        <span style="color:${statusColor};font-size:9px;letter-spacing:1px;">${statusText}</span>
      </div>
      <div style="color:#4a6080;font-size:9px;margin-top:3px;letter-spacing:0.8px;">${type.toUpperCase()} · ${edgeCount} LINKS</div>
    `
  }
  // 'hidden' → empty div (invisible)
  return div
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────
export default function Topology3D({
  nodes,
  edges,
  showOspf,
  showLldp,
  showBgp,
  selectedNode,
  onSelectNode,
  onNodeMoved,
  linkViewMode,
  galaxyTheme   = 'cosmic',
  labelMode     = 'name',       // 'name' | 'name_ip' | 'hidden'
  focusNodeId   = null,
  rightPanelOpen = false,       // NEW: pass true when detail panel is visible
}) {
  const containerRef   = useRef(null)
  const [webglError, setWebglError] = useState(false)
  const sceneRef       = useRef(null)
  const rendererRef    = useRef(null)
  const tooltipDivRef  = useRef(null)
  const selectedRef    = useRef(selectedNode)
  const meshMapRef     = useRef(null)
  const controlsRef    = useRef(null)
  const cameraRef      = useRef(null)
  const labelMapRef    = useRef(null)

  const handleScreenshot = useCallback(() => {
    const renderer = rendererRef.current
    if (!renderer) return
    // Force one extra render so preserveDrawingBuffer has latest frame
    const scene  = sceneRef.current
    const camera = cameraRef.current
    if (scene && camera) renderer.render(scene, camera)
    const url  = renderer.domElement.toDataURL('image/png')
    const link = document.createElement('a')
    link.href     = url
    link.download = `netact-topology-${Date.now()}.png`
    link.click()
  }, [])

  useEffect(() => { selectedRef.current = selectedNode }, [selectedNode])

  // ── Toggle label mode without scene rebuild ──
  useEffect(() => {
    const lm = labelMapRef.current
    if (!lm) return
    lm.forEach(({ obj, div, node, colorHex, edgeCount }) => {
      if (labelMode === 'hidden') {
        obj.visible = false
        return
      }
      obj.visible = true
      const type        = classifyDevice(node)
      const icon        = DEVICE_ICON[type] || '■'
      const statusColor = STATUS_COLOR[node.status] || STATUS_COLOR.unknown
      const statusText  = (node.status || 'UNKNOWN').toUpperCase()
      if (labelMode === 'name') {
        const labelText = node.local_as ? `${node.label} (AS ${node.local_as})` : node.label
        div.innerHTML = `
          <div style="display:flex;align-items:center;gap:5px;border-bottom:1px solid ${colorHex}44;padding-bottom:4px;margin-bottom:4px;">
            <span style="color:${colorHex};font-size:13px;line-height:1;">${icon}</span>
            <span style="color:${colorHex};font-weight:bold;font-size:11px;letter-spacing:0.5px;">${labelText}</span>
          </div>
          <div style="display:flex;align-items:center;gap:5px;">
            <span style="width:7px;height:7px;border-radius:50%;background:${statusColor};flex-shrink:0;box-shadow:0 0 5px ${statusColor};"></span>
            <span style="color:${statusColor};font-size:9px;letter-spacing:1px;">${statusText}</span>
          </div>
          <div style="color:#4a6080;font-size:9px;margin-top:3px;letter-spacing:0.8px;">${type.toUpperCase()} · ${edgeCount} LINKS</div>
        `
      } else if (labelMode === 'name_ip') {
        const ipText = node.ip ? (node.local_as ? `⬡ ${node.ip} (AS ${node.local_as})` : `⬡ ${node.ip}`) : ''
        div.innerHTML = `
          <div style="display:flex;align-items:center;gap:5px;border-bottom:1px solid ${colorHex}44;padding-bottom:4px;margin-bottom:4px;">
            <span style="color:${colorHex};font-size:13px;line-height:1;">${icon}</span>
            <span style="color:${colorHex};font-weight:bold;font-size:11px;letter-spacing:0.5px;">${node.label}</span>
          </div>
          ${ipText ? `<div style="color:#7ecfff;font-size:9px;margin-bottom:3px;letter-spacing:0.5px;">${ipText}</div>` : ''}
          <div style="display:flex;align-items:center;gap:5px;">
            <span style="width:7px;height:7px;border-radius:50%;background:${statusColor};flex-shrink:0;box-shadow:0 0 5px ${statusColor};"></span>
            <span style="color:${statusColor};font-size:9px;letter-spacing:1px;">${statusText}</span>
          </div>
          <div style="color:#4a6080;font-size:9px;margin-top:3px;letter-spacing:0.8px;">${type.toUpperCase()} · ${edgeCount} LINKS</div>
        `
      }
    })
  }, [labelMode])

  // ── Zoom out when right panel closes ──
  useEffect(() => {
    const camera   = cameraRef.current
    const controls = controlsRef.current
    if (!camera || !controls) return
    if (!rightPanelOpen) {
      // Panel just closed — zoom back to overview
      gsap.to(controls.target, { x: 0, y: 0, z: 0, duration: 1.2, ease: 'power3.inOut' })
      gsap.to(camera.position, {
        x: 0, y: 30, z: 80,
        duration: 1.2, ease: 'power3.inOut',
        onUpdate: () => controls.update(),
      })
    }
  }, [rightPanelOpen])

  // ── Focus camera on node from node list ──
  useEffect(() => {
    if (!focusNodeId) return
    const nodeId   = focusNodeId.split('_')[0]
    const mesh     = meshMapRef.current?.get(nodeId)
    const camera   = cameraRef.current
    const controls = controlsRef.current
    if (!mesh || !camera || !controls) return
    const pos = mesh.position
    gsap.to(controls.target, { x: pos.x, y: pos.y, z: pos.z, duration: 1.0, ease: 'power3.out' })
    gsap.to(camera.position, { x: pos.x * 1.4 + 8, y: pos.y + 6, z: pos.z * 1.4 + 14, duration: 1.0, ease: 'power3.out' })
  }, [focusNodeId])

  const filteredEdges = edges.filter(e =>
    (showOspf && e.protocol === 'ospf') ||
    (showLldp && e.protocol === 'lldp') ||
    (showBgp && e.protocol === 'bgp') ||
    (e.protocol === 'unknown')
  )

  const nodesKey = nodes.map(n => n.id).join(',')
  const edgesKey = filteredEdges.length + '|' + showOspf + '|' + showLldp + '|' + showBgp

  useEffect(() => {
    if (!containerRef.current || !nodes.length) return

    // WebGL Availability Check
    try {
      const canvas = document.createElement('canvas');
      const hasWebGL = !!(window.WebGLRenderingContext && (canvas.getContext('webgl') || canvas.getContext('experimental-webgl')));
      if (!hasWebGL) {
        setWebglError(true)
        return
      }
    } catch (e) {
      setWebglError(true)
      return
    }

    const container = containerRef.current
    let W = container.clientWidth
    let H = container.clientHeight

    const scene    = new THREE.Scene()
    sceneRef.current = scene

    const camera = new THREE.PerspectiveCamera(50, W / H, 0.1, 1200)
    camera.position.set(0, 30, 80)

    let renderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: true })
    } catch (err) {
      console.warn("Failed to create WebGLRenderer:", err)
      setWebglError(true)
      return
    }
    rendererRef.current = renderer
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(W, H)
    renderer.toneMapping         = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.3
    renderer.outputColorSpace    = THREE.SRGBColorSpace
    container.appendChild(renderer.domElement)

    const labelRenderer = new CSS2DRenderer()
    labelRenderer.setSize(W, H)
    Object.assign(labelRenderer.domElement.style, {
      position: 'absolute', top: '0px', left: '0px',
      pointerEvents: 'none', width: '100%', height: '100%',
    })
    container.appendChild(labelRenderer.domElement)

    const renderPass = new RenderPass(scene, camera)
    const bloomPass  = new UnrealBloomPass(new THREE.Vector2(W, H), 1.4, 0.35, 0.18)
    const composer   = new EffectComposer(renderer)
    composer.addPass(renderPass)
    composer.addPass(bloomPass)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping   = true
    controls.dampingFactor   = 0.06
    controls.minDistance     = 8
    controls.maxDistance     = 200
    controls.autoRotate      = true
    controls.autoRotateSpeed = 0.25
    controlsRef.current = controls
    cameraRef.current   = camera

    // ── Nebula ──
    const theme      = GALAXY_THEMES[galaxyTheme] || GALAXY_THEMES.cosmic
    const nebulaMat  = makeNebulaMaterial(theme)
    const nebulaSphere = new THREE.Mesh(new THREE.SphereGeometry(500, 32, 32), nebulaMat)
    scene.add(nebulaSphere)

    // ── Stars ──
    function buildStarLayer(count, spread, sizeMin, sizeMax, innerColor, outerColor) {
      const geo = new THREE.BufferGeometry()
      const pos  = new Float32Array(count * 3)
      const col  = new Float32Array(count * 3)
      const ph   = new Float32Array(count)
      const sz   = new Float32Array(count)
      const cIn  = new THREE.Color(innerColor)
      const cOut = new THREE.Color(outerColor)
      for (let i = 0; i < count; i++) {
        const y   = 1.0 - (i / (count - 1)) * 2.0
        const rad = Math.sqrt(Math.max(0, 1 - y * y))
        const th  = (Math.PI * (3 - Math.sqrt(5))) * i
        const r   = spread * (0.5 + Math.random() * 0.5)
        pos[i*3] = Math.cos(th) * rad * r; pos[i*3+1] = y * r; pos[i*3+2] = Math.sin(th) * rad * r
        const mc = cIn.clone().lerp(cOut, Math.random())
        col[i*3] = mc.r; col[i*3+1] = mc.g; col[i*3+2] = mc.b
        ph[i]    = Math.random() * Math.PI * 2
        sz[i]    = sizeMin + Math.random() * (sizeMax - sizeMin)
      }
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
      geo.setAttribute('color',    new THREE.BufferAttribute(col, 3))
      geo.setAttribute('aPhase',   new THREE.BufferAttribute(ph,  1))
      geo.setAttribute('aSize',    new THREE.BufferAttribute(sz,  1))
      const uTime = { value: 0 }
      const mat = new THREE.ShaderMaterial({
        uniforms: { uTime },
        vertexShader: `
          attribute float aPhase; attribute float aSize; varying float vAlpha; varying vec3 vColor; uniform float uTime;
          void main() {
            vColor = color;
            vAlpha = 0.25 + 0.75 * abs(sin(uTime * 1.2 + aPhase));
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            gl_PointSize = aSize * (220.0 / -mv.z);
            gl_Position  = projectionMatrix * mv;
          }
        `,
        fragmentShader: `
          varying float vAlpha; varying vec3 vColor;
          void main() {
            float d = length(gl_PointCoord - 0.5) * 2.0;
            if (d > 1.0) discard;
            float a = vAlpha * smoothstep(1.0, 0.3, d);
            gl_FragColor = vec4(vColor, a);
          }
        `,
        transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, vertexColors: true,
      })
      return { points: new THREE.Points(geo, mat), uTime }
    }

    const starLayer1 = buildStarLayer(2000, 380, 1.0, 2.8, theme.star1[0], theme.star1[1])
    const starLayer2 = buildStarLayer(800,  300, 2.5, 5.5, theme.star2[0], theme.star2[1])
    scene.add(starLayer1.points)
    scene.add(starLayer2.points)

    // ── Lighting ──
    scene.add(new THREE.AmbientLight(0x1a2a4a, 0.6))
    const dirLight = new THREE.DirectionalLight(0x88c4ff, 1.8)
    dirLight.position.set(30, 50, 30)
    scene.add(dirLight)
    const pLight1 = new THREE.PointLight(0xff4488, 0.8, 120)
    pLight1.position.set(-40, 15, -40)
    scene.add(pLight1)

    const pLight2 = new THREE.PointLight(0x00ffcc, 0.5, 80)
    pLight2.position.set(0, -30, 50)
    scene.add(pLight2)
    const hoverLight  = new THREE.PointLight(0x00d4ff, 0.0, 50)
    const selectLight = new THREE.PointLight(0xffffff, 0.0, 60)
    scene.add(hoverLight, selectLight)

    // ── Grid ──
    const gridHelper = new THREE.GridHelper(300, 60, PALETTE.gridLine, PALETTE.gridLine)
    gridHelper.position.y = -38
    gridHelper.material.transparent = true
    gridHelper.material.opacity = 0.05
    scene.add(gridHelper)

    // ── Radar rings ──
    const radarUniforms = { uTime: { value: 0 } }
    const radarGroup    = new THREE.Group()
    for (let i = 0; i < 3; i++) {
      const r   = (i + 1) * 6
      const geo = new THREE.RingGeometry(r - 0.08, r + 0.08, 64)
      const mat = new THREE.ShaderMaterial({
        uniforms: { uTime: radarUniforms.uTime, uIdx: { value: i } },
        vertexShader:   `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: `
          uniform float uTime; uniform float uIdx; varying vec2 vUv;
          void main() {
            float a = atan(vUv.y-0.5,vUv.x-0.5);
            float sweep = sin(a*2.0+uTime*0.5+uIdx*1.2)*0.5+0.5;
            vec3 col = mix(vec3(0.0,0.55,0.9),vec3(0.4,0.0,0.8),uIdx/2.0);
            gl_FragColor = vec4(col,(0.03+sweep*0.10)*0.3);
          }
        `,
        transparent: true, depthWrite: false, side: THREE.DoubleSide,
      })
      const mesh = new THREE.Mesh(geo, mat)
      mesh.rotation.x = -Math.PI / 2
      mesh.position.y = -14
      radarGroup.add(mesh)
    }
    scene.add(radarGroup)

    // ── NETACT-CORE — bigger, always centered ──────────────────────────────
    const coreGroup = new THREE.Group()
    coreGroup.position.set(0, 0, 0)

    const shellData = [
      { r: 7.0,  detail: 1, color: theme.corePrimary,   speed:  0.12, speedX:  0.07 },
      { r: 9.5,  detail: 1, color: theme.coreSecondary, speed: -0.09, speedX:  0.11 },
      { r: 12.0, detail: 2, color: theme.corePrimary,   speed:  0.06, speedX: -0.05 },
    ]
    const shellMeshes  = []
    shellData.forEach(s => {
      const uni = { uTime: { value: 0 }, uColor: { value: new THREE.Color(s.color) } }
      const mat = new THREE.ShaderMaterial({
        uniforms: uni,
        vertexShader: `
          varying vec3 vNormal; varying vec3 vWorldPos;
          void main() {
            vNormal = normalize(normalMatrix * normal);
            vWorldPos = (modelMatrix * vec4(position,1.0)).xyz;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
          }
        `,
        fragmentShader: `
          uniform float uTime; uniform vec3 uColor;
          varying vec3 vNormal; varying vec3 vWorldPos;
          void main() {
            vec3 vd = normalize(cameraPosition - vWorldPos);
            float fresnel = pow(1.0 - abs(dot(vd, vNormal)), 3.0);
            float scan = sin(vWorldPos.y * 10.0 - uTime * 2.0) * 0.5 + 0.5;
            scan = smoothstep(0.4, 0.6, scan) * 0.3;
            vec3 col = uColor * (0.15 + fresnel * 0.9 + scan);
            gl_FragColor = vec4(col, 0.12 + fresnel * 0.45);
          }
        `,
        transparent: true, wireframe: true, side: THREE.DoubleSide, depthWrite: false,
      })
      const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(s.r, s.detail), mat)
      mesh.userData.speedY = s.speed
      mesh.userData.speedX = s.speedX
      coreGroup.add(mesh)
      shellMeshes.push(mesh)
    })

    // Nucleus — bigger
    const nucleus = new THREE.Mesh(
      new THREE.SphereGeometry(2.0, 32, 32),
      new THREE.MeshPhysicalMaterial({
        color: new THREE.Color(theme.corePrimary),
        emissive: new THREE.Color(theme.corePrimary),
        emissiveIntensity: 1.5, roughness: 0.05, metalness: 0.1,
        transparent: true, opacity: 0.9,
      })
    )
    coreGroup.add(nucleus)

    // Energy beam
    const beamCount  = 120
    const beamGeo    = new THREE.BufferGeometry()
    const beamPos    = new Float32Array(beamCount * 3)
    const beamPh     = new Float32Array(beamCount)
    const beamSz     = new Float32Array(beamCount)
    for (let i = 0; i < beamCount; i++) {
      const t = i / beamCount
      beamPos[i*3]   = (Math.random() - 0.5) * 1.5
      beamPos[i*3+1] = t * 38 - 3
      beamPos[i*3+2] = (Math.random() - 0.5) * 1.5
      beamPh[i]      = Math.random() * Math.PI * 2
      beamSz[i]      = 1.5 + Math.random() * 4.0
    }
    beamGeo.setAttribute('position', new THREE.BufferAttribute(beamPos, 3))
    beamGeo.setAttribute('aPhase',   new THREE.BufferAttribute(beamPh,  1))
    beamGeo.setAttribute('aSize',    new THREE.BufferAttribute(beamSz,  1))
    const beamUniforms = { uTime: { value: 0 } }
    const beamMat = new THREE.ShaderMaterial({
      uniforms: beamUniforms,
      vertexShader: `
        attribute float aPhase; attribute float aSize; uniform float uTime; varying float vAlpha;
        void main() {
          vec3 pos = position;
          float rise = fract(pos.y / 38.0 + uTime * 0.3 + aPhase * 0.1);
          pos.y = rise * 38.0 - 3.0;
          float spread = (1.0 - rise) * 0.5;
          pos.x *= spread; pos.z *= spread;
          vAlpha = (1.0 - rise) * (0.4 + 0.6 * abs(sin(uTime * 2.0 + aPhase)));
          vec4 mv = modelViewMatrix * vec4(pos, 1.0);
          gl_PointSize = aSize * (180.0 / -mv.z);
          gl_Position  = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        varying float vAlpha;
        void main() {
          float d = length(gl_PointCoord - 0.5) * 2.0;
          if (d > 1.0) discard;
          vec3 col = mix(vec3(0.3,0.8,1.0), vec3(0.7,0.2,1.0), d);
          gl_FragColor = vec4(col, vAlpha * smoothstep(1.0, 0.2, d));
        }
      `,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    })
    coreGroup.add(new THREE.Points(beamGeo, beamMat))

    const corePLight = new THREE.PointLight(new THREE.Color(theme.corePrimary), 4.0, 50)
    coreGroup.add(corePLight)

    // Core label
    const coreLabelDiv = document.createElement('div')
    coreLabelDiv.style.cssText = `
      font-family: 'Courier New', monospace;
      font-size: 14px; font-weight: bold;
      color: ${theme.corePrimary};
      background: rgba(2,6,16,0.80);
      border: 1px solid ${theme.corePrimary}cc;
      border-radius: 6px;
      padding: 5px 14px;
      letter-spacing: 2.5px;
      text-transform: uppercase;
      pointer-events: none;
      white-space: nowrap;
      text-shadow: 0 0 14px ${theme.corePrimary};
      box-shadow: 0 0 22px ${theme.corePrimary}66;
    `
    coreLabelDiv.textContent = '⬡ NETACT-CORE'
    const coreLabelObj = new CSS2DObject(coreLabelDiv)
    coreLabelObj.position.set(0, 15, 0)
    coreGroup.add(coreLabelObj)

    scene.add(coreGroup)

    // ── Build nodes & force layout ──
    const nodeMap = new Map(nodes.map(n => [n.id, { ...n }]))
    const nodeArr = Array.from(nodeMap.values())

    const edgeCountMap = new Map()
    filteredEdges.forEach(e => {
      edgeCountMap.set(e.source, (edgeCountMap.get(e.source) || 0) + 1)
      edgeCountMap.set(e.target, (edgeCountMap.get(e.target) || 0) + 1)
    })

    const edgeArr = filteredEdges
      .map(e => ({
        ...e,
        source: nodeMap.get(e.source) || e.source,
        target: nodeMap.get(e.target) || e.target,
      }))
      .filter(e => typeof e.source === 'object' && typeof e.target === 'object')

    // Fibonacci sphere placement — start farther from core
    const phi = Math.PI * (3 - Math.sqrt(5))
    nodeArr.forEach((n, i) => {
      const y   = 1.0 - (i / Math.max(1, nodeArr.length - 1)) * 2.0
      const rad = Math.sqrt(Math.max(0, 1 - y * y))
      const th  = phi * i
      const R   = 35 + Math.random() * 15
      n.x3d = Math.cos(th) * rad * R
      n.y3d = y * R
      n.z3d = Math.sin(th) * rad * R
      n.vx = n.vy = n.vz = 0
    })

    // ── Node meshes ──
    const nodeMeshes = []
    const meshMap    = new Map()
    const labelMap   = new Map()
    const glowMap    = new Map()
    const selRingMap = new Map()

    nodeArr.forEach(n => {
      const type      = classifyDevice(n)
      const colorHex  = getNodeColor(n, theme)
      const geo       = makeNodeGeometry(type)
      const mat       = makeNodeMaterial(colorHex)
      const mesh      = new THREE.Mesh(geo, mat)
      mesh.userData   = { id: n.id, n }
      scene.add(mesh)
      nodeMeshes.push(mesh)
      meshMap.set(n.id, mesh)

      // Glow sprite
      const glowSpr = new THREE.Sprite(new THREE.SpriteMaterial({
        map: makeGlowTexture(colorHex), transparent: true,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }))
      glowSpr.scale.set(7, 7, 1)
      mesh.add(glowSpr)
      glowMap.set(n.id, glowSpr)

      // Selection ring
      const selRing = new THREE.Mesh(
        new THREE.TorusGeometry(2.2, 0.07, 8, 64),
        new THREE.MeshBasicMaterial({ color: colorHex, transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending })
      )
      selRing.rotation.x = Math.PI / 2
      mesh.add(selRing)
      selRingMap.set(n.id, selRing)

      // Under ring
      const underRing = new THREE.Mesh(
        new THREE.TorusGeometry(1.4, 0.04, 8, 48),
        new THREE.MeshBasicMaterial({ color: colorHex, transparent: true, opacity: 0.22 })
      )
      underRing.rotation.x = Math.PI / 2
      underRing.position.y = -1.0
      mesh.add(underRing)

      // Label card
      const ec       = edgeCountMap.get(n.id) || 0
      const labelDiv = createNodeLabel(n, colorHex, labelMode, ec)
      const labelObj = new CSS2DObject(labelDiv)
      labelObj.position.set(0, 2.8, 0)
      labelObj.visible = (labelMode !== 'hidden')
      mesh.add(labelObj)
      labelMap.set(n.id, { obj: labelObj, div: labelDiv, node: n, colorHex, edgeCount: ec })
    })

    labelMapRef.current = labelMap
    meshMapRef.current  = meshMap

    // ── Link tubes ──
    const tubeMeshes = []
    const tubeData   = []

    edgeArr.forEach((e) => {
      const isDown   = e.status === 'down' || e.status === 'error'
      // Latency-aware coloring for ISP/OSPF links; fall back to theme colors
      const rttAvg   = e.ping_metrics?.rtt_avg ?? e.rtt_avg ?? 0
      const latColor = !isDown && rttAvg > 0 ? latencyToColor(rttAvg) : null
      let colorHex = isDown ? '#ff1744' : (PROTOCOL_COLOR[e.protocol] || PROTOCOL_COLOR.unknown)
      if (!isDown && theme) {
        if (e.protocol === 'ospf') colorHex = latColor || theme.corePrimary
        else if (e.protocol === 'isp') colorHex = latColor || '#ff9800'
        else if (e.protocol === 'lldp') colorHex = theme.coreSecondary
        else colorHex = theme.coreSecondary
      }
      const mat      = makeLinkMaterial(colorHex, isDown)
      const dummy    = new THREE.QuadraticBezierCurve3(
        new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 5, 0), new THREE.Vector3(1, 0, 0),
      )
      const tubeMesh = new THREE.Mesh(new THREE.TubeGeometry(dummy, 20, 0.09, 6, false), mat)
      tubeMesh.renderOrder = -1
      scene.add(tubeMesh)
      tubeMesh.userData = {
        sourceId: e.source.id, targetId: e.target.id,
        sourceLabel: e.source.label || e.source.id,
        targetLabel: e.target.label || e.target.id,
        sourceInterface: e.source_interface || '',
        targetInterface: e.target_interface || '',
        protocol: e.protocol || 'unknown',
        rttAvg: e.ping_metrics?.rtt_avg ?? e.rtt_avg ?? 0,
        successRate: e.ping_metrics?.success_rate ?? 100,
        status: e.status || 'up',
      }
      tubeMeshes.push(tubeMesh)
      tubeData.push({
        mesh: tubeMesh, mat,
        sourceId: e.source.id, targetId: e.target.id,
        lastGeoCurve: null,
        lastSrcPos: null, lastTgtPos: null,
      })
    })

    // ── Data packets ──
    const PACKET_COUNT = Math.min(180, edgeArr.length * 6 + 20)
    const TRAIL_LENGTH = 4
    const pktMesh = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.14, 6, 6),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(theme.coreSecondary), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending }),
      PACKET_COUNT * TRAIL_LENGTH
    )
    pktMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    scene.add(pktMesh)

    const packets = Array.from({ length: PACKET_COUNT }, () => ({
      linkIndex: -1, progress: Math.random(),
      speed: 0.055 + Math.random() * 0.09,
    }))

    // ── Interaction ──
    const raycaster    = new THREE.Raycaster()
    const mouse        = new THREE.Vector2()
    let draggedObject  = null
    let draggedNodeId  = null
    let hoveredNodeId  = null
    const dragPlane    = new THREE.Plane()
    const dragIntersect = new THREE.Vector3()
    const dragOffset   = new THREE.Vector3()

    const entranceObj = { scale: 5.0 }
    gsap.to(entranceObj, { scale: 1.0, duration: 2.8, ease: 'power3.out' })

    const onPointerDown = evt => {
      const rect = renderer.domElement.getBoundingClientRect()
      mouse.x = ((evt.clientX - rect.left) / rect.width)  * 2 - 1
      mouse.y = -((evt.clientY - rect.top)  / rect.height) * 2 + 1
      raycaster.setFromCamera(mouse, camera)
      const hits = raycaster.intersectObjects(nodeMeshes)
      if (hits.length > 0) {
        controls.enabled = false; controls.autoRotate = false
        draggedObject = hits[0].object
        draggedNodeId = draggedObject.userData.id
        const norm = new THREE.Vector3()
        camera.getWorldDirection(norm); norm.negate()
        dragPlane.setFromNormalAndCoplanarPoint(norm, draggedObject.position)
        if (raycaster.ray.intersectPlane(dragPlane, dragIntersect)) {
          dragOffset.copy(draggedObject.position).sub(dragIntersect)
        }
      }
    }

    const onPointerMove = evt => {
      const rect = renderer.domElement.getBoundingClientRect()
      mouse.x = ((evt.clientX - rect.left) / rect.width)  * 2 - 1
      mouse.y = -((evt.clientY - rect.top)  / rect.height) * 2 + 1
      raycaster.setFromCamera(mouse, camera)

      if (draggedObject) {
        if (raycaster.ray.intersectPlane(dragPlane, dragIntersect)) {
          const np = dragIntersect.clone().add(dragOffset)
          draggedObject.position.copy(np)
          const nObj = draggedObject.userData.n
          if (nObj) { nObj.x3d = np.x / entranceObj.scale; nObj.y3d = np.y / entranceObj.scale; nObj.z3d = np.z / entranceObj.scale }
        }
        return
      }

      const nodeHits = raycaster.intersectObjects(nodeMeshes)
      const tubeHits = nodeHits.length === 0 ? raycaster.intersectObjects(tubeMeshes) : []
      const hits     = nodeHits
      const tip  = tooltipDivRef.current

      // Link hover tooltip
      if (tubeHits.length > 0) {
        const ud = tubeHits[0].object.userData
        const latStr = ud.rttAvg > 0 ? `${ud.rttAvg}ms` : '—'
        const lossStr = ud.successRate < 100 ? ` · loss ${(100-ud.successRate).toFixed(1)}%` : ''
        const statusColor = ud.status === 'down' ? '#ff1744' : ud.status === 'warning' ? '#ffca28' : '#00e676'
        if (tip) {
          tip.style.left = (evt.clientX - rect.left + 16) + 'px'
          tip.style.top  = (evt.clientY - rect.top  - 10) + 'px'
          tip.style.opacity = '1'
          tip.style.borderColor = statusColor + '88'
          tip.style.boxShadow = `0 0 18px ${statusColor}33`
          tip.innerHTML = `
            <div style="border-bottom:1px solid ${statusColor}44;padding-bottom:4px;margin-bottom:4px;color:${statusColor};font-size:11px;font-weight:bold;letter-spacing:0.5px;">
              ⬡ ${ud.protocol.toUpperCase()} Link
            </div>
            <div style="color:#7ecfff;font-size:10px;">
              ${ud.sourceLabel}${ud.sourceInterface ? ` <span style="color:#4a6080">[${ud.sourceInterface}]</span>` : ''}
            </div>
            <div style="color:#8b949e;font-size:9px;text-align:center;margin:2px 0;">↕</div>
            <div style="color:#7ecfff;font-size:10px;">
              ${ud.targetLabel}${ud.targetInterface ? ` <span style="color:#4a6080">[${ud.targetInterface}]</span>` : ''}
            </div>
            ${ud.rttAvg > 0 ? `<div style="color:#c9d1d9;font-size:9px;margin-top:4px;border-top:1px solid #ffffff11;padding-top:3px;">RTT: <span style="color:${statusColor}">${latStr}</span>${lossStr}</div>` : ''}
          `
        }
        container.style.cursor = 'crosshair'
      } else if (hits.length === 0 && tip) {
        tip.style.opacity = '0'
        container.style.cursor = 'default'
      }

      if (hits.length > 0) {
        const id   = hits[0].object.userData.id
        const nObj = hits[0].object.userData.n
        if (id !== hoveredNodeId) {
          if (hoveredNodeId) {
            const m = meshMap.get(hoveredNodeId)
            if (m?.material?.uniforms) m.material.uniforms.uHovered.value = 0.0
          }
          hoveredNodeId = id
          const m = meshMap.get(id)
          if (m?.material?.uniforms) m.material.uniforms.uHovered.value = 1.0
          hoverLight.position.copy(hits[0].object.position)
          hoverLight.intensity = 3.5
          if (tip && nObj) {
            const colorHex = getNodeColor(nObj, theme)
            const type     = classifyDevice(nObj)
            const icon     = DEVICE_ICON[type] || '■'
            const statusColor = STATUS_COLOR[nObj.status] || STATUS_COLOR.unknown
            const ec = edgeCountMap.get(nObj.id) || 0
            tip.style.borderColor = colorHex + '88'
            tip.style.boxShadow   = `0 0 18px ${colorHex}33`
            tip.style.opacity     = '1'
            tip.innerHTML = `
              <div style="display:flex;align-items:center;gap:5px;border-bottom:1px solid ${colorHex}44;padding-bottom:4px;margin-bottom:4px;">
                <span style="color:${colorHex};font-size:14px;line-height:1;">${icon}</span>
                <span style="color:${colorHex};font-weight:bold;font-size:12px;letter-spacing:0.5px;">${nObj.label}</span>
              </div>
              ${nObj.ip ? `<div style="color:#7ecfff;font-size:10px;margin-bottom:3px;">⬡ ${nObj.ip}</div>` : ''}
              <div style="display:flex;align-items:center;gap:5px;">
                <span style="width:7px;height:7px;border-radius:50%;background:${statusColor};display:inline-block;box-shadow:0 0 6px ${statusColor};flex-shrink:0;"></span>
                <span style="color:${statusColor};font-size:10px;text-transform:uppercase;letter-spacing:1px;">${nObj.status || 'unknown'}</span>
              </div>
              <div style="color:#4a6080;font-size:9px;margin-top:4px;text-transform:uppercase;letter-spacing:0.8px;">${type} · ${ec} links</div>
            `
          }
        }
        if (tip) {
          tip.style.left = (evt.clientX - rect.left + 16) + 'px'
          tip.style.top  = (evt.clientY - rect.top  - 10) + 'px'
        }
        container.style.cursor = 'pointer'
      } else {
        if (hoveredNodeId) {
          const m = meshMap.get(hoveredNodeId)
          if (m?.material?.uniforms) m.material.uniforms.uHovered.value = 0.0
          hoveredNodeId = null
        }
        if (tip) tip.style.opacity = '0'
        hoverLight.intensity = 0
        container.style.cursor = 'default'
      }
    }

    const onPointerUp = () => {
      if (draggedObject) {
        controls.enabled = true; controls.autoRotate = true
        const nObj = draggedObject.userData.n
        if (nObj) {
          onNodeMoved(nObj.id, (nObj.x3d / 55) + 0.5, 0.5 - (nObj.y3d / 35))
        }
        draggedObject = null; draggedNodeId = null
      }
    }

    const onCanvasClick = evt => {
      if (evt.target !== renderer.domElement) return
      const rect = renderer.domElement.getBoundingClientRect()
      mouse.x = ((evt.clientX - rect.left) / rect.width)  * 2 - 1
      mouse.y = -((evt.clientY - rect.top)  / rect.height) * 2 + 1
      raycaster.setFromCamera(mouse, camera)
      const hits = raycaster.intersectObjects(nodeMeshes)

      if (hits.length > 0) {
        const nodeId = hits[0].object.userData.id
        const curSel = selectedRef.current
        const newSel = nodeId === curSel ? null : nodeId
        selectedRef.current = newSel
        onSelectNode(newSel)

        if (newSel) {
          const pos = hits[0].object.position
          gsap.to(controls.target, { x: pos.x, y: pos.y, z: pos.z, duration: 1.0, ease: 'power3.out' })
          gsap.to(camera.position, {
            x: pos.x * 1.4 + 8, y: pos.y + 6, z: pos.z * 1.4 + 14,
            duration: 1.0, ease: 'power3.out',
          })
          gsap.killTweensOf(bloomPass)
          gsap.to(bloomPass, { strength: 3.0, duration: 0.18, ease: 'power2.out',
            onComplete: () => gsap.to(bloomPass, { strength: 1.4, duration: 0.8, ease: 'power2.in' })
          })
        }
      } else {
        selectedRef.current = null
        onSelectNode(null)
        gsap.to(controls.target, { x: 0, y: 0, z: 0, duration: 1.2, ease: 'power3.inOut' })
        gsap.to(camera.position, {
          x: 0, y: 30, z: 80,
          duration: 1.2, ease: 'power3.inOut',
          onUpdate: () => controls.update(),
        })
      }
    }

    renderer.domElement.addEventListener('mousedown',    onPointerDown)
    renderer.domElement.addEventListener('mousemove',    onPointerMove)
    renderer.domElement.addEventListener('mouseup',      onPointerUp)
    renderer.domElement.addEventListener('click',        onCanvasClick)
    renderer.domElement.addEventListener('pointerleave', () => { hoverLight.intensity = 0 })

    // Touch support — tap to select, pinch/pan handled by OrbitControls
    let touchStartX = 0, touchStartY = 0, touchStartTime = 0
    const onTouchStart = e => {
      if (e.touches.length === 1) {
        touchStartX = e.touches[0].clientX; touchStartY = e.touches[0].clientY
        touchStartTime = Date.now()
      }
    }
    const onTouchEnd = e => {
      if (e.changedTouches.length === 1 && Date.now() - touchStartTime < 250) {
        const dx = e.changedTouches[0].clientX - touchStartX
        const dy = e.changedTouches[0].clientY - touchStartY
        if (Math.sqrt(dx*dx + dy*dy) < 12) {
          // Treat as tap — synthesize click
          const synth = new MouseEvent('click', {
            clientX: e.changedTouches[0].clientX,
            clientY: e.changedTouches[0].clientY,
            bubbles: true,
          })
          renderer.domElement.dispatchEvent(synth)
        }
      }
    }
    renderer.domElement.addEventListener('touchstart', onTouchStart, { passive: true })
    renderer.domElement.addEventListener('touchend',   onTouchEnd,   { passive: true })

    // ── Animation loop ──
    const clock = new THREE.Clock()
    let frameId
    const tmpM4  = new THREE.Matrix4()
    const tmpV   = new THREE.Vector3()
    const tmpP1  = new THREE.Vector3()
    const tmpP2  = new THREE.Vector3()
    const tmpMid = new THREE.Vector3()

    function rebuildTube(td) {
      const src = meshMap.get(td.sourceId)
      const tgt = meshMap.get(td.targetId)
      if (!src || !tgt) return null
      // Throttle: skip rebuild if neither endpoint moved > 0.4 units
      const sp = td.lastSrcPos, tp = td.lastTgtPos
      if (
        td.lastGeoCurve && sp && tp &&
        Math.abs(src.position.x - sp.x) < 0.4 &&
        Math.abs(src.position.y - sp.y) < 0.4 &&
        Math.abs(src.position.z - sp.z) < 0.4 &&
        Math.abs(tgt.position.x - tp.x) < 0.4 &&
        Math.abs(tgt.position.y - tp.y) < 0.4 &&
        Math.abs(tgt.position.z - tp.z) < 0.4
      ) return td.lastGeoCurve
      td.lastSrcPos = src.position.clone()
      td.lastTgtPos = tgt.position.clone()
      tmpP1.copy(src.position); tmpP2.copy(tgt.position)
      tmpMid.addVectors(tmpP1, tmpP2).multiplyScalar(0.5)
      const dist = tmpP1.distanceTo(tmpP2)
      const arch = Math.min(dist * 0.28, 10)
      const mLen = tmpMid.length()
      if (mLen > 0.1) tmpMid.normalize().multiplyScalar(mLen + arch)
      else tmpMid.set(0, arch, 0)
      const curve = new THREE.QuadraticBezierCurve3(tmpP1.clone(), tmpMid.clone(), tmpP2.clone())
      td.mesh.geometry.dispose()
      td.mesh.geometry  = new THREE.TubeGeometry(curve, 22, 0.09, 6, false)
      td.lastGeoCurve   = curve
      return curve
    }

    const animate = () => {
      frameId = requestAnimationFrame(animate)
      const elapsed = clock.getElapsedTime()
      const scale   = entranceObj.scale

      // Physics
      const gravity = 0.012
      const coreRepulsionRadius = 48.0 // Outer shell is 12, so 48 gives a nice clearance zone
      nodeArr.forEach(n => {
        if (n.id === draggedNodeId) return
        
        // Gravity towards center
        n.vx -= n.x3d * gravity
        n.vy -= n.y3d * gravity
        n.vz -= n.z3d * gravity

        // Repel from central core (at 0,0,0) to keep core central and visible
        const distToCenter = Math.sqrt(n.x3d * n.x3d + n.y3d * n.y3d + n.z3d * n.z3d)
        if (distToCenter < coreRepulsionRadius) {
          const force = (coreRepulsionRadius - distToCenter) * 0.15
          const dx = n.x3d || (Math.random() - 0.5)
          const dy = n.y3d || (Math.random() - 0.5)
          const dz = n.z3d || (Math.random() - 0.5)
          const len = Math.sqrt(dx*dx + dy*dy + dz*dz) || 1
          n.vx += (dx / len) * force
          n.vy += (dy / len) * force
          n.vz += (dz / len) * force
        }
      })
      const charge = 400
      for (let i = 0; i < nodeArr.length; i++) {
        for (let j = i + 1; j < nodeArr.length; j++) {
          let dx = nodeArr[i].x3d - nodeArr[j].x3d
          let dy = nodeArr[i].y3d - nodeArr[j].y3d
          let dz = nodeArr[i].z3d - nodeArr[j].z3d
          let dist = Math.sqrt(dx*dx + dy*dy + dz*dz)
          if (dist < 0.2) { dx=(Math.random()-.5)*2;dy=(Math.random()-.5)*2;dz=(Math.random()-.5)*2;dist=Math.sqrt(dx*dx+dy*dy+dz*dz) }
          const f = charge / (dist * dist * Math.max(0.1, dist))
          if (nodeArr[i].id !== draggedNodeId) { nodeArr[i].vx+=dx*f;nodeArr[i].vy+=dy*f;nodeArr[i].vz+=dz*f }
          if (nodeArr[j].id !== draggedNodeId) { nodeArr[j].vx-=dx*f;nodeArr[j].vy-=dy*f;nodeArr[j].vz-=dz*f }
        }
      }
      edgeArr.forEach(e => {
        const n1=e.source,n2=e.target
        let dx=n2.x3d-n1.x3d,dy=n2.y3d-n1.y3d,dz=n2.z3d-n1.z3d
        const dist=Math.sqrt(dx*dx+dy*dy+dz*dz)
        if(dist<0.1) return
        const f=(dist-35)*0.055/dist
        if(n1.id!==draggedNodeId){n1.vx+=dx*f;n1.vy+=dy*f;n1.vz+=dz*f}
        if(n2.id!==draggedNodeId){n2.vx-=dx*f;n2.vy-=dy*f;n2.vz-=dz*f}
      })
      nodeArr.forEach(n => {
        if(n.id===draggedNodeId){n.vx=n.vy=n.vz=0;return}
        n.x3d+=n.vx*0.14;n.y3d+=n.vy*0.14;n.z3d+=n.vz*0.14
        n.vx*=0.84;n.vy*=0.84;n.vz*=0.84
      })

      // Node mesh positions
      nodeArr.forEach(n => {
        const mesh = meshMap.get(n.id); if (!mesh) return
        const isSel = n.id === selectedRef.current
        const px=n.x3d*scale,py=n.y3d*scale,pz=n.z3d*scale
        const len=Math.sqrt(px*px+py*py+pz*pz)
        const bob=Math.sin(elapsed*1.5+n.x3d*0.12)*0.6
        let rx=0,ry=0,rz=1
        if(len>0.1){rx=px/len;ry=py/len;rz=pz/len}
        mesh.position.set(px+rx*bob,py+ry*bob,pz+rz*bob)
        mesh.lookAt(0,0,0); mesh.rotateX(Math.PI/2)
        if(mesh.material.uniforms){
          mesh.material.uniforms.uTime.value       = elapsed
          mesh.material.uniforms.uBrightness.value = isSel ? 2.0 : 1.0
          mesh.material.uniforms.uSelected.value   = isSel ? 1.0 : 0.0
        }
        const ring=selRingMap.get(n.id)
        if(ring){
          const isErr  = n.status === 'error' || n.status === 'auth_fail'
          const isWarn = n.status === 'warning'
          if(isSel){
            ring.material.color.set(getNodeColor(n, theme))
            ring.material.opacity = 0.5+0.45*Math.sin(elapsed*4.5)
            const rs=1.0+0.18*Math.sin(elapsed*3.5);ring.scale.set(rs,rs,1)
          } else if(isErr){
            ring.material.color.set('#ff1744')
            ring.material.opacity = 0.25+0.35*Math.abs(Math.sin(elapsed*5.5))
            const rs=1.0+0.3*Math.abs(Math.sin(elapsed*5.0));ring.scale.set(rs,rs,1)
          } else if(isWarn){
            ring.material.color.set('#ffca28')
            ring.material.opacity = 0.15+0.2*Math.abs(Math.sin(elapsed*3.0))
            const rs=1.0+0.12*Math.abs(Math.sin(elapsed*2.8));ring.scale.set(rs,rs,1)
          } else {
            ring.material.opacity = 0.0
          }
        }
        const glow=glowMap.get(n.id)
        if(glow) glow.scale.setScalar(isSel?10+Math.sin(elapsed*3)*2:7)
      })

      // Select light
      if(selectedNode){
        const sm=meshMap.get(selectedNode)
        if(sm){selectLight.position.lerp(sm.position,0.12);selectLight.intensity=THREE.MathUtils.lerp(selectLight.intensity,4.0,0.1)}
      } else {
        selectLight.intensity=THREE.MathUtils.lerp(selectLight.intensity,0,0.08)
      }

      // Tubes
      tubeData.forEach(td => { td.mat.uniforms.uTime.value=elapsed; rebuildTube(td) })

      // Packets
      if(tubeData.length>0){
        packets.forEach((p,pi) => {
          if(p.linkIndex<0||p.linkIndex>=tubeData.length){p.linkIndex=Math.floor(Math.random()*tubeData.length);p.progress=Math.random()}
          p.progress+=p.speed*0.075
          if(p.progress>=1.0){p.progress=0;p.linkIndex=Math.floor(Math.random()*tubeData.length)}
          const td=tubeData[p.linkIndex]
          if(!td.lastGeoCurve){const z=new THREE.Matrix4().makeScale(0,0,0);for(let t=0;t<TRAIL_LENGTH;t++)pktMesh.setMatrixAt(pi*TRAIL_LENGTH+t,z);return}
          for(let t=0;t<TRAIL_LENGTH;t++){
            td.lastGeoCurve.getPointAt(Math.min(Math.max(0,p.progress-t*0.035),0.999),tmpV)
            const ts=(1.0-t/TRAIL_LENGTH)*(1.0-t*0.15)
            tmpM4.makeScale(ts,ts,ts);tmpM4.setPosition(tmpV)
            pktMesh.setMatrixAt(pi*TRAIL_LENGTH+t,tmpM4)
          }
        })
        pktMesh.instanceMatrix.needsUpdate=true
      }

      // Core
      shellMeshes.forEach((s,i)=>{
        s.rotation.y+=shellData[i].speed*0.016
        s.rotation.x+=shellData[i].speedX*0.016
        if(s.material.uniforms) s.material.uniforms.uTime.value=elapsed
      })
      beamUniforms.uTime.value=elapsed
      nucleus.material.emissiveIntensity=1.2+0.5*Math.sin(elapsed*2.2)
      corePLight.intensity=3.0+1.5*Math.sin(elapsed*1.8)

      // Background
      nebulaMat.uniforms.uTime.value=elapsed
      starLayer1.uTime.value=elapsed; starLayer2.uTime.value=elapsed
      starLayer1.points.rotation.y=elapsed*0.008; starLayer2.points.rotation.y=-elapsed*0.005
      radarUniforms.uTime.value=elapsed

      controls.update()
      composer.render()
      labelRenderer.render(scene, camera)
    }

    animate()

    // Auto-fit camera
    const fitTimer = setTimeout(() => {
      if (!nodeArr.length) return
      const box = new THREE.Box3()
      nodeArr.forEach(n => box.expandByPoint(new THREE.Vector3(n.x3d, n.y3d, n.z3d)))
      const size = new THREE.Vector3(); box.getSize(size)
      const maxD = Math.max(size.x, size.y, size.z)
      const fov  = camera.fov * (Math.PI / 180)
      const camZ = Math.max(Math.abs(maxD / 2 / Math.tan(fov / 2)) * 1.5, 50)
      gsap.to(controls.target, { x: 0, y: 0, z: 0, duration: 1.8, ease: 'power3.inOut' })
      gsap.to(camera.position, {
        x: 0, y: camZ * 0.4, z: camZ,
        duration: 1.8, ease: 'power3.inOut',
        onUpdate: () => controls.update(),
      })
    }, 1400)

    // Resize
    const onResize = () => {
      W = container.clientWidth; H = container.clientHeight
      camera.aspect = W / H; camera.updateProjectionMatrix()
      renderer.setSize(W, H); labelRenderer.setSize(W, H)
      composer.setSize(W, H); bloomPass.resolution.set(W, H)
    }
    window.addEventListener('resize', onResize)

    return () => {
      cancelAnimationFrame(frameId)
      clearTimeout(fitTimer)
      window.removeEventListener('resize', onResize)
      renderer.domElement.removeEventListener('mousedown',  onPointerDown)
      renderer.domElement.removeEventListener('mousemove',  onPointerMove)
      renderer.domElement.removeEventListener('mouseup',    onPointerUp)
      renderer.domElement.removeEventListener('click',      onCanvasClick)
      renderer.domElement.removeEventListener('touchstart', onTouchStart)
      renderer.domElement.removeEventListener('touchend',   onTouchEnd)
      if (container.contains(renderer.domElement))      container.removeChild(renderer.domElement)
      if (container.contains(labelRenderer.domElement)) container.removeChild(labelRenderer.domElement)
      scene.clear(); renderer.dispose()
    }
  }, [nodesKey, edgesKey, linkViewMode, galaxyTheme])

  if (webglError) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        background: '#020610',
        color: '#ff1744',
        padding: 20,
        textAlign: 'center',
        fontFamily: 'sans-serif',
        border: '1px solid rgba(255, 23, 68, 0.2)',
        borderRadius: 8
      }}>
        <span style={{ fontSize: 48, marginBottom: 16 }}>⚠️</span>
        <h3 style={{ margin: '0 0 8px 0', color: '#ffca28', fontSize: '18px', fontWeight: 600 }}>WebGL Context Creation Failed</h3>
        <p style={{ maxWidth: 500, margin: 0, fontSize: 13, color: '#90a4ae', lineHeight: 1.5 }}>
          A WebGL context could not be created on your browser or virtualized environment. 
          3D graphics require hardware acceleration or compatible graphics drivers.
        </p>
        <p style={{ marginTop: 12, fontSize: 12, color: '#00d4ff', fontWeight: 500 }}>
          Please select the <strong>2D Force Directed</strong> or <strong>Map Layout</strong> in the top dropdown menu.
        </p>
      </div>
    )
  }

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden' }}>
      {/* Screenshot button */}
      <button
        onClick={handleScreenshot}
        title="Download topology as PNG"
        style={{
          position: 'absolute', top: 10, right: 10, zIndex: 20,
          background: 'rgba(2,6,16,0.80)', border: '1px solid rgba(79,195,247,0.3)',
          borderRadius: 6, color: '#4fc3f7', fontSize: 11, fontWeight: 600,
          padding: '5px 10px', cursor: 'pointer', backdropFilter: 'blur(8px)',
          letterSpacing: '0.5px', transition: 'border-color 0.2s',
        }}
        onMouseEnter={e => e.currentTarget.style.borderColor = 'rgba(79,195,247,0.8)'}
        onMouseLeave={e => e.currentTarget.style.borderColor = 'rgba(79,195,247,0.3)'}
      >📷 Screenshot</button>
      <div
        ref={tooltipDivRef}
        style={{
          position: 'absolute', pointerEvents: 'none',
          fontFamily: "'Courier New', monospace", fontSize: 11, color: '#e0f0ff',
          background: 'linear-gradient(135deg,rgba(2,6,16,0.94) 0%,rgba(10,20,50,0.90) 100%)',
          border: '1px solid #ffffff33', borderRadius: 8, padding: '7px 11px',
          whiteSpace: 'nowrap', opacity: 0, transition: 'opacity 0.15s ease',
          zIndex: 10, backdropFilter: 'blur(10px)', minWidth: 130,
          boxShadow: '0 0 18px rgba(0,0,0,0.5)',
        }}
      />
    </div>
  )
}
