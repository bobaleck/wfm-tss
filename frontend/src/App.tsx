import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { useEffect, useLayoutEffect } from 'react'
import { Loader2 } from 'lucide-react'
import { useAuthStore } from '@/store/auth'
import { setUnauthorizedHandler } from '@/api/client'
import Layout from '@/components/layout/Layout'
import LoginPage from '@/pages/auth/LoginPage'
import DashboardPage from '@/pages/dashboard/DashboardPage'
import EmployeesPage from '@/pages/team/EmployeesPage'
import TeamsPage from '@/pages/team/TeamsPage'
import SkillsPage from '@/pages/team/SkillsPage'
import QueuesPage from '@/pages/analytics/QueuesPage'
import WorkloadPage from '@/pages/analytics/WorkloadPage'
import OperatorLoadPage from '@/pages/analytics/OperatorLoadPage'
import IntradayPage from '@/pages/analytics/IntradayPage'
import StaffingPage from '@/pages/analytics/StaffingPage'
import SchedulesPage from '@/pages/worktime/SchedulesPage'
import AbsencesPage from '@/pages/worktime/AbsencesPage'
import ShiftsPage from '@/pages/worktime/ShiftsPage'
import ReportsPage from '@/pages/ReportsPage'
import SettingsPage from '@/pages/SettingsPage'
import UsersPage from '@/pages/UsersPage'
import JournalPage from '@/pages/JournalPage'
import IntegrationsPage from '@/pages/IntegrationsPage'
import AboutPage from '@/pages/AboutPage'
import DocsPage from '@/pages/DocsPage'

// Guards both token presence and user identity.
// - No token              → /login immediately
// - Token present, no user → spinner (fetchMe in flight / stale token being validated)
// - Token + user both set → renders children (dashboard content)
// This prevents the blink: a stale token won't flash the dashboard because
// user is never populated for an invalid token.
function PrivateRoute({ children }: { children: React.ReactNode }) {
  const token = useAuthStore((s) => s.token)
  const user = useAuthStore((s) => s.user)

  if (!token) return <Navigate to="/login" replace />
  if (!user) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-50">
        <Loader2 className="animate-spin text-brand-500" size={32} />
      </div>
    )
  }
  return <>{children}</>
}

function AuthGuard() {
  const navigate = useNavigate()
  const logout = useAuthStore((s) => s.logout)
  const token = useAuthStore((s) => s.token)
  const fetchMe = useAuthStore((s) => s.fetchMe)

  useLayoutEffect(() => {
    setUnauthorizedHandler(() => {
      logout()
      navigate('/login', { replace: true })
    })
  }, [logout, navigate])

  // Validate any existing token once on startup.
  // If the token is stale/expired the 401 interceptor fires, calls logout(),
  // and the PrivateRoute redirects to /login — no dashboard blink because
  // PrivateRoute shows a spinner (not the dashboard) until user is populated.
  useEffect(() => {
    if (token) {
      fetchMe().catch(() => {})
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return null
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthGuard />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/*"
          element={
            <PrivateRoute>
              <Layout>
                <Routes>
                  <Route path="/" element={<Navigate to="/dashboard" replace />} />
                  <Route path="/dashboard" element={<DashboardPage />} />
                  <Route path="/team/employees" element={<EmployeesPage />} />
                  <Route path="/team/teams" element={<TeamsPage />} />
                  <Route path="/team/skills" element={<SkillsPage />} />
                  <Route path="/analytics/queues" element={<QueuesPage />} />
                  <Route path="/analytics/workload" element={<WorkloadPage />} />
                  <Route path="/analytics/operator-load" element={<OperatorLoadPage />} />
                  <Route path="/analytics/intraday" element={<IntradayPage />} />
                  <Route path="/analytics/staffing" element={<StaffingPage />} />
                  <Route path="/worktime/schedules" element={<SchedulesPage />} />
                  <Route path="/worktime/absences" element={<AbsencesPage />} />
                  <Route path="/worktime/shifts" element={<ShiftsPage />} />
                  <Route path="/reports" element={<ReportsPage />} />
                  <Route path="/settings" element={<SettingsPage />} />
                  <Route path="/users" element={<UsersPage />} />
                  <Route path="/journal" element={<JournalPage />} />
                  <Route path="/integrations" element={<IntegrationsPage />} />
                  <Route path="/about" element={<AboutPage />} />
                  <Route path="/docs" element={<DocsPage />} />
                </Routes>
              </Layout>
            </PrivateRoute>
          }
        />
      </Routes>
    </BrowserRouter>
  )
}
