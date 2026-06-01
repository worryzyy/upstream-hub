import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import { ThemeProvider } from '@/components/theme-provider'
import { AuthProvider } from '@/lib/auth-context'
import { RefreshProvider } from '@/lib/refresh-context'
import { AddChannelProvider } from '@/lib/add-channel-context'
import { AuthGate } from '@/components/auth/auth-gate'
import { AppShell } from '@/components/app-shell'
import { Toaster } from '@/components/ui/sonner'
import DashboardPage from '@/app/page'
import CaptchaPage from '@/app/captcha-page'
import NotificationsPage from '@/app/notifications-page'
import SettingsPage from '@/app/settings-page'
import '@/app/globals.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>
      <AuthProvider>
        <AuthGate>
          <RefreshProvider>
            <BrowserRouter>
              <AddChannelProvider>
                <Routes>
                  <Route element={<AppShell />}>
                    <Route index element={<DashboardPage />} />
                    <Route path="captcha" element={<CaptchaPage />} />
                    <Route path="notifications" element={<NotificationsPage />} />
                    <Route path="settings" element={<SettingsPage />} />
                  </Route>
                </Routes>
              </AddChannelProvider>
            </BrowserRouter>
          </RefreshProvider>
          <Toaster richColors closeButton position="top-right" />
        </AuthGate>
      </AuthProvider>
    </ThemeProvider>
  </StrictMode>,
)
