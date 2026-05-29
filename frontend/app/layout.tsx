import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { Toaster } from 'react-hot-toast'
import { ThemeProvider } from './providers'

const inter = Inter({ subsets: ['latin'], display: 'swap' })

export const metadata: Metadata = {
  title: 'OmniBot SaaS — AI Customer Support',
  description: 'Bangla AI-powered Facebook & Instagram chatbot platform for Bangladesh businesses',
  manifest: '/manifest.json',
  appleWebApp: { capable: true, statusBarStyle: 'default' },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="bn" suppressHydrationWarning>
      <head>
        <meta name="theme-color" content="#282A35" />
        <meta name="mobile-web-app-capable" content="yes" />
      </head>
      <body className={inter.className}>
        <ThemeProvider>
          {children}

          {/* Desktop toasts: top-right */}
          <div className="hidden sm:block">
            <Toaster
              position="top-right"
              toastOptions={{
                duration: 3500,
                style: {
                  borderRadius: '8px',
                  fontSize: '13px',
                  fontFamily: 'Inter, system-ui, sans-serif',
                  boxShadow: '0 4px 20px rgba(0,0,0,0.12)',
                  padding: '12px 16px',
                  maxWidth: '380px',
                  animation: 'toastSlide 0.3s cubic-bezier(0.22,1,0.36,1)',
                },
                success: {
                  iconTheme: { primary: '#04AA6D', secondary: '#fff' },
                  style: { border: '1px solid #A5D6A7', background: '#fff' },
                },
                error: {
                  iconTheme: { primary: '#f44336', secondary: '#fff' },
                  style: { border: '1px solid #FFCDD2', background: '#fff' },
                },
              }}
            />
          </div>

          {/* Mobile toasts: bottom-center (above bottom nav) */}
          <div className="sm:hidden">
            <Toaster
              position="bottom-center"
              containerStyle={{ bottom: '80px' }}
              toastOptions={{
                duration: 3000,
                style: {
                  borderRadius: '12px',
                  fontSize: '13px',
                  fontFamily: 'Inter, system-ui, sans-serif',
                  boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
                  padding: '12px 16px',
                  maxWidth: 'calc(100vw - 32px)',
                  animation: 'slideInBottom 0.3s cubic-bezier(0.22,1,0.36,1)',
                },
                success: {
                  iconTheme: { primary: '#04AA6D', secondary: '#fff' },
                  style: { border: '1px solid #A5D6A7', background: '#fff' },
                },
                error: {
                  iconTheme: { primary: '#f44336', secondary: '#fff' },
                  style: { border: '1px solid #FFCDD2', background: '#fff' },
                },
              }}
            />
          </div>
        </ThemeProvider>
      </body>
    </html>
  )
}
