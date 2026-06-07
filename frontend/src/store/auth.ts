import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import api, { clearAuthStorage } from '@/api/client'
import type { User } from '@/types'

interface AuthState {
  token: string | null
  user: User | null
  setToken: (token: string) => void
  setUser: (user: User) => void
  logout: () => void
  login: (username: string, password: string) => Promise<void>
  fetchMe: () => Promise<void>
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      token: null,
      user: null,

      setToken: (token) => {
        console.log('[auth] setToken called, writing to localStorage')
        set({ token })
        localStorage.setItem('wfm_token', token)
        console.log('[auth] wfm_token in storage:', localStorage.getItem('wfm_token')?.slice(0, 20) + '…')
      },

      setUser: (user) => set({ user }),

      logout: () => {
        console.log('[auth] logout called')
        set({ token: null, user: null })
        clearAuthStorage()
      },

      login: async (username, password) => {
        console.log('[auth] login() start')
        const res = await api.post('/auth/login', { username, password })
        console.log('[auth] /auth/login 200, got token')
        const { access_token } = res.data
        get().setToken(access_token)
        console.log('[auth] calling fetchMe()')
        await get().fetchMe()
        console.log('[auth] fetchMe() done — login complete')
      },

      fetchMe: async () => {
        const res = await api.get('/auth/me')
        set({ user: res.data })
      },
    }),
    { name: 'wfm_auth', partialize: (s) => ({ token: s.token }) }
  )
)
