import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Project } from '@/types'
import api from '@/api/client'

interface ProjectState {
  activeProject: Project | null
  projects: Project[]
  setActiveProject: (project: Project) => void
  setProjects: (projects: Project[]) => void
  fetchProjects: () => Promise<void>
}

export const useProjectStore = create<ProjectState>()(
  persist(
    (set) => ({
      activeProject: null,
      projects: [],

      setActiveProject: async (project) => {
        set({ activeProject: project })
        try {
          await api.put(`/auth/me/project?project_uuid=${project.customer_uuid}`)
        } catch (_) {}
      },

      setProjects: (projects) => set({ projects }),

      fetchProjects: async () => {
        try {
          const res = await api.get('/integrations/tracked-projects')
          const projects: Project[] = res.data || []
          set((state) => {
            // ВАЖНО: заменяем активный проект СВЕЖЕЙ версией из списка, а не
            // оставляем старый объект — иначе обновлённые поля (линии has_inbound/
            // has_outbound, target_sl и т.п.) не подхватятся, и разделы аналитики
            // не появятся/не скроются после изменения настроек проекта.
            const cur = state.activeProject
            const fresh = cur ? projects.find((p) => p.customer_uuid === cur.customer_uuid) : undefined
            return { projects, activeProject: fresh ?? projects[0] ?? null }
          })
        } catch (_) {}
      },
    }),
    { name: 'wfm_project', partialize: (s) => ({ activeProject: s.activeProject }) }
  )
)
