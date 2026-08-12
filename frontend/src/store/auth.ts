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
        set({ token })
        localStorage.setItem('wfm_token', token)
      },

      setUser: (user) => set({ user }),

      logout: () => {
        set({ token: null, user: null })
        clearAuthStorage()
      },

      login: async (username, password) => {
        const res = await api.post('/auth/login', { username, password })
        const { access_token } = res.data
        get().setToken(access_token)
        await get().fetchMe()
      },

      fetchMe: async () => {
        const res = await api.get('/auth/me')
        set({ user: res.data })
      },
    }),
    { name: 'wfm_auth', partialize: (s) => ({ token: s.token }) }
  )
)
