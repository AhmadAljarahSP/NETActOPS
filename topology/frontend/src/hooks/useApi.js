import axios from 'axios'

const API_BASE = import.meta.env.VITE_API_BASE || '/api'
const API_KEY  = import.meta.env.VITE_API_KEY || ''

const api = axios.create({
  baseURL: API_BASE,
  headers: { 'X-Api-Key': API_KEY },
})

export const getTopology   = (params)     => api.get('/topology', { params }).then(r => r.data)
export const getHealthchecks = ()         => api.get('/healthchecks').then(r => r.data)
export const getDeviceHC   = (name)       => api.get(`/healthchecks/${name}`).then(r => r.data)
export const getNeighbors  = (name)       => api.get(`/healthchecks/${name}/neighbors`).then(r => r.data)
export const getCoords     = ()           => api.get('/coords').then(r => r.data)
export const saveCoord     = (device, x, y) => api.post('/coords', { device, x, y }).then(r => r.data)
export const saveCoordGeo  = (device, latitude, longitude) => api.post('/coords', { device, latitude, longitude }).then(r => r.data)
export const bulkSaveCoords = (updates)   => api.post('/coords/bulk', updates).then(r => r.data)
export const deleteCoord   = (device)     => api.delete(`/coords/${device}`).then(r => r.data)

export const getIspPingTargets = ()           => api.get('/isp-ping/targets').then(r => r.data)
export const saveIspPingTargets = (targets)    => api.post('/isp-ping/targets', targets).then(r => r.data)
export const getIspPingConfig  = ()           => api.get('/isp-ping/config').then(r => r.data)
export const saveIspPingConfig = (config)    => api.post('/isp-ping/config', config).then(r => r.data)
export const runIspPingNow     = ()           => api.post('/isp-ping/run').then(r => r.data)

export const getBgpRegistry    = ()           => api.get('/bgp-registry').then(r => r.data)
export const saveBgpRegistry   = (registry)   => api.post('/bgp-registry', { registry }).then(r => r.data)

export const getOspfTopology   = ()           => api.get('/ospf-topology').then(r => r.data)
export const getSpfPath        = (src, dst)   => api.get('/path', { params: { src, dst } }).then(r => r.data)
export const getTePaths        = ()           => api.get('/te-paths').then(r => r.data)
