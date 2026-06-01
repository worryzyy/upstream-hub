import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import { ThemeProvider } from '@/components/theme-provider'
import { AuthProvider } from '@/lib/auth-context'
import { RefreshProvider } from '@/lib/refresh-context'
import { AuthGate } from '@/components/auth/auth-gate'
import Page from '@/app/page'
import '@/app/globals.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>
      <AuthProvider>
        <AuthGate>
          <RefreshProvider>
            <Page />
          </RefreshProvider>
        </AuthGate>
      </AuthProvider>
    </ThemeProvider>
  </StrictMode>,
)
