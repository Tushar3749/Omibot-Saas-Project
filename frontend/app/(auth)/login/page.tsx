'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import toast from 'react-hot-toast'
import { authAPI } from '@/lib/api'
import { saveAuth } from '@/lib/utils'
import { Bot, Eye, EyeOff, Zap, Shield, Globe, ArrowRight } from 'lucide-react'

const FEATURES = [
  { icon: Zap,    text: 'Gemini 2.5 Flash AI — fastest responses' },
  { icon: Globe,  text: 'Facebook Messenger + Instagram DM' },
  { icon: Shield, text: 'Prompt injection protection built-in' },
]

export default function LoginPage() {
  const router = useRouter()
  const [form, setForm]       = useState({ email: '', password: '' })
  const [loading, setLoading] = useState(false)
  const [showPwd, setShowPwd] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      const data = await authAPI.login(form)
      saveAuth(data.access_token, data.tenant)
      toast.success(`স্বাগতম, ${data.tenant.business_name}!`)
      router.push(data.tenant.onboarding_done ? '/dashboard' : '/onboarding')
    } catch (err: unknown) {
      toast.error((err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'লগইন ব্যর্থ হয়েছে')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex">

      {/* ── Left panel — dark branding ─────────────────────────────────────── */}
      <div className="hidden lg:flex flex-col justify-between w-[420px] flex-shrink-0 p-10"
           style={{ backgroundColor: '#282A35' }}>
        <div>
          {/* Logo */}
          <div className="flex items-center gap-3 mb-14">
            <div className="w-9 h-9 rounded flex items-center justify-center"
                 style={{ backgroundColor: '#04AA6D' }}>
              <Bot size={18} className="text-white" />
            </div>
            <span className="text-white font-bold text-lg">OmniBot SaaS</span>
          </div>

          <h2 className="text-3xl font-bold text-white leading-snug mb-4">
            Your AI-powered<br />sales assistant
          </h2>
          <p className="text-sm leading-relaxed mb-10" style={{ color: '#B0BEC5' }}>
            বাংলাদেশের ব্যবসার জন্য সর্বপ্রথম enterprise AI chatbot — Facebook ও Instagram-এ ২৪/৭ customer সেবা।
          </p>

          <div className="space-y-4">
            {FEATURES.map(({ icon: Icon, text }) => (
              <div key={text} className="flex items-start gap-3">
                <div className="w-7 h-7 rounded flex items-center justify-center flex-shrink-0 mt-0.5"
                     style={{ backgroundColor: 'rgba(4,170,109,0.2)' }}>
                  <Icon size={14} style={{ color: '#04AA6D' }} />
                </div>
                <p className="text-sm" style={{ color: '#B0BEC5' }}>{text}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="p-4 rounded" style={{ backgroundColor: 'rgba(4,170,109,0.12)', border: '1px solid rgba(4,170,109,0.3)' }}>
          <p className="text-xs mb-1" style={{ color: '#04AA6D' }}>Free trial</p>
          <p className="text-white font-semibold text-sm">১৪ দিন বিনামূল্যে — কোনো credit card নেই</p>
        </div>
      </div>

      {/* ── Right panel — form ────────────────────────────────────────────── */}
      <div className="flex-1 flex items-center justify-center p-6 bg-white">
        <div className="w-full max-w-sm animate-fade-in">

          {/* Mobile logo */}
          <div className="flex items-center gap-2.5 mb-8 lg:hidden">
            <div className="w-8 h-8 rounded flex items-center justify-center"
                 style={{ backgroundColor: '#04AA6D' }}>
              <Bot size={15} className="text-white" />
            </div>
            <span className="font-bold" style={{ color: '#282A35' }}>OmniBot SaaS</span>
          </div>

          <div className="mb-8">
            <h1 className="text-2xl font-bold" style={{ color: '#282A35' }}>Sign in</h1>
            <p className="text-sm mt-1" style={{ color: '#757575' }}>আপনার account-এ লগইন করুন</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1.5" style={{ color: '#282A35' }}>ইমেইল</label>
              <input
                type="email" required className="input"
                placeholder="you@example.com"
                value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-sm font-medium" style={{ color: '#282A35' }}>পাসওয়ার্ড</label>
                <Link href="/forgot-password" className="text-xs hover:underline underline-offset-2"
                      style={{ color: '#04AA6D' }}>
                  পাসওয়ার্ড ভুলে গেছেন?
                </Link>
              </div>
              <div className="relative">
                <input
                  type={showPwd ? 'text' : 'password'} required className="input pr-10"
                  placeholder="••••••••"
                  value={form.password}
                  onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                />
                <button
                  type="button"
                  onClick={() => setShowPwd(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 transition-colors"
                  style={{ color: '#9E9E9E' }}
                >
                  {showPwd ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            <button type="submit" disabled={loading} className="btn-primary w-full py-2.5 mt-2">
              {loading
                ? <><span className="spinner h-4 w-4" /> লগইন হচ্ছে...</>
                : <>লগইন করুন <ArrowRight size={15} /></>
              }
            </button>
          </form>

          <p className="text-center text-sm mt-6" style={{ color: '#757575' }}>
            নতুন account?{' '}
            <Link href="/register" className="font-medium hover:underline underline-offset-2"
                  style={{ color: '#04AA6D' }}>
              বিনামূল্যে শুরু করুন
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
