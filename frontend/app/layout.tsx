import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { Toaster } from 'react-hot-toast'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'OmniBot SaaS — AI Customer Support',
  description: 'Bangla AI-powered Facebook & Instagram chatbot platform for Bangladesh businesses',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="bn">
      <body className={inter.className}>
        {children}
        <Toaster position="top-right" toastOptions={{ duration: 3000 }} />
      </body>
    </html>
  )
}
