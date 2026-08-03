/**
 * TopologyControls.jsx
 *
 * Drop-in toolbar for the 3D topology viewer.
 * Place above or floating over your <Topology3D> canvas.
 *
 * Props:
 *   labelMode        'name' | 'name_ip' | 'hidden'
 *   onLabelMode      (mode) => void
 *   galaxyTheme      string  — key from GALAXY_THEMES
 *   onGalaxyTheme    (key)   => void
 *
 * Usage in your parent:
 *
 *   const [labelMode,    setLabelMode]    = useState('name')
 *   const [galaxyTheme,  setGalaxyTheme]  = useState('nebula')
 *   const [rightPanelOpen, setRightPanelOpen] = useState(false)
 *
 *   // When a node is selected, open the panel:
 *   const handleSelectNode = (id) => {
 *     setSelectedNode(id)
 *     setRightPanelOpen(!!id)
 *   }
 *
 *   // When the panel's close button is clicked:
 *   const handleClosePanel = () => {
 *     setSelectedNode(null)
 *     setRightPanelOpen(false)   // ← this triggers the zoom-out in Topology3D
 *   }
 *
 *   <TopologyControls
 *     labelMode={labelMode}     onLabelMode={setLabelMode}
 *     galaxyTheme={galaxyTheme} onGalaxyTheme={setGalaxyTheme}
 *   />
 *   <Topology3D
 *     ...
 *     labelMode={labelMode}
 *     galaxyTheme={galaxyTheme}
 *     rightPanelOpen={rightPanelOpen}
 *     onSelectNode={handleSelectNode}
 *   />
 */

import React, { useState, useRef, useEffect } from 'react'
import { GALAXY_THEMES } from './Topology3D'

// ── Label mode options ──────────────────────────────────────────────────────
const LABEL_OPTIONS = [
  { value: 'name',    label: 'Name + Status',    icon: '◈' },
  { value: 'name_ip', label: 'Name + IP + Status', icon: '⬡' },
  { value: 'hidden',  label: 'Hide Labels',       icon: '◌' },
]

// ── Small colour swatch for each theme ──────────────────────────────────────
const THEME_ACCENT = {
  cosmic:       '#e040fb',
  nebula:       '#4fc3f7',
  aurora:       '#00e676',
  crimson:      '#ff1744',
  solar:        '#ffca28',
  arctic:       '#80d8ff',
  void:         '#7c4dff',
  matrix:       '#00e676',
  supernova:    '#ff6d00',
  neonTokyo:    '#ff006e',
  abyssal:      '#00e5cc',
  toxicWaste:   '#c6ff00',
  bloodMoon:    '#ff1744',
  midnightGold: '#ffd600',
  hyperspace:   '#448aff',
  phantomGlass: '#b0bec5',
  obsidianFire: '#ff3d00',
  galacticMint: '#1de9b6',
  violetStorm:  '#d500f9',
  ironCitadel:  '#78909c',
}

// ── Shared style tokens ──────────────────────────────────────────────────────
const BASE = {
  fontFamily: "'Courier New', monospace",
  fontSize:   11,
  color:      '#c8dff0',
}

const pill = (active, accent) => ({
  display:        'flex',
  alignItems:     'center',
  gap:            5,
  padding:        '5px 10px',
  borderRadius:   5,
  border:         `1px solid ${active ? accent + 'cc' : '#ffffff18'}`,
  background:     active ? accent + '22' : 'rgba(2,6,22,0.7)',
  color:          active ? accent : '#7a9ab8',
  cursor:         'pointer',
  whiteSpace:     'nowrap',
  transition:     'all 0.18s ease',
  boxShadow:      active ? `0 0 10px ${accent}44` : 'none',
  ...BASE,
})

// ── Dropdown wrapper ─────────────────────────────────────────────────────────
function Dropdown({ trigger, children, align = 'left' }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    const handler = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <div onClick={() => setOpen(o => !o)}>{trigger(open)}</div>
      {open && (
        <div style={{
          position:      'absolute',
          top:           'calc(100% + 6px)',
          [align]:       0,
          background:    'linear-gradient(160deg,rgba(4,10,28,0.97),rgba(8,16,42,0.97))',
          border:        '1px solid #ffffff18',
          borderRadius:  8,
          padding:       6,
          minWidth:      190,
          zIndex:        100,
          backdropFilter:'blur(14px)',
          boxShadow:     '0 8px 32px rgba(0,0,0,0.6)',
          maxHeight:     '70vh',
          overflowY:     'auto',
        }}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  )
}

// ── Main toolbar ─────────────────────────────────────────────────────────────
export default function TopologyControls({
  labelMode     = 'name',
  onLabelMode,
  galaxyTheme   = 'nebula',
  onGalaxyTheme,
}) {
  const currentLabel = LABEL_OPTIONS.find(o => o.value === labelMode) || LABEL_OPTIONS[0]
  const accent       = THEME_ACCENT[galaxyTheme] || '#4fc3f7'
  const themeInfo    = GALAXY_THEMES[galaxyTheme] || GALAXY_THEMES.nebula

  return (
    <div style={{
      display:        'flex',
      alignItems:     'center',
      gap:            8,
      padding:        '6px 10px',
      background:     'linear-gradient(90deg,rgba(2,6,20,0.88),rgba(6,12,32,0.88))',
      borderBottom:   '1px solid #ffffff10',
      backdropFilter: 'blur(12px)',
      flexWrap:       'wrap',
    }}>

      {/* ── Section label ── */}
      <span style={{ ...BASE, color: '#3a5070', letterSpacing: 1, fontSize: 10, marginRight: 2 }}>
        VIEW
      </span>

      {/* ── Node label mode dropdown ── */}
      <Dropdown
        align="left"
        trigger={open => (
          <div style={{
            ...pill(true, accent),
            paddingRight: 8,
          }}>
            <span style={{ fontSize: 13 }}>{currentLabel.icon}</span>
            <span>{currentLabel.label}</span>
            <span style={{ fontSize: 9, opacity: 0.6, marginLeft: 2 }}>{open ? '▲' : '▼'}</span>
          </div>
        )}
      >
        {close => LABEL_OPTIONS.map(opt => (
          <div
            key={opt.value}
            onClick={() => { onLabelMode?.(opt.value); close() }}
            style={{
              ...pill(labelMode === opt.value, accent),
              marginBottom: 3,
              width: '100%',
              boxSizing: 'border-box',
            }}
          >
            <span style={{ fontSize: 13, width: 18, textAlign: 'center' }}>{opt.icon}</span>
            <span>{opt.label}</span>
            {labelMode === opt.value && (
              <span style={{ marginLeft: 'auto', color: accent, fontSize: 10 }}>✓</span>
            )}
          </div>
        ))}
      </Dropdown>

      {/* ── Divider ── */}
      <div style={{ width: 1, height: 20, background: '#ffffff14', margin: '0 2px' }} />

      {/* ── Galaxy theme dropdown ── */}
      <Dropdown
        align="left"
        trigger={open => (
          <div style={{ ...pill(true, accent) }}>
            {/* Colour swatch */}
            <span style={{
              width: 10, height: 10, borderRadius: '50%',
              background: accent,
              boxShadow: `0 0 6px ${accent}`,
              flexShrink: 0,
            }} />
            <span>Galaxy: {themeInfo.label || galaxyTheme}</span>
            <span style={{ fontSize: 9, opacity: 0.6, marginLeft: 2 }}>{open ? '▲' : '▼'}</span>
          </div>
        )}
      >
        {close => Object.entries(GALAXY_THEMES).map(([key, th]) => {
          const ta = THEME_ACCENT[key] || '#ffffff'
          return (
            <div
              key={key}
              onClick={() => { onGalaxyTheme?.(key); close() }}
              style={{
                ...pill(galaxyTheme === key, ta),
                marginBottom: 3,
                width: '100%',
                boxSizing: 'border-box',
              }}
            >
              {/* Dual-colour swatch */}
              <span style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
                <span style={{
                  width: 9, height: 9, borderRadius: '50%',
                  background: th.corePrimary,
                  boxShadow: `0 0 5px ${th.corePrimary}`,
                }} />
                <span style={{
                  width: 9, height: 9, borderRadius: '50%',
                  background: th.coreSecondary,
                  boxShadow: `0 0 5px ${th.coreSecondary}`,
                }} />
              </span>
              <span style={{ flex: 1 }}>{th.label}</span>
              {galaxyTheme === key && (
                <span style={{ color: ta, fontSize: 10 }}>✓</span>
              )}
            </div>
          )
        })}
      </Dropdown>

    </div>
  )
}
