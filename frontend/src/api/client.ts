import axios from 'axios'

const api = axios.create({
  baseURL: '/api/v1',
  headers: { 'Content-Type': 'application/json' },
})

function getToken(): string | null {
  const direct = localStorage.getItem('wfm_token')
  if (direct) return direct
  try {
    const raw = localStorage.getItem('wfm_auth')
    if (raw) return JSON.parse(raw)?.state?.token ?? null
  } catch (_) {}
  return null
}

export function clearAuthStorage() {
  localStorage.removeItem('wfm_token')
  localStorage.removeItem('wfm_auth')
  localStorage.removeItem('wfm_project')
}

let _onUnauthorized: () => void = () => window.location.replace('/login')
export function setUnauthorizedHandler(fn: () => void) {
  _onUnauthorized = fn
}

api.interceptors.request.use((config) => {
  const token = getToken()
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
    console.log('[REQ]', config.method?.toUpperCase(), config.url, '→ token OK')
  } else {
    console.warn('[REQ]', config.method?.toUpperCase(), config.url, '→ NO TOKEN')
  }
  return config
})

api.interceptors.response.use(
  (res) => {
    console.log('[RES]', res.status, res.config.url)
    return res
  },
  (err) => {
    const status = err.response?.status
    const url = err.config?.url
    if (status === 401) {
      const sentAuth = err.config?.headers?.Authorization as string | undefined
      const sentToken = sentAuth?.startsWith('Bearer ') ? sentAuth.slice(7) : null
      const currentToken = getToken()
      console.error(
        `[401] ${url}`,
        '\n  sentToken:', sentToken ? sentToken.slice(0, 20) + '…' : 'NONE',
        '\n  currentToken:', currentToken ? currentToken.slice(0, 20) + '…' : 'NONE',
        '\n  match:', sentToken === currentToken,
      )
      if (!currentToken || sentToken === currentToken) {
        console.error('[401] → LOGOUT + navigate /login')
        clearAuthStorage()
        _onUnauthorized()
      } else {
        console.warn('[401] → STALE REQUEST IGNORED (new token already present)')
      }
    } else {
      console.error('[ERR]', status, url, err.message)
    }
    return Promise.reject(err)
  },
)

export default api
