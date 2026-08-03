import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react'
import { Sankey, Tooltip, ResponsiveContainer } from 'recharts'
import { getIspPingTargets, saveIspPingTargets, getIspPingConfig, saveIspPingConfig, runIspPingNow } from '../hooks/useApi.js'

/* ─────────────────────────────────────────────────────────────────────────────
   HELPERS
───────────────────────────────────────────────────────────────────────────── */
const cleanName = (val) => {
  if (!val) return ''
  if (typeof val === 'object') return (val.label || val.name || '').replace('-re0', '')
  return String(val).replace('-re0', '')
}

const NODE_PALETTE = [
  '#818cf8','#60a5fa','#34d399','#fb923c','#f472b6',
  '#a78bfa','#38bdf8','#4ade80','#fbbf24','#e879f9',
  '#2dd4bf','#f87171','#c084fc','#fb7185','#6ee7b7',
  '#7dd3fc','#a3e635','#fdba74','#d946ef','#22d3ee',
]
const getNodeColor = (i) => NODE_PALETTE[i % NODE_PALETTE.length]

const STATUS_MAP = {
  healthy:  { dot: '#10b981', glow: 'rgba(16,185,129,0.5)',  text: '#10b981', bg: 'rgba(16,185,129,0.08)',  border: 'rgba(16,185,129,0.2)',  label: '● Healthy'     },
  degraded: { dot: '#f59e0b', glow: 'rgba(245,158,11,0.5)', text: '#f59e0b', bg: 'rgba(245,158,11,0.08)', border: 'rgba(245,158,11,0.2)', label: '◐ Degraded'    },
  down:     { dot: '#ef4444', glow: 'rgba(239,68,68,0.5)',   text: '#ef4444', bg: 'rgba(239,68,68,0.08)',   border: 'rgba(239,68,68,0.2)',   label: '✕ Down'        },
  unknown:  { dot: '#6b7280', glow: 'rgba(107,114,128,0.4)', text: '#6b7280', bg: 'rgba(107,114,128,0.06)', border: 'rgba(107,114,128,0.15)', label: '○ Unmonitored' },
}
const getStatus = (m) => {
  if (!m) return 'unknown'
  if (m.status === 'down') return 'down'
  if (m.status === 'warning') return 'degraded'
  if (m.status === 'up') return 'healthy'
  return m.success_rate === 0 ? 'down' : (m.success_rate < 100 || m.rtt_avg > 200) ? 'degraded' : 'healthy'
}

/* ─────────────────────────────────────────────────────────────────────────────
   CUSTOM NODE
───────────────────────────────────────────────────────────────────────────── */
const CustomNode = ({ x, y, width, height, index, payload, containerWidth, focusedLink }) => {
  const isOut = x > containerWidth / 2
  const textX  = isOut ? x + width + 12 : x - 12
  const textAnchor = isOut ? 'start' : 'end'
  const textY  = (y || 0) + (height || 0) / 2 + 4
  const color  = getNodeColor(index)
  const name   = cleanName(payload)

  const isFocused = focusedLink && (name === focusedLink.sourceName || name === focusedLink.targetName)
  const anyFocus  = !!focusedLink
  const opacity   = anyFocus ? (isFocused ? 1 : 0.1) : 0.9

  const rH = Math.max(0, height || 0)
  const rY = Math.max(0, y || 0)
  const rW = Math.max(0, width || 0)

  return (
    <g style={{ transition: 'opacity 0.3s' }}>
      {isFocused && (
        <rect x={x-5} y={rY-5} width={rW+10} height={rH+10}
          fill={color} fillOpacity={0.1} rx={10}
          style={{ filter:'blur(10px)', pointerEvents:'none' }}/>
      )}
      <rect x={x} y={rY} width={rW} height={rH} fill={color} fillOpacity={opacity} rx={5}
        style={{
          filter: isFocused
            ? `drop-shadow(0 0 14px ${color}99) drop-shadow(0 4px 10px rgba(0,0,0,0.6))`
            : 'drop-shadow(0 3px 8px rgba(0,0,0,0.5))',
          transition: 'fill-opacity 0.3s, filter 0.3s',
        }}/>
      <rect x={x} y={rY} width={rW} height={Math.min(2, rH)} fill="white" fillOpacity={opacity*0.2} rx={2} style={{pointerEvents:'none'}}/>
      <text x={textX} y={textY} textAnchor={textAnchor}
        fontSize="12" fontWeight="700" fontFamily="'Inter',system-ui,sans-serif" letterSpacing="0.3"
        fill={anyFocus && !isFocused ? 'rgba(230,237,243,0.15)' : isFocused ? '#fff' : 'rgba(230,237,243,0.95)'}
        style={{
          pointerEvents: 'none',
          paintOrder: 'stroke fill',
          stroke: '#080a0f',
          strokeWidth: '3px',
          strokeLinejoin: 'round',
          textShadow: isFocused ? `0 0 8px ${color}` : 'none',
          transition: 'fill 0.3s',
        }}>
        {name}
      </text>
    </g>
  )
}

/* ─────────────────────────────────────────────────────────────────────────────
   CUSTOM LINK
───────────────────────────────────────────────────────────────────────────── */
const CustomLink = ({
  sourceX, targetX, sourceY, targetY, sourceControlX, targetControlX, linkWidth, payload,
  focusedLink, setFocusedLink, setHoveredLink,
  onMouseEnter, onMouseLeave, onClick
}) => {
  const path = `M${sourceX},${sourceY} C${sourceControlX},${sourceY} ${targetControlX},${targetY} ${targetX},${targetY}`
  const m = payload.ping_metrics
  const st = getStatus(m)
  
  // Softer premium color scheme
  const color = st === 'healthy' ? '#10b981' : st === 'degraded' ? '#f59e0b' : st === 'down' ? '#f43f5e' : '#334155'
 
  const isFocused = focusedLink &&
    focusedLink.sourceName === cleanName(payload.source) &&
    focusedLink.targetName === cleanName(payload.target) &&
    focusedLink.local_interface === payload.local_interface
  const anyFocus = !!focusedLink
 
  // PROBLEM-BASED DYNAMIC OPACITY: Make problematic links stand out dynamically
  let opacity = m ? 0.22 : 0.06
  if (m) {
    if (st === 'down') opacity = 0.65
    else if (st === 'degraded') opacity = 0.45
  }
  if (anyFocus) opacity = isFocused ? 0.95 : 0.02
 
  const lw = Math.max(3, linkWidth || 0)
 
  return (
    <g>
      {/* Glow for focused link */}
      {isFocused && (
        <path d={path} fill="none" stroke={color} strokeWidth={lw+10}
          strokeOpacity={0.25} style={{filter:'blur(8px)', pointerEvents:'none'}}/>
      )}
      {/* SOFT GLOW FOR PROBLEMATIC LINKS: Gives NOC operators instant visual cues */}
      {!isFocused && !anyFocus && (st === 'down' || st === 'degraded') && (
        <path d={path} fill="none" stroke={color} strokeWidth={lw+6}
          strokeOpacity={st === 'down' ? 0.22 : 0.12} style={{filter:'blur(4px)', pointerEvents:'none'}}/>
      )}
      <path d={path} fill="none" stroke={color} strokeWidth={lw} strokeOpacity={opacity}
        style={{ transition:'stroke-opacity 0.25s, stroke-width 0.2s', cursor:'pointer' }}
        onMouseEnter={e => { 
          if (onMouseEnter) onMouseEnter(e);
          if (!anyFocus) {
            e.target.style.strokeOpacity = 0.85; 
          } else if (isFocused) {
            e.target.style.strokeOpacity = 0.95;
          }
          if (setHoveredLink) {
            setHoveredLink({
              link: payload,
              x: e.clientX,
              y: e.clientY
            });
          }
        }}
        onMouseMove={e => {
          if (setHoveredLink) {
            setHoveredLink(prev => prev ? { ...prev, x: e.clientX, y: e.clientY } : null);
          }
        }}
        onMouseLeave={e => { 
          if (onMouseLeave) onMouseLeave(e);
          e.target.style.strokeOpacity=opacity;
          if (setHoveredLink) setHoveredLink(null);
        }}
        onClick={e => {
          if (onClick) onClick(e);
          e.stopPropagation();
          setFocusedLink({
            sourceName: cleanName(payload.source), targetName: cleanName(payload.target),
            local_interface: payload.local_interface, remote_port: payload.remote_port,
            ping_metrics: payload.ping_metrics,
          });
        }}/>
    </g>
  )
}

/* ─────────────────────────────────────────────────────────────────────────────
   TOOLTIP
───────────────────────────────────────────────────────────────────────────── */
const CustomTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null
  const data = payload[0].payload
  if (data.source && data.target) {
    const m = data.ping_metrics
    const st = getStatus(m)
    const sc = STATUS_MAP[st]
    return (
      <div style={{
        background:'rgba(8,10,15,0.97)', border:'1px solid rgba(255,255,255,0.07)',
        borderRadius:12, padding:'14px 18px', boxShadow:'0 24px 64px rgba(0,0,0,0.75)',
        backdropFilter:'blur(24px)', fontSize:12, color:'#e6edf3',
        fontFamily:"'Inter',system-ui,sans-serif", minWidth:240,
      }}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10}}>
          <span style={{fontWeight:700,fontSize:12,color:'#60a5fa',display:'flex',alignItems:'center',gap:6}}>
            <span style={{fontSize:15}}>⛓</span> OSPF Link
          </span>
          <span style={{fontSize:10,fontWeight:700,color:sc.text,background:sc.bg,border:`1px solid ${sc.border}`,borderRadius:6,padding:'2px 8px'}}>
            {m?.historical ? `📊 Historical (${m.time_range})` : sc.label}
          </span>
        </div>
        <div style={{borderTop:'1px solid rgba(255,255,255,0.06)',paddingTop:8,display:'flex',flexDirection:'column',gap:5}}>
          {[['From', cleanName(data.source), data.local_interface, m?.pinged_ips?.a_ip],
            ['To',   cleanName(data.target),  data.remote_port,    m?.pinged_ips?.b_ip]].map(([lbl, name, iface, ip]) => (
            <div key={lbl}>
              <div style={{display:'flex',alignItems:'center',gap:8}}>
                <span style={{fontSize:9,color:'#6b7280',minWidth:30,fontWeight:700,textTransform:'uppercase',letterSpacing:0.5}}>{lbl}</span>
                <span style={{fontWeight:600,color:'#e6edf3'}}>{name}</span>
                {iface && <span style={{fontSize:9,color:'#60a5fa',fontFamily:'monospace'}}>{iface}</span>}
              </div>
              {ip && <div style={{paddingLeft:38,fontSize:9,color:'#6b7280',fontFamily:'monospace'}}>↳ {ip}</div>}
            </div>
          ))}
        </div>
        {m ? (
          <div style={{marginTop:10,paddingTop:10,borderTop:'1px solid rgba(255,255,255,0.06)',display:'grid',gridTemplateColumns:'1fr 1fr',gap:'6px 10px'}}>
            {[['Avg RTT', `${m.rtt_avg}ms`, '#60a5fa'],['Success', `${m.success_rate}%`, sc.text],['Min', `${m.rtt_min}ms`, '#e6edf3'],['Max', `${m.rtt_max}ms`, '#e6edf3']].map(([l,v,c])=>(
              <div key={l} style={{display:'flex',flexDirection:'column',gap:1,background:'rgba(255,255,255,0.03)',borderRadius:6,padding:'5px 7px'}}>
                <span style={{fontSize:9,color:'#6b7280',fontWeight:700,textTransform:'uppercase',letterSpacing:0.4}}>{l}</span>
                <span style={{fontWeight:800,color:c,fontSize:14,fontVariantNumeric:'tabular-nums'}}>{v}</span>
              </div>
            ))}
          </div>
        ) : (
          <div style={{marginTop:8,paddingTop:8,borderTop:'1px solid rgba(255,255,255,0.05)',fontSize:11,color:'#6b7280',fontStyle:'italic'}}>
            No metrics — configure scan settings to begin monitoring.
          </div>
        )}
      </div>
    )
  }
  return (
    <div style={{background:'rgba(8,10,15,0.97)',border:'1px solid rgba(255,255,255,0.07)',borderRadius:10,padding:'10px 14px',boxShadow:'0 12px 40px rgba(0,0,0,0.7)',backdropFilter:'blur(16px)',fontSize:12,color:'#e6edf3',fontFamily:"'Inter',system-ui,sans-serif"}}>
      <div style={{fontWeight:700,color:'#60a5fa',marginBottom:3,display:'flex',alignItems:'center',gap:6}}>
        <span style={{fontSize:14}}>⬡</span>{cleanName(payload[0].payload || payload[0].name)}
      </div>
      <div style={{color:'#6b7280',fontSize:10}}>OSPF Backbone Router</div>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────────
   STAT CARD
───────────────────────────────────────────────────────────────────────────── */
const StatCard = ({ label, value, unit, color, icon, sub }) => (
  <div style={{
    background:'rgba(15,18,26,0.8)', border:`1px solid rgba(255,255,255,0.06)`,
    borderRadius:10, padding:'11px 13px', display:'flex', flexDirection:'column', gap:4,
    position:'relative', overflow:'hidden', cursor:'default',
    transition:'border-color 0.2s, transform 0.15s',
  }}
    onMouseEnter={e=>{e.currentTarget.style.borderColor='rgba(255,255,255,0.12)';e.currentTarget.style.transform='translateY(-1px)'}}
    onMouseLeave={e=>{e.currentTarget.style.borderColor='rgba(255,255,255,0.06)';e.currentTarget.style.transform='translateY(0)'}}>
    <div style={{position:'absolute',top:0,left:0,right:0,height:2,background:`linear-gradient(90deg,${color},transparent)`,opacity:0.8}}/>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
      <span style={{fontSize:9.5,color:'#6b7280',fontWeight:700,textTransform:'uppercase',letterSpacing:0.6}}>{label}</span>
      <span style={{fontSize:12}}>{icon}</span>
    </div>
    <div style={{display:'flex',alignItems:'baseline',gap:3}}>
      <span style={{fontSize:21,fontWeight:800,color,lineHeight:1,fontVariantNumeric:'tabular-nums'}}>{value}</span>
      {unit && <span style={{fontSize:10.5,color:'#6b7280'}}>{unit}</span>}
    </div>
    {sub && <div style={{fontSize:9.5,color:'#4b5563',marginTop:1}}>{sub}</div>}
  </div>
)

/* ─────────────────────────────────────────────────────────────────────────────
   STATUS DOT
───────────────────────────────────────────────────────────────────────────── */
const Dot = ({ status }) => {
  const s = STATUS_MAP[status] || STATUS_MAP.unknown
  return (
    <span style={{
      width:7, height:7, borderRadius:'50%', background:s.dot,
      boxShadow: status === 'healthy' ? `0 0 6px ${s.glow}` : status === 'down' ? `0 0 8px ${s.glow}` : 'none',
      display:'inline-block', flexShrink:0,
    }}/>
  )
}

/* ─────────────────────────────────────────────────────────────────────────────
   LINK DETAIL CARD
───────────────────────────────────────────────────────────────────────────── */
const LinkDetailCard = ({ link, onClear }) => {
  if (!link) return null
  const pm = link.ping_metrics
  const st = getStatus(pm)
  const sc = STATUS_MAP[st]

  return (
    <div style={{background:sc.bg,border:`1px solid ${sc.border}`,borderRadius:10,padding:14,fontSize:12,animation:'fadeSlide 0.2s ease'}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10}}>
        <div style={{display:'flex',alignItems:'center',gap:7}}>
          <Dot status={st}/>
          <span style={{fontWeight:700,color:sc.text,fontSize:12}}>
            {pm?.historical ? `Historical (${pm.time_range})` : sc.label.slice(2)}
          </span>
        </div>
        {onClear && (
          <button onClick={onClear} style={{background:'rgba(255,255,255,0.04)',border:'1px solid rgba(255,255,255,0.08)',borderRadius:5,padding:'2px 8px',fontSize:10,cursor:'pointer',color:'#6b7280',fontWeight:600,transition:'color 0.15s'}}
            onMouseEnter={e=>e.currentTarget.style.color='#e6edf3'} onMouseLeave={e=>e.currentTarget.style.color='#6b7280'}>✕</button>
        )}
      </div>
      <div style={{display:'flex',flexDirection:'column',gap:5}}>
        {[['Source',link.sourceName,link.local_interface,pm?.pinged_ips?.a_ip],
          ['Target',link.targetName,link.remote_port,pm?.pinged_ips?.b_ip]].map(([l,n,iface,ip])=>(
          <div key={l}>
            <div style={{display:'flex',alignItems:'center',gap:6}}>
              <span style={{color:'#6b7280',fontWeight:700,fontSize:9,textTransform:'uppercase',letterSpacing:0.5,minWidth:40}}>{l}</span>
              <span style={{color:'#e6edf3',fontWeight:600}}>{n}</span>
              {iface && <span style={{color:'#60a5fa',fontSize:9,fontFamily:'monospace'}}>({iface})</span>}
            </div>
            {ip && <div style={{paddingLeft:46,fontSize:9,color:'#6b7280',fontFamily:'monospace'}}>IP: {ip}</div>}
          </div>
        ))}
      </div>
      {pm && (
        <div style={{marginTop:10,paddingTop:10,borderTop:'1px solid rgba(255,255,255,0.07)',display:'grid',gridTemplateColumns:'1fr 1fr',gap:'6px 10px'}}>
          {[['RTT Avg',`${pm.rtt_avg}ms`,'#60a5fa'],['Success',`${pm.success_rate}%`,sc.text],['RTT Min',`${pm.rtt_min}ms`,'#e6edf3'],['RTT Max',`${pm.rtt_max}ms`,'#e6edf3']].map(([l,v,c])=>(
            <div key={l} style={{display:'flex',flexDirection:'column',gap:1}}>
              <span style={{fontSize:9,color:'#6b7280',fontWeight:700,textTransform:'uppercase',letterSpacing:0.4}}>{l}</span>
              <span style={{fontWeight:800,color:c,fontVariantNumeric:'tabular-nums'}}>{v}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────────
   LEFT SIDEBAR  (pinnable)
───────────────────────────────────────────────────────────────────────────── */
const LeftSidebar = ({
  pinned, onTogglePin, links, nodes, focusedLink, setFocusedLink,
  stats, filteredCount, totalCount, searchTerm, setSearchTerm,
  linkStatusFilter, setLinkStatusFilter
}) => {
  const [open, setOpen] = useState(true)
  const SIDEBAR_W = 300

  /* pinned = always visible; unpinned = overlay that closes on mouse-leave */
  const visible = pinned ? open : open

  const containerStyle = pinned
    ? {
        width: SIDEBAR_W,
        flexShrink: 0,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: 'rgba(8,10,15,0.92)',
        borderRight: '1px solid rgba(255,255,255,0.06)',
        backdropFilter: 'blur(18px)',
        transition: 'width 0.3s cubic-bezier(0.4,0,0.2,1)',
        overflow: 'hidden',
        position: 'relative',
      }
    : {
        position: 'absolute',
        left: 0,
        top: 0,
        bottom: 0,
        width: open ? SIDEBAR_W : 0,
        zIndex: 20,
        display: 'flex',
        flexDirection: 'column',
        background: 'rgba(8,10,15,0.97)',
        borderRight: '1px solid rgba(255,255,255,0.08)',
        backdropFilter: 'blur(20px)',
        boxShadow: open ? '4px 0 32px rgba(0,0,0,0.6)' : 'none',
        transition: 'width 0.3s cubic-bezier(0.4,0,0.2,1)',
        overflow: 'hidden',
      }

  return (
    <>
      {/* Collapsed tab handle (unpinned + closed) */}
      {!pinned && !open && (
        <div
          onClick={() => setOpen(true)}
          title="Open Link Panel"
          style={{
            position:'absolute', left:0, top:'50%', transform:'translateY(-50%)',
            zIndex:25, width:20, height:80,
            background:'rgba(96,165,250,0.15)',
            border:'1px solid rgba(96,165,250,0.3)',
            borderLeft:'none',
            borderRadius:'0 8px 8px 0',
            cursor:'pointer',
            display:'flex', alignItems:'center', justifyContent:'center',
            transition:'background 0.2s',
          }}
          onMouseEnter={e=>e.currentTarget.style.background='rgba(96,165,250,0.28)'}
          onMouseLeave={e=>e.currentTarget.style.background='rgba(96,165,250,0.15)'}
        >
          <span style={{color:'#60a5fa',fontSize:11,writingMode:'vertical-rl',textOrientation:'mixed',fontWeight:700,letterSpacing:1}}>LINKS</span>
        </div>
      )}

      <div style={containerStyle}>
        {/* Header */}
        <div style={{
          padding:'12px 14px', borderBottom:'1px solid rgba(255,255,255,0.06)',
          display:'flex', alignItems:'center', gap:8, flexShrink:0,
          background:'rgba(0,0,0,0.2)',
        }}>
          <div style={{
            width:26, height:26, borderRadius:7,
            background:'linear-gradient(135deg,#2563eb,#7c3aed)',
            display:'flex', alignItems:'center', justifyContent:'center',
            fontSize:13, flexShrink:0, boxShadow:'0 3px 10px rgba(88,91,255,0.45)',
          }}>⛓</div>
          <div style={{flex:1, minWidth:0}}>
            <div style={{fontSize:11.5, fontWeight:800, color:'#e6edf3', letterSpacing:0.2}}>ISP Link Delay</div>
            <div style={{fontSize:9.5, color:'#6b7280', marginTop:1}}>
              {filteredCount} of {totalCount} peerings
            </div>
          </div>

          {/* Pin / Unpin button */}
          <button
            onClick={onTogglePin}
            title={pinned ? 'Unpin (float panel)' : 'Pin panel'}
            style={{
              width:26, height:26, padding:0,
              background: pinned ? 'rgba(96,165,250,0.15)' : 'rgba(255,255,255,0.04)',
              border:`1px solid ${pinned ? 'rgba(96,165,250,0.35)' : 'rgba(255,255,255,0.08)'}`,
              borderRadius:6, cursor:'pointer',
              display:'flex', alignItems:'center', justifyContent:'center',
              fontSize:13, transition:'all 0.2s', flexShrink:0,
              color: pinned ? '#60a5fa' : '#8b949e',
            }}
            onMouseEnter={e=>{e.currentTarget.style.background='rgba(96,165,250,0.2)';e.currentTarget.style.borderColor='rgba(96,165,250,0.45)'}}
            onMouseLeave={e=>{e.currentTarget.style.background=pinned?'rgba(96,165,250,0.15)':'rgba(255,255,255,0.04)';e.currentTarget.style.borderColor=pinned?'rgba(96,165,250,0.35)':'rgba(255,255,255,0.08)'}}
          >
            {pinned ? '📌' : '📍'}
          </button>

          {/* Close button (only shown when unpinned) */}
          {!pinned && (
            <button onClick={()=>setOpen(false)}
              style={{width:26,height:26,padding:0,background:'rgba(255,255,255,0.04)',border:'1px solid rgba(255,255,255,0.08)',borderRadius:6,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',fontSize:14,color:'#8b949e',transition:'all 0.15s',flexShrink:0}}
              onMouseEnter={e=>{e.currentTarget.style.background='rgba(239,68,68,0.12)';e.currentTarget.style.color='#ef4444'}}
              onMouseLeave={e=>{e.currentTarget.style.background='rgba(255,255,255,0.04)';e.currentTarget.style.color='#8b949e'}}>✕</button>
          )}
        </div>

        {/* Search */}
        <div style={{padding:'10px 12px 8px', flexShrink:0}}>
          <div style={{position:'relative', display:'flex', alignItems:'center'}}>
            <span style={{position:'absolute',left:9,fontSize:11,color:'#6b7280',pointerEvents:'none'}}>🔍</span>
            <input
              type="text" placeholder="Search links..."
              value={searchTerm} onChange={e=>setSearchTerm(e.target.value)}
              style={{
                width:'100%', background:'rgba(22,27,36,0.8)',
                border:'1px solid rgba(255,255,255,0.07)',
                color:'#e6edf3', borderRadius:8, padding:'6px 28px 6px 28px',
                fontSize:11, outline:'none', fontFamily:"'Inter',system-ui,sans-serif",
                transition:'border-color 0.2s, box-shadow 0.2s',
              }}
              onFocus={e=>{e.target.style.borderColor='rgba(96,165,250,0.4)';e.target.style.boxShadow='0 0 0 3px rgba(96,165,250,0.08)'}}
              onBlur={e=>{e.target.style.borderColor='rgba(255,255,255,0.07)';e.target.style.boxShadow='none'}}
            />
            {searchTerm && (
              <button onClick={()=>setSearchTerm('')}
                style={{position:'absolute',right:7,background:'none',border:'none',color:'#6b7280',cursor:'pointer',fontSize:12,padding:'0 2px'}}>✕</button>
            )}
          </div>
        </div>

        {/* Mini stats row */}
        <div style={{
          padding:'0 12px 10px', display:'flex', gap:6, flexShrink:0,
        }}>
          {[
            { v:stats.activeUp,  label:'Up',     statusVal:'healthy',  c:'#10b981' },
            { v:stats.lossyCount,label:'Lossy',  statusVal:'degraded', c:'#f59e0b' },
            { v:stats.downCount, label:'Down',   statusVal:'down',     c:'#ef4444' },
          ].map(({ v, label, statusVal, c }) => {
            const isActive = linkStatusFilter === statusVal
            return (
              <div key={label}
                onClick={() => setLinkStatusFilter(isActive ? 'all' : statusVal)}
                style={{
                  flex:1,
                  background: isActive ? `${c}12` : 'rgba(255,255,255,0.03)',
                  border: `1.5px solid ${isActive ? c : 'rgba(255,255,255,0.06)'}`,
                  borderRadius:7, padding:'5px 6px', textAlign:'center',
                  cursor:'pointer',
                  boxShadow: isActive ? `0 0 10px ${c}25` : 'none',
                  transition: 'all 0.2s ease',
                }}
                onMouseEnter={e => {
                  if (!isActive) {
                    e.currentTarget.style.borderColor = 'rgba(255,255,255,0.15)'
                    e.currentTarget.style.background = 'rgba(255,255,255,0.05)'
                  }
                }}
                onMouseLeave={e => {
                  if (!isActive) {
                    e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)'
                    e.currentTarget.style.background = 'rgba(255,255,255,0.03)'
                  }
                }}
              >
                <div style={{fontSize:15, fontWeight:800, color:c, fontVariantNumeric:'tabular-nums'}}>{v}</div>
                <div style={{fontSize:9, color: isActive ? c : '#6b7280', fontWeight:700, textTransform:'uppercase', letterSpacing:0.4}}>{label}</div>
              </div>
            )
          })}
        </div>

        {/* Links table */}
        <div className="sankey-scroll" style={{flex:1, overflowY:'auto', minHeight:0}}>
          <table style={{width:'100%', borderCollapse:'collapse', fontSize:11}}>
            <thead>
              <tr style={{position:'sticky',top:0,background:'rgba(8,10,15,0.98)',backdropFilter:'blur(8px)',zIndex:1}}>
                {['Peering','RTT','Loss'].map((h,i)=>(
                  <th key={h} style={{
                    padding:'7px '+(i===0?'14px':'6px'), textAlign:i===0?'left':'right',
                    fontWeight:700, fontSize:9, textTransform:'uppercase', letterSpacing:0.7,
                    color:'#6b7280', borderBottom:'1px solid rgba(255,255,255,0.05)',
                    ...(i===2?{paddingRight:14}:{}),
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {links.map((l, idx) => {
                const m = l.ping_metrics
                const srcNode = nodes[l.source]
                const tgtNode = nodes[l.target]
                const st = getStatus(m)
                const sc = STATUS_MAP[st]
                const isCurrent = focusedLink &&
                  focusedLink.sourceName === cleanName(srcNode) &&
                  focusedLink.targetName === cleanName(tgtNode) &&
                  focusedLink.local_interface === l.local_interface

                return (
                  <tr key={idx}
                    className="sankey-link-row"
                    onClick={e=>{
                      e.stopPropagation()
                      setFocusedLink({
                        sourceName:cleanName(srcNode), targetName:cleanName(tgtNode),
                        local_interface:l.local_interface, remote_port:l.remote_port,
                        ping_metrics:l.ping_metrics,
                      })
                    }}
                    style={{
                      borderBottom:'1px solid rgba(255,255,255,0.025)',
                      cursor:'pointer',
                      background: isCurrent ? 'rgba(96,165,250,0.08)' : 'transparent',
                      borderLeft: isCurrent ? '2px solid #60a5fa' : '2px solid transparent',
                      transition:'background 0.15s',
                    }}>
                    <td style={{padding:'9px 14px 9px 12px', verticalAlign:'middle'}}>
                      <div style={{display:'flex',alignItems:'center',gap:7}}>
                        <Dot status={st}/>
                        <div style={{minWidth:0}}>
                          <div style={{fontWeight:600,color:'#e6edf3',fontSize:11,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                            {cleanName(srcNode)}
                            {m?.pinged_ips?.a_ip && <span style={{fontSize:8.5,color:'#3b82f6',fontFamily:'monospace',marginLeft:3,fontWeight:400}}>({m.pinged_ips.a_ip})</span>}
                          </div>
                          <div style={{color:'#6b7280',fontSize:9.5,marginTop:2,display:'flex',alignItems:'center',gap:3}}>
                            <span style={{fontSize:8.5}}>⟷</span>
                            <span>{cleanName(tgtNode)}</span>
                            {m?.pinged_ips?.b_ip && <span style={{fontSize:8.5,color:'#3b82f6',fontFamily:'monospace'}}>({m.pinged_ips.b_ip})</span>}
                          </div>
                          {l.local_interface && <div style={{fontSize:8.5,color:'#374151',marginTop:1,fontFamily:'monospace'}}>{l.local_interface}</div>}
                        </div>
                      </div>
                    </td>
                    <td style={{padding:'9px 6px',textAlign:'right',fontWeight:700,color:m?'#60a5fa':'#374151',verticalAlign:'middle',fontFamily:'monospace',fontSize:11,fontVariantNumeric:'tabular-nums'}}>
                      {m?<>{m.rtt_avg}<span style={{fontSize:8.5,fontWeight:400,color:'#6b7280'}}>ms</span></>:'—'}
                    </td>
                    <td style={{padding:'9px 14px 9px 4px',textAlign:'right',fontWeight:700,
                      color:m?(m.success_rate>=100?'#10b981':m.success_rate>0?'#f59e0b':'#ef4444'):'#374151',
                      verticalAlign:'middle',fontFamily:'monospace',fontSize:11,fontVariantNumeric:'tabular-nums'}}>
                      {m?<>{100-m.success_rate}<span style={{fontSize:8.5,fontWeight:400,color:'#6b7280'}}>%</span></>:'—'}
                    </td>
                  </tr>
                )
              })}
              {links.length === 0 && (
                <tr><td colSpan={3} style={{padding:'24px 14px',textAlign:'center',color:'#6b7280',fontSize:11}}>
                  <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:5}}>
                    <span style={{fontSize:20,opacity:0.3}}>🔍</span>No matching peerings.
                  </div>
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}

/* ─────────────────────────────────────────────────────────────────────────────
   RIGHT SIDEBAR  (settings + stats + focused detail)
───────────────────────────────────────────────────────────────────────────── */
const RightSidebar = ({
  pinned, onTogglePin,
  ospfPingTimestamp,
  stats, focusedLink, setFocusedLink, dashMin, setDashMin,
  ospfTimeRange, setOspfTimeRange,
  customStart, setCustomStart,
  customEnd, setCustomEnd,
  onRefreshTopology,
  intervalType, setIntervalType,
  customValue, setCustomValue,
  loadingConfig,
  savingConfig,
  triggeringRun,
  handleSaveConfig,
  handleRunNow,
  settingsMin, setSettingsMin,
}) => {
  const [open, setOpen] = useState(true)
  const SIDEBAR_W = 330

  const containerStyle = pinned
    ? {
        width: SIDEBAR_W,
        flexShrink: 0,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: 'rgba(8,10,15,0.88)',
        borderLeft: '1px solid rgba(255,255,255,0.06)',
        backdropFilter: 'blur(18px)',
        transition: 'width 0.3s cubic-bezier(0.4,0,0.2,1)',
        overflow: 'hidden',
        position: 'relative',
      }
    : {
        position: 'absolute',
        right: 0,
        top: 0,
        bottom: 0,
        width: open ? SIDEBAR_W : 0,
        zIndex: 20,
        display: 'flex',
        flexDirection: 'column',
        background: 'rgba(8,10,15,0.97)',
        borderLeft: open ? '1px solid rgba(255,255,255,0.08)' : 'none',
        backdropFilter: 'blur(20px)',
        boxShadow: open ? '-4px 0 32px rgba(0,0,0,0.6)' : 'none',
        transition: 'width 0.3s cubic-bezier(0.4,0,0.2,1)',
        overflow: 'hidden',
      }

  return (
    <>
      {/* Collapsed tab handle (unpinned + closed) */}
      {!pinned && !open && (
        <div
          onClick={() => setOpen(true)}
          title="Open Settings & Performance"
          style={{
            position:'absolute', right:0, top:'50%', transform:'translateY(-50%)',
            zIndex:25, width:20, height:180,
            background:'rgba(96,165,250,0.15)',
            border:'1px solid rgba(96,165,250,0.3)',
            borderRight:'none',
            borderRadius:'8px 0 0 8px',
            cursor:'pointer',
            display:'flex', alignItems:'center', justifyContent:'center',
            transition:'background 0.2s',
          }}
          onMouseEnter={e=>e.currentTarget.style.background='rgba(96,165,250,0.28)'}
          onMouseLeave={e=>e.currentTarget.style.background='rgba(96,165,250,0.15)'}
        >
          <span style={{color:'#60a5fa',fontSize:10,writingMode:'vertical-rl',textOrientation:'mixed',fontWeight:700,letterSpacing:1}}>SETTINGS & PERFORMANCE</span>
        </div>
      )}

      <div style={containerStyle}>
        <div style={{ width: SIDEBAR_W, height: '100%', display: 'flex', flexDirection: 'column', overflowY: 'auto' }} className="sankey-scroll">
        {/* Header toolbar for pinning / close */}
        <div style={{
          padding:'12px 16px', borderBottom:'1px solid rgba(255,255,255,0.06)',
          display:'flex', alignItems:'center', justifyContent:'space-between', flexShrink:0,
          background:'rgba(0,0,0,0.2)',
        }}>
          <span style={{fontSize:11, fontWeight:800, color:'#e6edf3', letterSpacing:0.5}}>CONTROL CENTER</span>
          <div style={{display:'flex', alignItems:'center', gap:8}}>
            {/* Pin / Unpin button */}
            <button
              onClick={onTogglePin}
              title={pinned ? 'Unpin (float panel)' : 'Pin panel'}
              style={{
                width:26, height:26, padding:0,
                background: pinned ? 'rgba(96,165,250,0.15)' : 'rgba(255,255,255,0.04)',
                border:`1px solid ${pinned ? 'rgba(96,165,250,0.35)' : 'rgba(255,255,255,0.08)'}`,
                borderRadius:6, cursor:'pointer',
                display:'flex', alignItems:'center', justifyContent:'center',
                fontSize:13, transition:'all 0.2s', flexShrink:0,
                color: pinned ? '#60a5fa' : '#8b949e',
              }}
              onMouseEnter={e=>{e.currentTarget.style.background='rgba(96,165,250,0.2)';e.currentTarget.style.borderColor='rgba(96,165,250,0.45)'}}
              onMouseLeave={e=>{e.currentTarget.style.background=pinned?'rgba(96,165,250,0.15)':'rgba(255,255,255,0.04)';e.currentTarget.style.borderColor=pinned?'rgba(96,165,250,0.35)':'rgba(255,255,255,0.08)'}}
            >
              {pinned ? '📌' : '📍'}
            </button>
            {/* Close button (only shown when unpinned) */}
            {!pinned && (
              <button onClick={()=>setOpen(false)}
                style={{width:26,height:26,padding:0,background:'rgba(255,255,255,0.04)',border:'1px solid rgba(255,255,255,0.08)',borderRadius:6,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',fontSize:14,color:'#8b949e',transition:'all 0.15s',flexShrink:0}}
                onMouseEnter={e=>{e.currentTarget.style.background='rgba(239,68,68,0.12)';e.currentTarget.style.color='#ef4444'}}
                onMouseLeave={e=>{e.currentTarget.style.background='rgba(255,255,255,0.04)';e.currentTarget.style.color='#8b949e'}}>✕</button>
            )}
          </div>
        </div>

        {/* ── Targets Information ── */}
        <div style={{padding:'14px 16px', borderBottom:'1px solid rgba(255,255,255,0.05)', flexShrink:0, background:'rgba(0,0,0,0.15)'}}>
          <div style={{display:'flex',alignItems:'center',gap:7}}>
            <span style={{
              width:22,height:22,borderRadius:6,
              background:'linear-gradient(135deg,#1d4ed8,#7c3aed)',
              display:'flex',alignItems:'center',justifyContent:'center',
              fontSize:11,boxShadow:'0 2px 8px rgba(88,91,255,0.4)',flexShrink:0,
            }}>📋</span>
            <span style={{fontSize:10.5,fontWeight:800,color:'#60a5fa',textTransform:'uppercase',letterSpacing:0.8}}>ISP Ping Targets</span>
          </div>
          <div style={{marginTop:12, display:'flex',alignItems:'center',gap:6,fontSize:10.5,color:'#6b7280'}}>
            <span style={{fontSize:12}}>🕒</span>
            Last Updated:
            {ospfPingTimestamp
              ? <span style={{color:'#8b949e',fontWeight:500,marginLeft:2}}>{new Date(ospfPingTimestamp*1000).toLocaleString()}</span>
              : <span style={{fontStyle:'italic',color:'#374151',marginLeft:2}}>Never updated</span>
            }
          </div>
        </div>

        {/* ── ISP Link Scan Settings ── */}
        <div style={{padding:'14px 16px', borderBottom:'1px solid rgba(255,255,255,0.05)', flexShrink:0}}>
          <div className="s-header" onClick={()=>setSettingsMin(v=>!v)} style={{display:'flex',alignItems:'center',justifyContent:'space-between',cursor:'pointer',userSelect:'none',padding:'6px 10px',margin:'-6px -10px',borderRadius:8,transition:'background 0.2s'}}>
            <div style={{display:'flex',alignItems:'center',gap:7}}>
              <span style={{
                width:22,height:22,borderRadius:6,
                background:'linear-gradient(135deg,#e11d48,#be123c)',
                display:'flex',alignItems:'center',justifyContent:'center',
                fontSize:11,boxShadow:'0 2px 8px rgba(225,29,72,0.4)',flexShrink:0,
              }}>⚙️</span>
              <span style={{fontSize:10.5,fontWeight:800,color:'#e6edf3',textTransform:'uppercase',letterSpacing:0.8}}>
                ISP Link Scan Settings
              </span>
            </div>
            <span style={{fontSize:9,color:'#6b7280',transition:'transform 0.3s',transform:settingsMin?'rotate(-90deg)':'none'}}>▼</span>
          </div>

          <div style={{
            maxHeight:settingsMin?0:400, opacity:settingsMin?0:1, overflow:'hidden',
            transition:'max-height 0.35s ease, opacity 0.25s ease', marginTop:settingsMin?0:12,
            display:'flex', flexDirection:'column', gap:10,
          }}>
            {loadingConfig ? (
              <div style={{fontSize:11,color:'#8b949e',fontStyle:'italic'}}>Loading configuration...</div>
            ) : (
              <form onSubmit={handleSaveConfig} style={{display:'flex',flexDirection:'column',gap:10}}>
                <div style={{display:'flex',alignItems:'center',gap:8}}>
                  <span style={{fontSize:9.5,color:'#6b7280',fontWeight:700,textTransform:'uppercase',letterSpacing:0.5,minWidth:65}}>Interval</span>
                  <select id="scan-interval-select" name="interval_type" value={intervalType} onChange={e=>setIntervalType(e.target.value)}
                    style={{flex:1,background:'rgba(22,27,36,0.9)',border:'1px solid rgba(255,255,255,0.08)',color:'#e6edf3',borderRadius:7,padding:'5px 8px',fontSize:11.5,cursor:'pointer',outline:'none',fontFamily:"'Inter',system-ui,sans-serif"}}
                    onFocus={e=>e.target.style.borderColor='rgba(225,29,72,0.4)'}
                    onBlur={e=>e.target.style.borderColor='rgba(255,255,255,0.08)'}>
                    <option value="10">Every 10 min</option>
                    <option value="20">Every 20 min</option>
                    <option value="30">Every 30 min</option>
                    <option value="60">Every 60 min</option>
                    <option value="custom">Custom...</option>
                  </select>
                </div>

                {intervalType === 'custom' && (
                  <div style={{display:'flex',alignItems:'center',gap:8,animation:'fadeSlide 0.2s ease'}}>
                    <span style={{fontSize:9.5,color:'#6b7280',fontWeight:700,textTransform:'uppercase',letterSpacing:0.5,minWidth:65}}>Minutes</span>
                    <input id="custom-interval-input" name="custom_value" type="number" min="1" value={customValue} onChange={e=>setCustomValue(e.target.value)}
                      style={{flex:1,background:'rgba(22,27,36,0.9)',border:'1px solid rgba(255,255,255,0.08)',color:'#e6edf3',borderRadius:7,padding:'4px 8px',fontSize:11.5,outline:'none'}}
                      onFocus={e=>e.target.style.borderColor='rgba(225,29,72,0.4)'}
                      onBlur={e=>e.target.style.borderColor='rgba(255,255,255,0.08)'}/>
                  </div>
                )}

                <div style={{display:'flex',gap:8,marginTop:4}}>
                  <button type="submit" disabled={savingConfig}
                    style={{
                      flex:1,padding:'6px 10px',fontSize:11,fontWeight:700,borderRadius:6,
                      background:savingConfig ? 'rgba(255,255,255,0.05)' : 'linear-gradient(135deg,#be123c,#9f1239)',
                      color:savingConfig ? '#4b5563' : 'white',border:'none',cursor:savingConfig?'not-allowed':'pointer',
                      transition:'all 0.2s',textAlign:'center'
                    }}
                    onMouseEnter={e=>{if(!savingConfig) e.currentTarget.style.boxShadow='0 2px 8px rgba(190,18,60,0.3)'}}
                    onMouseLeave={e=>{if(!savingConfig) e.currentTarget.style.boxShadow='none'}}>
                    {savingConfig ? 'Saving...' : '💾 Save Settings'}
                  </button>
                  <button type="button" onClick={handleRunNow} disabled={triggeringRun}
                    style={{
                      flex:1,padding:'6px 10px',fontSize:11,fontWeight:700,borderRadius:6,
                      background:triggeringRun ? 'rgba(255,255,255,0.05)' : 'linear-gradient(135deg,#0284c7,#0369a1)',
                      color:triggeringRun ? '#0284c7' : 'white',border:'none',cursor:triggeringRun?'wait':'pointer',
                      transition:'all 0.2s',textAlign:'center',display:'flex',alignItems:'center',justifyContent:'center',gap:4
                    }}
                    onMouseEnter={e=>{if(!triggeringRun) e.currentTarget.style.boxShadow='0 2px 8px rgba(2,132,199,0.3)'}}
                    onMouseLeave={e=>{if(!triggeringRun) e.currentTarget.style.boxShadow='none'}}>
                    {triggeringRun ? (
                      <>
                        <span className="spinner-mini"></span> Scanning...
                      </>
                    ) : '⚡ Run Now'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>

    {/* ── Time Range Settings ── */}
    <div style={{padding:'14px 16px', borderBottom:'1px solid rgba(255,255,255,0.05)', flexShrink:0}}>
      <div style={{display:'flex',alignItems:'center',gap:7,marginBottom:12}}>
        <span style={{
          width:22,height:22,borderRadius:6,
          background:'linear-gradient(135deg,#3b82f6,#60a5fa)',
          display:'flex',alignItems:'center',justifyContent:'center',
          fontSize:11,boxShadow:'0 2px 8px rgba(96,165,250,0.4)',flexShrink:0,
        }}>📅</span>
        <span style={{fontSize:10.5,fontWeight:800,color:'#60a5fa',textTransform:'uppercase',letterSpacing:0.8}}>ISP Metrics Time Range</span>
      </div>

      <div style={{display:'flex',flexDirection:'column',gap:10}}>
        {/* Dropdown selector */}
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          <span style={{fontSize:9.5,color:'#6b7280',fontWeight:700,textTransform:'uppercase',letterSpacing:0.5,minWidth:50}}>Range</span>
          <select value={ospfTimeRange} onChange={e=>{
            setOspfTimeRange(e.target.value);
            if (e.target.value !== 'custom') {
              onRefreshTopology(e.target.value);
            }
          }}
            style={{flex:1,background:'rgba(22,27,36,0.9)',border:'1px solid rgba(255,255,255,0.08)',color:'#e6edf3',borderRadius:7,padding:'5px 8px',fontSize:11.5,cursor:'pointer',outline:'none',fontFamily:"'Inter',system-ui,sans-serif"}}
            onFocus={e=>e.target.style.borderColor='rgba(96,165,250,0.4)'}
            onBlur={e=>e.target.style.borderColor='rgba(255,255,255,0.08)'}>
            {[['latest','Latest Run (Instant)'],['24h','Last 24 Hours (Avg)'],['7d','Last 7 Days (Avg)'],['30d','Last 30 Days (Avg)'],['custom','Custom Range...']].map(([v,l])=><option key={v} value={v}>{l}</option>)}
          </select>
        </div>

        {/* Custom DateTime Pickers */}
        {ospfTimeRange === 'custom' && (
          <div style={{display:'flex',flexDirection:'column',gap:8,background:'rgba(255,255,255,0.02)',border:'1px solid rgba(255,255,255,0.05)',borderRadius:8,padding:10,animation:'fadeSlide 0.2s ease'}}>
            <div style={{display:'flex',alignItems:'center',gap:8}}>
              <span style={{fontSize:9,color:'#6b7280',fontWeight:700,textTransform:'uppercase',minWidth:40}}>Start</span>
              <input type="datetime-local" value={customStart} onChange={e=>setCustomStart(e.target.value)}
                style={{flex:1,background:'rgba(22,27,36,0.9)',border:'1px solid rgba(255,255,255,0.08)',color:'#e6edf3',borderRadius:7,padding:'4px 6px',fontSize:11,outline:'none',colorScheme:'dark'}}/>
            </div>
            <div style={{display:'flex',alignItems:'center',gap:8}}>
              <span style={{fontSize:9,color:'#6b7280',fontWeight:700,textTransform:'uppercase',minWidth:40}}>End</span>
              <input type="datetime-local" value={customEnd} onChange={e=>setCustomEnd(e.target.value)}
                style={{flex:1,background:'rgba(22,27,36,0.9)',border:'1px solid rgba(255,255,255,0.08)',color:'#e6edf3',borderRadius:7,padding:'4px 6px',fontSize:11,outline:'none',colorScheme:'dark'}}/>
            </div>
            <button onClick={() => onRefreshTopology('custom', customStart, customEnd)}
              style={{
                width:'100%',padding:'6px',fontSize:11,fontWeight:700,borderRadius:6,
                background:'linear-gradient(135deg,#3b82f6,#2563eb)',
                color:'white',border:'none',cursor:'pointer',marginTop:4,transition:'all 0.2s'
              }}
              onMouseEnter={e=>e.currentTarget.style.boxShadow='0 2px 8px rgba(37,99,235,0.3)'}
              onMouseLeave={e=>e.currentTarget.style.boxShadow='none'}>
              🔍 Apply Custom Range
            </button>
          </div>
        )}
      </div>
    </div>

    {/* ── Performance Dashboard ── */}
    <div style={{padding:'14px 16px', borderBottom:'1px solid rgba(255,255,255,0.05)', flexShrink:0}}>
      <div className="s-header" onClick={()=>setDashMin(v=>!v)} style={{display:'flex',alignItems:'center',justifyContent:'space-between',cursor:'pointer',userSelect:'none',padding:'6px 10px',margin:'-6px -10px',borderRadius:8,transition:'background 0.2s'}}>
        <div style={{display:'flex',alignItems:'center',gap:7}}>
          <span style={{
            width:22,height:22,borderRadius:6,
            background:'linear-gradient(135deg,#0f766e,#059669)',
            display:'flex',alignItems:'center',justifyContent:'center',
            fontSize:11,boxShadow:'0 2px 8px rgba(5,150,105,0.4)',flexShrink:0,
          }}>📈</span>
          <span style={{fontSize:10.5,fontWeight:800,color:'#e6edf3',textTransform:'uppercase',letterSpacing:0.8}}>
            {focusedLink?'Selected Link':'Performance'}
          </span>
        </div>
        <span style={{fontSize:9,color:'#6b7280',transition:'transform 0.3s',transform:dashMin?'rotate(-90deg)':'none'}}>▼</span>
      </div>

      <div style={{
        maxHeight:dashMin?0:540, opacity:dashMin?0:1, overflow:'hidden',
        transition:'max-height 0.35s ease, opacity 0.25s ease', marginTop:dashMin?0:12,
        display:'flex', flexDirection:'column', gap:10,
      }}>
        {/* Focus pill */}
        {focusedLink && (
          <div style={{background:'rgba(96,165,250,0.07)',border:'1px solid rgba(96,165,250,0.18)',borderRadius:7,padding:'6px 10px',fontSize:10.5,display:'flex',alignItems:'center',justifyContent:'space-between',gap:8,animation:'fadeSlide 0.2s ease'}}>
            <span style={{color:'#8b949e',display:'flex',alignItems:'center',gap:5}}><span style={{color:'#60a5fa'}}>🔍</span>Focused link stats</span>
            <button onClick={()=>setFocusedLink(null)} style={{padding:'2px 7px',fontSize:9.5,background:'rgba(255,255,255,0.04)',border:'1px solid rgba(255,255,255,0.08)',borderRadius:4,cursor:'pointer',color:'#6b7280',fontWeight:600,transition:'color 0.15s'}}
              onMouseEnter={e=>e.currentTarget.style.color='#e6edf3'} onMouseLeave={e=>e.currentTarget.style.color='#6b7280'}>✕ Reset</button>
          </div>
        )}

        {/* Stat grid */}
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
          <StatCard label="Total Links" value={stats.totalLinks} icon="⛓" color="#60a5fa" sub={`${stats.measuredCount} monitored`}/>
          <StatCard label="Avg Latency" value={stats.avgLatency} unit="ms" icon="⚡" color="#a78bfa" sub={stats.measuredCount?`across ${stats.measuredCount}`:'no data'}/>
          <StatCard label="Healthy" value={stats.activeUp} icon="✓" color="#34d399" sub={`of ${stats.totalLinks}`}/>
          <StatCard label="Issues" value={stats.lossyCount} icon="⚠" color={stats.lossyCount>0?'#f87171':'#6b7280'} sub={stats.inactive>0?`${stats.inactive} unreachable`:'all up'}/>
        </div>

        {/* Detail card */}
        {focusedLink ? (
          <LinkDetailCard link={focusedLink} onClear={()=>setFocusedLink(null)}/>
        ) : stats.worstLink && (
          <div style={{background:'rgba(239,68,68,0.07)',border:'1px solid rgba(239,68,68,0.2)',borderRadius:10,padding:13,fontSize:12}}>
            <div style={{display:'flex',alignItems:'center',gap:7,marginBottom:8}}>
              <Dot status="down"/>
              <span style={{fontWeight:700,color:'#ef4444'}}>High Latency Bottleneck</span>
            </div>
            <div style={{color:'#9ca3af',marginBottom:6}}>
              <span style={{color:'#e6edf3',fontWeight:600}}>{stats.worstLink.source}</span>
              <span style={{color:'#4b5563',margin:'0 5px'}}>⟷</span>
              <span style={{color:'#e6edf3',fontWeight:600}}>{stats.worstLink.target}</span>
            </div>
            {stats.worstLink.interface && <div style={{fontSize:9.5,color:'#60a5fa',fontFamily:'monospace',marginBottom:6}}>{stats.worstLink.interface}</div>}
            <div style={{display:'flex',gap:16}}>
              {[['Latency',`${stats.worstLink.rtt}ms`],['Success',`${stats.worstLink.success}%`]].map(([l,v])=>(
                <div key={l}>
                  <div style={{fontSize:9,color:'#6b7280',fontWeight:700,textTransform:'uppercase',letterSpacing:0.4}}>{l}</div>
                  <div style={{fontWeight:800,color:'#f87171',fontSize:16,fontVariantNumeric:'tabular-nums'}}>{v}</div>
                </div>
              ))}
            </div>
          </div>
        )}
        </div>
      </div>
    </div>
  </div>
</>
  )
}

/* ─────────────────────────────────────────────────────────────────────────────
   MAIN COMPONENT
───────────────────────────────────────────────────────────────────────────── */
export default function TopologySankey({
  nodes,
  edges,
  ospfPingTimestamp,
  onRefreshTopology,
  ospfTimeRange,
  setOspfTimeRange,
  customStart,
  setCustomStart,
  customEnd,
  setCustomEnd
}) {
  const [searchTerm, setSearchTerm]     = useState('')
  const [showTargetsModal, setShowTargetsModal] = useState(false)
  const [modalMaximized, setModalMaximized]     = useState(false)
  const [targetsList, setTargetsList]           = useState([])
  const [editingTarget, setEditingTarget]       = useState(null)
  const [newSource, setNewSource]               = useState('')
  const [newTargetIp, setNewTargetIp]           = useState('')
  const [newSuccessRate, setNewSuccessRate]     = useState(100)
  const [newRttMin, setNewRttMin]               = useState(150)
  const [newRttAvg, setNewRttAvg]               = useState(200)
  const [newRttMax, setNewRttMax]               = useState(250)
 
  // ISP Ping Scan config & execution states
  const [config, setConfig] = useState(null)
  const [settingsMin, setSettingsMin] = useState(false)
  const [intervalType, setIntervalType] = useState('10') // '10' | '20' | '30' | '60' | 'custom'
  const [customValue, setCustomValue] = useState('10')
  const [loadingConfig, setLoadingConfig] = useState(false)
  const [savingConfig, setSavingConfig] = useState(false)
  const [triggeringRun, setTriggeringRun] = useState(false)
  
  const pollRef = useRef(null)
  const prevTsRef = useRef(ospfPingTimestamp)

  // Fetch ISP ping configuration on mount
  useEffect(() => {
    setLoadingConfig(true)
    getIspPingConfig()
      .then(cfg => {
        setConfig(cfg)
        const mins = cfg.interval_minutes || 10
        if ([10, 20, 30, 60].includes(mins)) {
          setIntervalType(String(mins))
        } else {
          setIntervalType('custom')
          setCustomValue(String(mins))
        }
      })
      .catch(err => console.error("Failed to load ISP ping config", err))
      .finally(() => setLoadingConfig(false))
  }, [])

  // Track the changes in ospfPingTimestamp to reset triggeringRun spinner
  useEffect(() => {
    if (ospfPingTimestamp && prevTsRef.current && ospfPingTimestamp > prevTsRef.current) {
      setTriggeringRun(false)
    }
    prevTsRef.current = ospfPingTimestamp
  }, [ospfPingTimestamp])

  // Poll for topology refreshes when scanning in progress
  useEffect(() => {
    if (triggeringRun) {
      pollRef.current = setInterval(() => {
        if (onRefreshTopology) {
          onRefreshTopology(ospfTimeRange, customStart, customEnd)
        }
      }, 5000)
    } else {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current)
      }
    }
  }, [triggeringRun, onRefreshTopology, ospfTimeRange, customStart, customEnd])

  const handleSaveConfig = async (e) => {
    if (e) e.preventDefault()
    setSavingConfig(true)
    try {
      const mins = intervalType === 'custom' ? parseInt(customValue, 10) : parseInt(intervalType, 10)
      if (isNaN(mins) || mins <= 0) {
        alert("Please enter a valid positive number of minutes.")
        setSavingConfig(false)
        return
      }
      const updated = await saveIspPingConfig({ interval_minutes: mins })
      setConfig(updated.config)
      alert("ISP Link scan settings saved successfully!")
    } catch (err) {
      console.error("Failed to save config", err)
      alert("Error saving settings: " + (err.message || err))
    } finally {
      setSavingConfig(false)
    }
  }

  const handleRunNow = async () => {
    setTriggeringRun(true)
    prevTsRef.current = ospfPingTimestamp
    try {
      await runIspPingNow()
      if (onRefreshTopology) {
        onRefreshTopology(ospfTimeRange, customStart, customEnd)
      }
    } catch (err) {
      console.error("Failed to trigger run", err)
      alert("Error triggering run: " + (err.message || err))
      setTriggeringRun(false)
    }
  }

  // Target config modal enhancement states
  const [newDestinationRouter, setNewDestinationRouter] = useState('')
  const [destType, setDestType]                         = useState('router') // 'router' | 'ip'
  const [modalSearchTerm, setModalSearchTerm]           = useState('')
  const [sortField, setSortField]                       = useState('source')
  const [sortAsc, setSortAsc]                           = useState(true)

  const routerIpMap = useMemo(() => {
    const map = {}
    nodes.forEach(n => {
      if (n.ip) map[n.id] = n.ip
    })
    return map
  }, [nodes])

  const availableDestRouters = useMemo(() => {
    return nodes
      .filter(n => (n.device_type === 'router' || n.id.includes('CORE') || n.id.includes('ISP')) && n.ip)
      .map(n => ({ id: n.id, ip: n.ip }))
      .sort((a, b) => a.id.localeCompare(b.id))
  }, [nodes])

  const filteredAndSortedTargets = useMemo(() => {
    let list = [...targetsList]
    list = list.map(t => {
      const resolvedDest = t.destination_router || Object.keys(routerIpMap).find(k => routerIpMap[k] === t.target_ip)
      return {
        ...t,
        resolved_dest: resolvedDest || 'Internet / External'
      }
    })

    if (modalSearchTerm) {
      const q = modalSearchTerm.toLowerCase()
      list = list.filter(t => 
        t.source.toLowerCase().includes(q) ||
        t.resolved_dest.toLowerCase().includes(q) ||
        t.target_ip.toLowerCase().includes(q)
      )
    }

    list.sort((a, b) => {
      let valA = a[sortField] || ''
      let valB = b[sortField] || ''
      if (sortField === 'destination_router') {
        valA = a.resolved_dest
        valB = b.resolved_dest
      }
      const comp = String(valA).localeCompare(String(valB), undefined, { numeric: true, sensitivity: 'base' })
      return sortAsc ? comp : -comp
    })

    return list
  }, [targetsList, modalSearchTerm, sortField, sortAsc, routerIpMap])

  const handleSort = (field) => {
    if (sortField === field) {
      setSortAsc(prev => !prev)
    } else {
      setSortField(field)
      setSortAsc(true)
    }
  }

  const renderSortIndicator = (field) => {
    if (sortField !== field) return null
    return sortAsc ? ' ▲' : ' ▼'
  }

  const handleUpdateThreshold = (source, target_ip, field, value) => {
    setTargetsList(prev => prev.map(item => {
      if (item.source === source && item.target_ip === target_ip) {
        return { ...item, [field]: value }
      }
      return item
    }))
  }

  const resetForm = () => {
    setNewSource('')
    setNewTargetIp('')
    setNewDestinationRouter('')
    setNewSuccessRate(100)
    setNewRttMin(150)
    setNewRttAvg(200)
    setNewRttMax(250)
    setEditingTarget(null)
  }

  useEffect(() => {
    if (showTargetsModal) {
      getIspPingTargets()
        .then(data => setTargetsList(data || []))
        .catch(err => console.error("Failed to load targets", err))
    }
  }, [showTargetsModal])

  const availableRouters = useMemo(() => {
    return nodes
      .filter(n => n.device_type === 'router' || n.id.includes('CORE') || n.id.includes('ISP'))
      .map(n => n.id)
      .sort()
  }, [nodes])
  const [focusedLink, setFocusedLink]   = useState(null)
  const [hoveredLink, setHoveredLink]   = useState(null)
  const [linkStatusFilter, setLinkStatusFilter] = useState('all')
  const [leftPinned, setLeftPinned]     = useState(true)   // pin state
  const [rightPinned, setRightPinned]   = useState(true)   // right pin state
  const [dashMin, setDashMin]           = useState(false)
  const [scale, setScale]       = useState(1)
  const [position, setPosition] = useState({ x:0, y:0 })
  const [isDragging, setIsDragging] = useState(false)
  const [dragStart, setDragStart]   = useState({ x:0, y:0 })
  const [containerWidth, setContainerWidth] = useState(800)

  const svgWrapRef  = useRef(null)

  /* ResizeObserver */
  useEffect(() => {
    if (!svgWrapRef.current) return
    const ro = new ResizeObserver(entries => {
      for (let e of entries) e.contentRect && setContainerWidth(e.contentRect.width)
    })
    ro.observe(svgWrapRef.current)
    return () => ro.disconnect()
  }, [])

  /* Zoom / Pan */
  const handleWheel = useCallback(e => {
    e.preventDefault()
    setScale(s => Math.max(0.3, Math.min(5, s + (e.deltaY < 0 ? 0.08 : -0.08))))
  }, [])
  const handleMouseDown = e => {
    if (e.button !== 0) return
    setIsDragging(true)
    setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y })
  }
  const handleMouseMove = e => {
    if (!isDragging) return
    setPosition({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y })
  }
  const handleMouseUp = () => setIsDragging(false)
  const resetZoom = () => { setScale(1); setPosition({ x:0, y:0 }) }

  /* Sankey data */
  const sankeyData = useMemo(() => {
    const isCore = (name) => /CORE/i.test(cleanName(name))

    const ospfEdges = edges.filter(e => e.protocol === 'isp')
    const activeIds = new Set()
    ospfEdges.forEach(e => { activeIds.add(e.source); activeIds.add(e.target) })
    const nodeList = nodes.filter(n => activeIds.has(n.id)).map(n => ({ name:n.id, label:n.label||n.id }))
    
    // Sort all active nodes alphabetically to establish unique ranks
    const sortedNodeNames = [...activeIds].sort()
    const getRank = (name) => {
      if (isCore(name)) return 0
      return 1 + sortedNodeNames.indexOf(name)
    }

    const idx = {}; nodeList.forEach((n,i) => idx[n.name]=i)
    const links = []
    ospfEdges.forEach(e => {
      let s = e.source
      let t = e.target

      // Skip core-to-core links to prevent them from pushing each other into different columns
      if (isCore(s) && isCore(t)) {
        return
      }

      const rankS = getRank(s)
      const rankT = getRank(t)

      if (rankS < rankT) {
        // Keep s -> t
      } else if (rankT < rankS) {
        // Swap to make t -> s
        s = e.target
        t = e.source
      } else {
        // Both are core routers. Break tie alphabetically to ensure DAG.
        if (s > t) {
          s = e.target
          t = e.source
        }
      }

      const si = idx[s], ti = idx[t]
      if (si !== undefined && ti !== undefined && si !== ti) {
        // Deduplicate parallel links on the same interface to keep UI clean and performant
        const exists = links.some(l => l.source === si && l.target === ti && l.local_interface === e.local_interface)
        if (!exists) {
          links.push({ source:si, target:ti, value:10, local_interface:e.local_interface, remote_port:e.remote_port, ping_metrics:e.ping_metrics })
        }
      }
    })
    return { nodes:nodeList, links }
  }, [nodes, edges])

  /* Stats */
  const stats = useMemo(() => {
    let links = sankeyData.links
    if (focusedLink) {
      const m = sankeyData.links.find(l =>
        sankeyData.nodes[l.source].name===focusedLink.sourceName &&
        sankeyData.nodes[l.target].name===focusedLink.targetName &&
        l.local_interface===focusedLink.local_interface
      )
      if (m) links=[m]
    }
    const measured = links.filter(l => l.ping_metrics)
    let totalRtt=0, worstRtt=0, worstLink=null, lossy=0, up=0, down=0
    measured.forEach(l => {
      const m = l.ping_metrics; totalRtt += m.rtt_avg
      if (m.rtt_avg > worstRtt) { worstRtt = m.rtt_avg; worstLink = l }
      const status = getStatus(m)
      if (status === 'healthy') up++
      else if (status === 'degraded') lossy++
      else if (status === 'down') down++
    })
    return {
      totalLinks:links.length, measuredCount:measured.length,
      avgLatency: measured.length ? Math.round(totalRtt/measured.length) : 0,
      worstLink: worstLink ? {
        source: sankeyData.nodes[worstLink.source].label||sankeyData.nodes[worstLink.source].name,
        target: sankeyData.nodes[worstLink.target].label||sankeyData.nodes[worstLink.target].name,
        rtt: worstLink.ping_metrics.rtt_avg, success: worstLink.ping_metrics.success_rate,
        interface: worstLink.local_interface,
      } : null,
      lossyCount:lossy, activeUp:up, downCount:down,
      inactive: links.length - up - lossy,
    }
  }, [sankeyData, focusedLink])

  /* Filtered links for sidebar */
  const filteredLinks = useMemo(() => {
    let list = sankeyData.links
    if (searchTerm) {
      const t = searchTerm.toLowerCase()
      list = list.filter(l => {
        const s = (sankeyData.nodes[l.source].label||sankeyData.nodes[l.source].name).toLowerCase()
        const d = (sankeyData.nodes[l.target].label||sankeyData.nodes[l.target].name).toLowerCase()
        return s.includes(t) || d.includes(t)
      })
    }
    if (linkStatusFilter !== 'all') {
      list = list.filter(l => {
        const st = getStatus(l.ping_metrics)
        return st === linkStatusFilter
      })
    }
    return list
  }, [sankeyData, searchTerm, linkStatusFilter])

  /* Filtered Sankey Data */
  const filteredSankeyData = useMemo(() => {
    let links = sankeyData.links

    // 1. Filter by search term
    if (searchTerm) {
      const t = searchTerm.toLowerCase()
      links = links.filter(l => {
        const s = (sankeyData.nodes[l.source].label || sankeyData.nodes[l.source].name).toLowerCase()
        const d = (sankeyData.nodes[l.target].label || sankeyData.nodes[l.target].name).toLowerCase()
        return s.includes(t) || d.includes(t)
      })
    }

    // 2. Filter by status
    if (linkStatusFilter !== 'all') {
      links = links.filter(l => {
        const st = getStatus(l.ping_metrics)
        return st === linkStatusFilter
      })
    }

    // 3. Collect active nodes
    const activeNodeIndices = new Set()
    links.forEach(l => {
      activeNodeIndices.add(l.source)
      activeNodeIndices.add(l.target)
    })

    // 4. Remap nodes and links indices for Recharts Sankey
    const filteredNodes = []
    const indexMap = new Map()

    sankeyData.nodes.forEach((node, oldIdx) => {
      if (activeNodeIndices.has(oldIdx)) {
        const newIdx = filteredNodes.length
        filteredNodes.push(node)
        indexMap.set(oldIdx, newIdx)
      }
    })

    const remappedLinks = links.map(l => ({
      ...l,
      source: indexMap.get(l.source),
      target: indexMap.get(l.target)
    }))

    return { nodes: filteredNodes, links: remappedLinks }
  }, [sankeyData, searchTerm, linkStatusFilter])

  /* Dynamic Sankey Height based on active node count to prevent squishing and label overlaps */
  const sankeyHeight = useMemo(() => {
    return Math.max(650, (filteredSankeyData.nodes.length || 0) * 35)
  }, [filteredSankeyData.nodes])

  const NodeC = props => <CustomNode {...props} focusedLink={focusedLink} containerWidth={containerWidth}/>
  const LinkC = props => <CustomLink {...props} focusedLink={focusedLink} setFocusedLink={setFocusedLink} setHoveredLink={setHoveredLink}/>
  const hasDrift = scale !== 1 || position.x !== 0 || position.y !== 0

  return (
    <div style={{display:'flex',height:'100%',width:'100%',background:'#080a0f',color:'#e6edf3',fontFamily:"'Inter','Segoe UI',system-ui,sans-serif",overflow:'hidden',position:'relative'}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
        @keyframes spin { to { transform:rotate(360deg) } }
        @keyframes fadeSlide { from{opacity:0;transform:translateY(-6px)} to{opacity:1;transform:translateY(0)} }
        @keyframes glowPulse { 0%,100%{opacity:0.5} 50%{opacity:1} }
        @keyframes scanLine {
          0%  { transform:translateY(-100%); opacity:0 }
          10% { opacity:1 }
          90% { opacity:1 }
          100%{ transform:translateY(calc(100vh)); opacity:0 }
        }
        .spinner-mini {
          width: 10px;
          height: 10px;
          border: 2px solid rgba(255,255,255,0.25);
          border-top: 2px solid white;
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
          display: inline-block;
        }
        .sankey-scroll::-webkit-scrollbar { width:3px }
        .sankey-scroll::-webkit-scrollbar-track { background:rgba(0,0,0,0.1) }
        .sankey-scroll::-webkit-scrollbar-thumb { background:rgba(255,255,255,0.07); border-radius:4px }
        .sankey-scroll::-webkit-scrollbar-thumb:hover { background:rgba(255,255,255,0.14) }
        .sankey-link-row:hover { background:rgba(96,165,250,0.05) !important }
        .s-header:hover { background:rgba(255,255,255,0.025) }
        .s-header:hover span[style*="color:#60a5fa"], .s-header:hover span[style*="color:#e6edf3"] { filter:brightness(1.2) }
      `}</style>

      {/* ── LEFT PANEL (pinnable) ── */}
      <LeftSidebar
        pinned={leftPinned}
        onTogglePin={() => setLeftPinned(v => !v)}
        links={filteredLinks}
        nodes={sankeyData.nodes}
        focusedLink={focusedLink}
        setFocusedLink={setFocusedLink}
        stats={stats}
        filteredCount={filteredLinks.length}
        totalCount={sankeyData.links.length}
        searchTerm={searchTerm}
        setSearchTerm={setSearchTerm}
        linkStatusFilter={linkStatusFilter}
        setLinkStatusFilter={setLinkStatusFilter}
      />

      {/* ── SANKEY CANVAS ── */}
      <div
        onClick={() => setFocusedLink(null)}
        style={{flex:1, position:'relative', display:'flex', flexDirection:'column', overflow:'hidden', userSelect:'none'}}
      >
        {/* Top bar */}
        <div style={{
          padding:'10px 18px', display:'flex', alignItems:'center', gap:12, flexShrink:0,
          borderBottom:'1px solid rgba(255,255,255,0.05)',
          background:'rgba(0,0,0,0.3)',
          backdropFilter:'blur(10px)',
        }}>
          {/* Left panel open button when unpinned and closed */}
          {!leftPinned && (
            <div style={{width:20}} /> /* spacer handled by absolute tab */
          )}

          {/* Title */}
          <div style={{display:'flex',alignItems:'center',gap:10,flex:1,minWidth:0}}>
            <div style={{
              width:30,height:30,borderRadius:9,
              background:'linear-gradient(135deg,#2563eb88,#7c3aed88)',
              border:'1px solid rgba(124,58,237,0.4)',
              display:'flex',alignItems:'center',justifyContent:'center',
              fontSize:15,flexShrink:0,
              boxShadow:'0 4px 16px rgba(88,91,255,0.35)',
            }}>📊</div>
            <div>
              <div style={{display:'flex',alignItems:'center',gap:9}}>
                <span style={{fontSize:14,fontWeight:900,color:'#e6edf3',letterSpacing:0.1}}>ISP Link Delay</span>
                <div style={{
                  display:'flex',alignItems:'center',gap:5,
                  background:'rgba(96,165,250,0.1)',border:'1px solid rgba(96,165,250,0.2)',
                  borderRadius:20,padding:'2px 9px',
                }}>
                  <span style={{width:5,height:5,borderRadius:'50%',background:'#60a5fa',boxShadow:'0 0 6px rgba(96,165,250,0.9)',animation:'glowPulse 2s infinite'}}/>
                  <span style={{fontSize:9.5,fontWeight:700,color:'#60a5fa',letterSpacing:0.3}}>{sankeyData.links.length} Links</span>
                </div>
                <button
                  onClick={() => setShowTargetsModal(true)}
                  style={{
                    marginLeft: 8,
                    background: 'rgba(96,165,250,0.1)',
                    border: '1px solid rgba(96,165,250,0.25)',
                    borderRadius: 6,
                    padding: '3px 8px',
                    fontSize: 10.5,
                    fontWeight: 700,
                    cursor: 'pointer',
                    color: '#60a5fa',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    transition: 'all 0.15s'
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(96,165,250,0.2)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'rgba(96,165,250,0.1)'}
                  title="Configure ISP Targets"
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 3 }}>
                    <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
                  </svg>
                  Ping Test
                </button>
              </div>
              <div style={{fontSize:10,color:'#4b5563',marginTop:1,letterSpacing:0.1}}>
                Scroll to zoom · Drag to pan · Click link to focus
              </div>
            </div>
          </div>

          {/* Legend chips */}
          <div style={{display:'flex',gap:6,alignItems:'center',flexShrink:0}}>
            {[['#10b981','Healthy'],['#f59e0b','Degraded'],['#ef4444','Down'],['#475569','No Data']].map(([c,l])=>(
              <div key={l} style={{display:'flex',alignItems:'center',gap:4,background:'rgba(255,255,255,0.04)',border:'1px solid rgba(255,255,255,0.07)',borderRadius:20,padding:'3px 9px'}}>
                <span style={{width:6,height:6,borderRadius:'50%',background:c,flexShrink:0}}/>
                <span style={{fontSize:9.5,color:'#8b949e',fontWeight:600}}>{l}</span>
              </div>
            ))}
          </div>

          {hasDrift && (
            <button onClick={resetZoom}
              style={{
                background:'rgba(96,165,250,0.1)',border:'1px solid rgba(96,165,250,0.25)',
                color:'#60a5fa',borderRadius:8,padding:'5px 11px',fontSize:11,fontWeight:700,
                cursor:'pointer',transition:'all 0.2s',display:'flex',alignItems:'center',gap:5,flexShrink:0,
              }}
              onMouseEnter={e=>{e.currentTarget.style.background='rgba(96,165,250,0.2)'}}
              onMouseLeave={e=>{e.currentTarget.style.background='rgba(96,165,250,0.1)'}}>
              ↺ Reset
            </button>
          )}
        </div>

        {/* Focus banner */}
        {focusedLink && (
          <div style={{
            position:'absolute',top:58,left:16,right:16,zIndex:10,
            background:'rgba(30,41,59,0.9)',
            border:'1px solid rgba(96,165,250,0.25)',
            borderRadius:10,padding:'8px 14px',
            display:'flex',alignItems:'center',gap:10,fontSize:11.5,
            backdropFilter:'blur(20px)',
            boxShadow:'0 8px 32px rgba(0,0,0,0.4)',
            animation:'fadeSlide 0.2s ease',
          }}>
            <span style={{color:'#60a5fa',fontWeight:700,display:'flex',alignItems:'center',gap:5,flexShrink:0}}>
              <span style={{fontSize:13}}>🔍</span> Focus
            </span>
            <div style={{width:1,height:14,background:'rgba(96,165,250,0.25)',flexShrink:0}}/>
            <span style={{flex:1,color:'#e6edf3',fontFamily:'monospace',fontSize:11,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
              <strong>{focusedLink.sourceName}</strong>
              {focusedLink.local_interface && <span style={{color:'#60a5fa',fontSize:9.5,margin:'0 3px'}}>({focusedLink.local_interface})</span>}
              <span style={{color:'#374151',margin:'0 6px'}}>⟷</span>
              <strong>{focusedLink.targetName}</strong>
              {focusedLink.remote_port && <span style={{color:'#60a5fa',fontSize:9.5,margin:'0 3px'}}>({focusedLink.remote_port})</span>}
            </span>
            <button onClick={e=>{e.stopPropagation();setFocusedLink(null)}}
              style={{background:'rgba(255,255,255,0.05)',border:'1px solid rgba(255,255,255,0.1)',color:'#8b949e',borderRadius:6,padding:'3px 10px',fontSize:10.5,cursor:'pointer',fontWeight:700,transition:'all 0.15s',flexShrink:0}}
              onMouseEnter={e=>{e.currentTarget.style.color='#e6edf3';e.currentTarget.style.borderColor='rgba(255,255,255,0.2)'}}
              onMouseLeave={e=>{e.currentTarget.style.color='#8b949e';e.currentTarget.style.borderColor='rgba(255,255,255,0.1)'}}>
              ✕ Clear
            </button>
          </div>
        )}

        {/* Sankey */}
        {sankeyData.nodes.length > 0 ? (
          <div
            ref={svgWrapRef}
            onWheel={handleWheel}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            style={{
              flex:1, width:'100%',
              cursor:isDragging?'grabbing':'grab',
              overflow:'hidden', position:'relative',
              marginTop: focusedLink ? 48 : 0,
              transition:'margin-top 0.2s ease',
            }}
          >
            {/* Grid background */}
            <svg style={{position:'absolute',inset:0,width:'100%',height:'100%',pointerEvents:'none',opacity:0.035}} xmlns="http://www.w3.org/2000/svg">
              <defs>
                <pattern id="sgrid" width="40" height="40" patternUnits="userSpaceOnUse">
                  <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#60a5fa" strokeWidth="0.5"/>
                </pattern>
              </defs>
              <rect width="100%" height="100%" fill="url(#sgrid)"/>
            </svg>

            {filteredSankeyData.links.length === 0 ? (
              <div style={{
                position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center',
                color:'#6b7280', flexDirection:'column', gap:12, zIndex: 1
              }}>
                <div style={{fontSize:40, opacity: 0.6}}>⛓</div>
                <div style={{fontSize:13, fontWeight:600, letterSpacing:0.3, color:'#8b949e'}}>No links match the active filters</div>
                <button
                  onClick={() => { setLinkStatusFilter('all'); setSearchTerm(''); }}
                  style={{
                    background:'rgba(96,165,250,0.1)', border:'1px solid rgba(96,165,250,0.25)',
                    borderRadius:6, padding:'5px 14px', fontSize:11, fontWeight:700, color:'#60a5fa', cursor:'pointer',
                    transition: 'all 0.15s'
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(96,165,250,0.2)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'rgba(96,165,250,0.1)'}
                >Reset Active Filters</button>
              </div>
            ) : (
              <div style={{
                width:'100%',
                height: sankeyHeight,
                transform:`translate(${position.x}px,${position.y}px) scale(${scale})`,
                transformOrigin:'center center',
                transition:isDragging?'none':'transform 0.15s cubic-bezier(0.1,0.8,0.3,1)',
              }}>
                <ResponsiveContainer width="100%" height="100%">
                  <Sankey data={filteredSankeyData} node={<NodeC/>} link={<LinkC/>}
                    nodePadding={24} margin={{top:24,bottom:24,left:220,right:220}}>
                    <Tooltip content={<CustomTooltip/>}/>
                  </Sankey>
                </ResponsiveContainer>
              </div>
            )}

            {/* Zoom controls */}
            <div style={{
              position:'absolute',bottom:18,right:18,zIndex:10,
              display:'flex',flexDirection:'column',gap:4,
              background:'rgba(8,10,15,0.9)',border:'1px solid rgba(255,255,255,0.07)',
              borderRadius:12,padding:6,boxShadow:'0 16px 48px rgba(0,0,0,0.7)',
              backdropFilter:'blur(20px)',
            }}>
              {[['＋',()=>setScale(s=>Math.min(5,s+0.25)),'Zoom In'],['－',()=>setScale(s=>Math.max(0.3,s-0.25)),'Zoom Out']].map(([ico,fn,title])=>(
                <button key={title} title={title} onClick={e=>{e.stopPropagation();fn()}}
                  style={{width:30,height:30,padding:0,background:'rgba(255,255,255,0.04)',border:'1px solid rgba(255,255,255,0.06)',borderRadius:8,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',fontSize:16,color:'#e6edf3',transition:'all 0.15s',fontFamily:'monospace'}}
                  onMouseEnter={e=>{e.currentTarget.style.background='rgba(96,165,250,0.15)';e.currentTarget.style.borderColor='rgba(96,165,250,0.35)';e.currentTarget.style.transform='scale(1.08)'}}
                  onMouseLeave={e=>{e.currentTarget.style.background='rgba(255,255,255,0.04)';e.currentTarget.style.borderColor='rgba(255,255,255,0.06)';e.currentTarget.style.transform='none'}}>
                  {ico}
                </button>
              ))}
              <div style={{width:'100%',height:1,background:'rgba(255,255,255,0.06)',margin:'2px 0'}}/>
              <button title="Reset" onClick={e=>{e.stopPropagation();resetZoom()}}
                style={{width:30,height:30,padding:0,background:'rgba(255,255,255,0.04)',border:'1px solid rgba(255,255,255,0.06)',borderRadius:8,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',fontSize:13,color:'#8b949e',transition:'all 0.15s'}}
                onMouseEnter={e=>{e.currentTarget.style.background='rgba(96,165,250,0.12)';e.currentTarget.style.color='#60a5fa'}}
                onMouseLeave={e=>{e.currentTarget.style.background='rgba(255,255,255,0.04)';e.currentTarget.style.color='#8b949e'}}>↺</button>
            </div>

            {/* Scale chip */}
            {scale !== 1 && (
              <div style={{position:'absolute',bottom:18,left:18,background:'rgba(8,10,15,0.8)',border:'1px solid rgba(255,255,255,0.07)',borderRadius:7,padding:'4px 10px',fontSize:10.5,color:'#6b7280',backdropFilter:'blur(8px)',fontFamily:'monospace'}}>
                {Math.round(scale*100)}%
              </div>
            )}
          </div>
        ) : (
          <div style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:14}}>
            <div style={{fontSize:40,opacity:0.15}}>⬡</div>
            <div style={{color:'#4b5563',fontSize:13,textAlign:'center',maxWidth:260,lineHeight:1.6}}>
              No OSPF neighbors found. Select a group with OSPF adjacencies or check your device configurations.
            </div>
          </div>
        )}
      </div>

      {/* ── RIGHT PANEL (pinnable) ── */}
      <RightSidebar
        pinned={rightPinned}
        onTogglePin={() => setRightPinned(v => !v)}
        ospfPingTimestamp={ospfPingTimestamp}
        stats={stats} focusedLink={focusedLink} setFocusedLink={setFocusedLink}
        dashMin={dashMin} setDashMin={setDashMin}
        ospfTimeRange={ospfTimeRange} setOspfTimeRange={setOspfTimeRange}
        customStart={customStart} setCustomStart={setCustomStart}
        customEnd={customEnd} setCustomEnd={setCustomEnd}
        onRefreshTopology={onRefreshTopology}
        
        intervalType={intervalType} setIntervalType={setIntervalType}
        customValue={customValue} setCustomValue={setCustomValue}
        loadingConfig={loadingConfig}
        savingConfig={savingConfig}
        triggeringRun={triggeringRun}
        handleSaveConfig={handleSaveConfig}
        handleRunNow={handleRunNow}
        settingsMin={settingsMin} setSettingsMin={setSettingsMin}
      />

      {showTargetsModal && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(2, 6, 16, 0.85)',
          backdropFilter: 'blur(8px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
        }} onClick={() => { setShowTargetsModal(false); setModalMaximized(false); resetForm(); }}>
          <div style={{
            background: '#0d1117',
            border: modalMaximized ? 'none' : '1px solid var(--border)',
            borderRadius: modalMaximized ? 0 : 12,
            padding: 24,
            width: modalMaximized ? '100vw' : 850,
            height: modalMaximized ? '100vh' : 'auto',
            maxWidth: modalMaximized ? '100vw' : '90%',
            maxHeight: modalMaximized ? '100vh' : '90vh',
            display: 'flex',
            flexDirection: 'column',
            boxShadow: '0 20px 50px rgba(0,0,0,0.8)',
            transition: 'all 0.2s ease-in-out',
          }} onClick={e => e.stopPropagation()}>
            
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, borderBottom: '1px solid var(--border)', paddingBottom: 12 }}>
              <h3 style={{ margin: 0, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span>🔗</span> Configure Ping Test Targets
              </h3>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <button 
                  onClick={() => setModalMaximized(prev => !prev)} 
                  style={{ 
                    background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', 
                    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 4,
                    transition: 'color 0.2s', width: 26, height: 26, borderRadius: 6
                  }}
                  onMouseEnter={e => e.currentTarget.style.color = 'var(--text)'}
                  onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}
                  title={modalMaximized ? "Restore size" : "Maximize"}
                >
                  {modalMaximized ? (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M4 14h6v6M20 10h-6V4M14 10l7-7M10 14l-7 7" />
                    </svg>
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
                    </svg>
                  )}
                </button>
                <button 
                  onClick={() => { setShowTargetsModal(false); setModalMaximized(false); resetForm(); }} 
                  style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 16, display: 'flex', alignItems: 'center', padding: 4 }}
                  title="Close"
                >✕</button>
              </div>
            </div>

            {/* Search Filter */}
            <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', position: 'relative' }}>
              <span style={{ position: 'absolute', left: 8, fontSize: 12, color: 'var(--text-muted)', pointerEvents: 'none' }}>🔍</span>
              <input
                type="text"
                placeholder="Search targets by Source Router, Destination Router, or Target IP..."
                value={modalSearchTerm}
                onChange={e => setModalSearchTerm(e.target.value)}
                style={{ width: '100%', background: '#161b22', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 6, padding: '6px 10px 6px 26px', fontSize: 11.5 }}
              />
              {modalSearchTerm && (
                <button onClick={() => setModalSearchTerm('')} style={{ position: 'absolute', right: 6, background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 12, padding: '0 4px' }}>✕</button>
              )}
            </div>

            {/* Content - Scrollable List */}
            <div style={{ flex: 1, overflowY: 'auto', marginBottom: 16 }} className="sankey-scroll">
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)', background: 'rgba(255,255,255,0.02)' }}>
                    <th onClick={() => handleSort('source')} style={{ padding: 8, textAlign: 'left', color: 'var(--text-muted)', cursor: 'pointer', userSelect: 'none' }}>Source Router{renderSortIndicator('source')}</th>
                    <th onClick={() => handleSort('destination_router')} style={{ padding: 8, textAlign: 'left', color: 'var(--text-muted)', cursor: 'pointer', userSelect: 'none' }}>Destination Router{renderSortIndicator('destination_router')}</th>
                    <th onClick={() => handleSort('target_ip')} style={{ padding: 8, textAlign: 'left', color: 'var(--text-muted)', cursor: 'pointer', userSelect: 'none' }}>Target IP{renderSortIndicator('target_ip')}</th>
                    <th style={{ padding: 8, textAlign: 'center', color: 'var(--text-muted)' }}>Min Success %</th>
                    <th style={{ padding: 8, textAlign: 'center', color: 'var(--text-muted)' }}>Min RTT</th>
                    <th style={{ padding: 8, textAlign: 'center', color: 'var(--text-muted)' }}>Avg RTT</th>
                    <th style={{ padding: 8, textAlign: 'center', color: 'var(--text-muted)' }}>Max RTT</th>
                    <th style={{ padding: 8, textAlign: 'center', color: 'var(--text-muted)' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAndSortedTargets.map((t, idx) => (
                    <tr key={idx} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                      <td style={{ padding: 8, color: 'var(--text)' }}>{t.source}</td>
                      <td style={{ padding: 8, color: t.resolved_dest === 'Internet / External' ? 'var(--text-muted)' : 'var(--text)', fontWeight: t.resolved_dest === 'Internet / External' ? 400 : 600 }}>{t.resolved_dest}</td>
                      <td style={{ padding: 8, color: '#60a5fa', fontFamily: 'monospace' }}>{t.target_ip}</td>
                      <td style={{ padding: '4px 8px', textAlign: 'center' }}>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                          <input
                            type="number"
                            value={t.success_rate}
                            onChange={e => handleUpdateThreshold(t.source, t.target_ip, 'success_rate', parseFloat(e.target.value) || 0)}
                            style={{ width: 55, background: '#161b22', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 4, padding: '2px 4px', fontSize: 11, textAlign: 'center', outline: 'none' }}
                          />
                          <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>%</span>
                        </div>
                      </td>
                      <td style={{ padding: '4px 8px', textAlign: 'center' }}>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                          <input
                            type="number"
                            value={t.rtt_min}
                            onChange={e => handleUpdateThreshold(t.source, t.target_ip, 'rtt_min', parseFloat(e.target.value) || 0)}
                            style={{ width: 55, background: '#161b22', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 4, padding: '2px 4px', fontSize: 11, textAlign: 'center', outline: 'none' }}
                          />
                          <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>ms</span>
                        </div>
                      </td>
                      <td style={{ padding: '4px 8px', textAlign: 'center' }}>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                          <input
                            type="number"
                            value={t.rtt_avg}
                            onChange={e => handleUpdateThreshold(t.source, t.target_ip, 'rtt_avg', parseFloat(e.target.value) || 0)}
                            style={{ width: 55, background: '#161b22', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 4, padding: '2px 4px', fontSize: 11, textAlign: 'center', outline: 'none' }}
                          />
                          <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>ms</span>
                        </div>
                      </td>
                      <td style={{ padding: '4px 8px', textAlign: 'center' }}>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                          <input
                            type="number"
                            value={t.rtt_max}
                            onChange={e => handleUpdateThreshold(t.source, t.target_ip, 'rtt_max', parseFloat(e.target.value) || 0)}
                            style={{ width: 55, background: '#161b22', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 4, padding: '2px 4px', fontSize: 11, textAlign: 'center', outline: 'none' }}
                          />
                          <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>ms</span>
                        </div>
                      </td>
                      <td style={{ padding: 8, textAlign: 'center' }}>
                        <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                          <button
                            onClick={() => {
                              setEditingTarget({ source: t.source, target_ip: t.target_ip })
                              setNewSource(t.source)
                              setDestType(t.destination_router ? 'router' : 'ip')
                              setNewDestinationRouter(t.destination_router || '')
                              setNewTargetIp(t.target_ip)
                              setNewSuccessRate(t.success_rate)
                              setNewRttMin(t.rtt_min)
                              setNewRttAvg(t.rtt_avg)
                              setNewRttMax(t.rtt_max)
                            }}
                            style={{ background: 'rgba(96,165,250,0.1)', border: '1px solid rgba(96,165,250,0.2)', color: '#60a5fa', borderRadius: 4, padding: '2px 6px', fontSize: 10, cursor: 'pointer' }}
                          >Modify</button>
                          <button
                            onClick={() => {
                              setTargetsList(prev => prev.filter(item => !(item.source === t.source && item.target_ip === t.target_ip)))
                              if (editingTarget && editingTarget.source === t.source && editingTarget.target_ip === t.target_ip) {
                                resetForm()
                              }
                            }}
                            style={{ background: 'rgba(244,63,94,0.1)', border: '1px solid rgba(244,63,94,0.2)', color: '#f43f5e', borderRadius: 4, padding: '2px 6px', fontSize: 10, cursor: 'pointer' }}
                          >Delete</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {filteredAndSortedTargets.length === 0 && (
                    <tr>
                      <td colSpan={8} style={{ padding: 16, textAlign: 'center', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                        No targets found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Form to Add or Modify Target */}
            <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)', borderRadius: 8, padding: 14, marginBottom: 16 }}>
              <h4 style={{ margin: '0 0 10px 0', color: 'var(--text)', fontSize: 13 }}>
                {editingTarget ? 'Modify ISP Target' : 'Add New ISP Target'}
              </h4>
              
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                <div>
                  <label style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Source Router</label>
                  <select
                    value={newSource}
                    onChange={e => setNewSource(e.target.value)}
                    style={{ width: '100%', background: '#161b22', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 6, padding: 5, fontSize: 12 }}
                  >
                    <option value="">-- Select Router --</option>
                    {availableRouters.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
                
                <div>
                  <label style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Destination Type</label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button 
                      onClick={() => { setDestType('router'); setNewTargetIp('') }} 
                      style={{ flex: 1, padding: '4px', fontSize: 11, background: destType === 'router' ? 'var(--accent)' : 'rgba(255,255,255,0.02)', borderColor: destType === 'router' ? 'var(--accent)' : 'var(--border)' }}
                    >
                      Router Link
                    </button>
                    <button 
                      onClick={() => { setDestType('ip'); setNewDestinationRouter('') }} 
                      style={{ flex: 1, padding: '4px', fontSize: 11, background: destType === 'ip' ? 'var(--accent)' : 'rgba(255,255,255,0.02)', borderColor: destType === 'ip' ? 'var(--accent)' : 'var(--border)' }}
                    >
                      Custom IP (External)
                    </button>
                  </div>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                {destType === 'router' ? (
                  <div>
                    <label style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Destination Router</label>
                    <select
                      value={newDestinationRouter}
                      onChange={e => {
                        const r = e.target.value
                        setNewDestinationRouter(r)
                        setNewTargetIp(routerIpMap[r] || '')
                      }}
                      style={{ width: '100%', background: '#161b22', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 6, padding: 5, fontSize: 12 }}
                    >
                      <option value="">-- Select Destination Router --</option>
                      {availableDestRouters.map(r => (
                        <option key={r.id} value={r.id}>
                          {r.id} ({r.ip})
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div>
                    <label style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Target IP Address</label>
                    <input
                      type="text"
                      placeholder="8.8.8.8"
                      value={newTargetIp}
                      onChange={e => setNewTargetIp(e.target.value)}
                      style={{ width: '100%', background: '#161b22', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 6, padding: 5, fontSize: 12 }}
                    />
                  </div>
                )}
                <div>
                  <label style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Resolved IP Address</label>
                  <input
                    type="text"
                    readOnly
                    value={newTargetIp}
                    placeholder="Auto-populated"
                    style={{ width: '100%', background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)', color: '#888', borderRadius: 6, padding: 5, fontSize: 12, cursor: 'not-allowed' }}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8, marginBottom: 12 }}>
                <div>
                  <label style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Min Success %</label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={newSuccessRate}
                    onChange={e => setNewSuccessRate(parseFloat(e.target.value) || 0)}
                    style={{ width: '100%', background: '#161b22', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 6, padding: 5, fontSize: 12 }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>RTT Min (ms)</label>
                  <input
                    type="number"
                    min="0"
                    value={newRttMin}
                    onChange={e => setNewRttMin(parseFloat(e.target.value) || 0)}
                    style={{ width: '100%', background: '#161b22', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 6, padding: 5, fontSize: 12 }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>RTT Avg (ms)</label>
                  <input
                    type="number"
                    min="0"
                    value={newRttAvg}
                    onChange={e => setNewRttAvg(parseFloat(e.target.value) || 0)}
                    style={{ width: '100%', background: '#161b22', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 6, padding: 5, fontSize: 12 }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>RTT Max (ms)</label>
                  <input
                    type="number"
                    min="0"
                    value={newRttMax}
                    onChange={e => setNewRttMax(parseFloat(e.target.value) || 0)}
                    style={{ width: '100%', background: '#161b22', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 6, padding: 5, fontSize: 12 }}
                  />
                </div>
              </div>

              {editingTarget ? (
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={() => {
                      if (!newSource || !newTargetIp) {
                        alert('Source router and target IP are required.')
                        return
                      }
                      // Update target in list
                      setTargetsList(prev => prev.map(item => {
                        if (item.source === editingTarget.source && item.target_ip === editingTarget.target_ip) {
                          return {
                            source: newSource,
                            target_ip: newTargetIp,
                            success_rate: newSuccessRate,
                            rtt_min: newRttMin,
                            rtt_avg: newRttAvg,
                            rtt_max: newRttMax,
                            destination_router: destType === 'router' ? newDestinationRouter : null
                          }
                        }
                        return item
                      }))
                      resetForm()
                    }}
                    style={{ flex: 1, padding: '6px', background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.25)', color: '#10b981', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
                  >Save Changes</button>
                  <button
                    onClick={() => resetForm()}
                    style={{ padding: '6px 14px', background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-muted)', borderRadius: 6, fontSize: 11, cursor: 'pointer' }}
                  >Cancel Edit</button>
                </div>
              ) : (
                <button
                  onClick={() => {
                    if (!newSource || !newTargetIp) {
                      alert('Source router and target IP are required.')
                      return
                    }
                    const newT = {
                      source: newSource,
                      target_ip: newTargetIp,
                      success_rate: newSuccessRate,
                      rtt_min: newRttMin,
                      rtt_avg: newRttAvg,
                      rtt_max: newRttMax,
                      destination_router: destType === 'router' ? newDestinationRouter : null
                    }
                    setTargetsList(prev => [...prev, newT])
                    resetForm()
                  }}
                  style={{ width: '100%', padding: '6px', background: 'rgba(96,165,250,0.1)', border: '1px solid rgba(96,165,250,0.25)', color: '#60a5fa', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
                >+ Add Target to List</button>
              )}
            </div>

            {/* Footer Actions */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
              <button
                onClick={() => { setShowTargetsModal(false); setModalMaximized(false); resetForm(); }}
                style={{ padding: '6px 14px', background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-muted)', borderRadius: 6, fontSize: 12, cursor: 'pointer' }}
              >Cancel</button>
              <button
                onClick={async () => {
                  try {
                    await saveIspPingTargets(targetsList)
                    alert('ISP Link Delay targets saved and committed to Git!')
                    setShowTargetsModal(false)
                    setModalMaximized(false)
                    resetForm()
                    onRefreshTopology(ospfTimeRange, customStart, customEnd)
                  } catch (err) {
                    alert('Failed to save: ' + (err.message || err))
                  }
                }}
                style={{ padding: '6px 16px', background: 'linear-gradient(135deg,#2563eb,#1d4ed8)', border: 'none', color: '#fff', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
              >Save & Commit to Git</button>
            </div>

          </div>
        </div>
      )}

      {hoveredLink && (
        <div style={{
          position: 'fixed',
          left: hoveredLink.x + 15,
          top: hoveredLink.y + 15,
          zIndex: 99999,
          pointerEvents: 'none',
          background: 'rgba(8,10,15,0.97)',
          border: '1px solid rgba(255,255,255,0.07)',
          borderRadius: 12,
          padding: '14px 18px',
          boxShadow: '0 24px 64px rgba(0,0,0,0.75)',
          backdropFilter: 'blur(24px)',
          fontSize: 12,
          color: '#e6edf3',
          fontFamily: "'Inter',system-ui,sans-serif",
          minWidth: 240,
        }}>
          {(() => {
            const data = hoveredLink.link
            const m = data.ping_metrics
            const st = getStatus(m)
            const sc = STATUS_MAP[st]
            return (
              <>
                <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10}}>
                  <span style={{fontWeight:700,fontSize:12,color:'#60a5fa',display:'flex',alignItems:'center',gap:6}}>
                    <span style={{fontSize:15}}>⛓</span> OSPF Link
                  </span>
                  <span style={{fontSize:10,fontWeight:700,color:sc.text,background:sc.bg,border:`1px solid ${sc.border}`,borderRadius:6,padding:'2px 8px'}}>
                    {m?.historical ? `📊 Historical (${m.time_range})` : sc.label}
                  </span>
                </div>
                <div style={{borderTop:'1px solid rgba(255,255,255,0.06)',paddingTop:8,display:'flex',flexDirection:'column',gap:5}}>
                  {[
                    ['From', cleanName(data.source), data.local_interface, m?.pinged_ips?.a_ip],
                    ['To',   cleanName(data.target),  data.remote_port,    m?.pinged_ips?.b_ip]
                  ].map(([lbl, name, iface, ip]) => (
                    <div key={lbl}>
                      <div style={{display:'flex',alignItems:'center',gap:8}}>
                        <span style={{fontSize:9,color:'#6b7280',minWidth:30,fontWeight:700,textTransform:'uppercase',letterSpacing:0.5}}>{lbl}</span>
                        <span style={{fontWeight:600,color:'#e6edf3'}}>{name}</span>
                        {iface && <span style={{fontSize:9,color:'#60a5fa',fontFamily:'monospace'}}>{iface}</span>}
                      </div>
                      {ip && <div style={{paddingLeft:38,fontSize:9,color:'#6b7280',fontFamily:'monospace'}}>↳ {ip}</div>}
                    </div>
                  ))}
                </div>
                {m ? (
                  <div style={{marginTop:10,paddingTop:10,borderTop:'1px solid rgba(255,255,255,0.06)',display:'grid',gridTemplateColumns:'1fr 1fr',gap:'6px 10px'}}>
                    {[
                      ['Avg RTT', `${m.rtt_avg}ms`, '#60a5fa'],
                      ['Success', `${m.success_rate}%`, sc.text],
                      ['Min', `${m.rtt_min}ms`, '#e6edf3'],
                      ['Max', `${m.rtt_max}ms`, '#e6edf3']
                    ].map(([l,v,c])=>(
                      <div key={l} style={{display:'flex',flexDirection:'column',gap:1,background:'rgba(255,255,255,0.03)',borderRadius:6,padding:'5px 7px'}}>
                        <span style={{fontSize:9,color:'#6b7280',fontWeight:700,textTransform:'uppercase',letterSpacing:0.4}}>{l}</span>
                        <span style={{fontWeight:800,color:c,fontSize:14,fontVariantNumeric:'tabular-nums'}}>{v}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{marginTop:8,paddingTop:8,borderTop:'1px solid rgba(255,255,255,0.05)',fontSize:11,color:'#6b7280',fontStyle:'italic'}}>
                    No metrics — configure scan settings to begin monitoring.
                  </div>
                )}
              </>
            )
          })()}
        </div>
      )}
    </div>
  )
}
