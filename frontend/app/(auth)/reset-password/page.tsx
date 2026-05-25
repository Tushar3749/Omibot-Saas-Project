'use client'
import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import toast from 'react-hot-toast'
import { authAPI } from '@/lib/api'
import { Bot, Eye, EyeOff, ShieldCheck, AlertTriangle, ArrowLeft } from 'lucide-react'

// Inner component that reads searchParams (must be wrapped in Suspense)
function ResetPasswordForm() {
  const router       = useRouter()
  const searchParams = useSearchParams()
  const token        = searchParams.get('token') ?? ''

  const [form, setForm]       = useState({ password: '', confirm: '' })
  const [showPwd, setShowPwd] = useState(false)
  const [showCfm, setShowCfm] = useState(false)
  const [loading, setLoading] = useState(false)
  const [done, setDone]       = useState(false)

  useEffect(() => {
    if (!token) {
      toast.error('Reset token পাওয়া যায়নি। আবার চেষ্টা করুন।')
    }
  }, [token])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (form.password !== form.confirm) {
      toast.error('পাসওয়ার্ড দুটি মিলছে না।')
      return
    }
    if (!token) {
      toast.error('Token অকার্যকর। Forgot password পেজ থেকে আবার চেষ্টা করুন।')
      return
    }
    setLoading(true)
    try {
      await authAPI.resetPassword(token, form.password)
      setDone(true)
      toast.success('পাসওয়ার্ড পরিবর্তন হয়েছে!')
      setTimeout(() => router.push('/login'), 2500)
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      toast.error(detail || 'Token অকার্যকর বা মেয়াদোত্তীর্ণ। আবার চেষ্টা করুন।')
    } finally {
      setLoading(false)
    }
  }

  const strength = (() => {
    const p = form.password
    if (p.length === 0) return 0
    let s = 0
    if (p.length >= 8)             s++
    if (/[A-Z]/.test(p))          s++
    if (/[0-9]/.test(p))          s++
    if (/[^A-Za-z0-9]/.test(p))   s++
    return s
  })()

  const strengthLabel = ['', 'দুর্বল', 'মাঝারি', 'ভালো', 'শক্তিশালী'][strength]
  const strengthColor = ['', '#EF5350', '#FF9800', '#66BB6A', '#04AA6D'][strength]

  return (
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

        {done ? (
          /* ── Success state ─────────────────────────────────────────────── */
          <div className="text-center">
            <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-5"
                 style={{ backgroundColor: '#E8F5E9' }}>
              <ShieldCheck size={32} style={{ color: '#04AA6D' }} />
            </div>
            <h1 className="text-2xl font-bold mb-2" style={{ color: '#282A35' }}>পাসওয়ার্ড পরিবর্তন হয়েছে!</h1>
            <p className="text-sm mb-6" style={{ color: '#757575' }}>
              আপনার নতুন পাসওয়ার্ড দিয়ে লগইন করুন। কয়েক সেকেন্ডের মধ্যে redirect হবে…
            </p>
            <Link href="/login" className="btn-primary inline-flex gap-2">
              <ArrowLeft size={14} /> লগইন পেজে যান
            </Link>
          </div>
        ) : !token ? (
          /* ── No token state ────────────────────────────────────────────── */
          <div className="text-center">
            <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-5"
                 style={{ backgroundColor: '#FFEBEE' }}>
              <AlertTriangle size={32} style={{ color: '#C62828' }} />
            </div>
            <h1 className="text-2xl font-bold mb-2" style={{ color: '#282A35' }}>Link অকার্যকর</h1>
            <p className="text-sm mb-6" style={{ color: '#757575' }}>
              Reset token পাওয়া যায়নি। ইমেইলের link থেকে এই পেজে আসুন।
            </p>
            <Link href="/forgot-password" className="btn-primary inline-flex gap-2">
              আবার অনুরোধ করুন
            </Link>
          </div>
        ) : (
          /* ── Reset form ────────────────────────────────────────────────── */
          <>
            <div className="mb-8">
              <h1 className="text-2xl font-bold" style={{ color: '#282A35' }}>নতুন পাসওয়ার্ড দিন</h1>
              <p className="text-sm mt-1" style={{ color: '#757575' }}>
                কমপক্ষে ৬ অক্ষরের একটি শক্তিশালী পাসওয়ার্ড দিন।
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* New password */}
              <div>
                <label className="block text-sm font-medium mb-1.5" style={{ color: '#282A35' }}>
                  নতুন পাসওয়ার্ড
                </label>
                <div className="relative">
                  <input
                    type={showPwd ? 'text' : 'password'} required minLength={6}
                    className="input pr-10"
                    placeholder="••••••••"
                    value={form.password}
                    onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                  />
                  <button type="button" onClick={() => setShowPwd(v => !v)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 transition-colors"
                          style={{ color: '#9E9E9E' }}>
                    {showPwd ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>

                {/* Strength bar */}
                {form.password.length > 0 && (
                  <div className="mt-2">
                    <div className="flex gap-1 mb-1">
                      {[1,2,3,4].map(i => (
                        <div key={i} className="h-1 flex-1 rounded-full transition-all"
                             style={{ backgroundColor: i <= strength ? strengthColor : '#E0E0E0' }} />
                      ))}
                    </div>
                    <p className="text-xs" style={{ color: strengthColor }}>{strengthLabel}</p>
                  </div>
                )}
              </div>

              {/* Confirm password */}
              <div>
                <label className="block text-sm font-medium mb-1.5" style={{ color: '#282A35' }}>
                  পাসওয়ার্ড নিশ্চিত করুন
                </label>
                <div className="relative">
                  <input
                    type={showCfm ? 'text' : 'password'} required minLength={6}
                    className="input pr-10"
                    placeholder="••••••••"
                    value={form.confirm}
                    onChange={e => setForm(f => ({ ...f, confirm: e.target.value }))}
                  />
                  <button type="button" onClick={() => setShowCfm(v => !v)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 transition-colors"
                          style={{ color: '#9E9E9E' }}>
                    {showCfm ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
                {form.confirm.length > 0 && form.password !== form.confirm && (
                  <p className="text-xs mt-1" style={{ color: '#EF5350' }}>পাসওয়ার্ড দুটি মিলছে না।</p>
                )}
              </div>

              <button type="submit" disabled={loading} className="btn-primary w-full py-2.5 mt-2">
                {loading
                  ? <><span className="spinner h-4 w-4" /> পরিবর্তন হচ্ছে...</>
                  : 'পাসওয়ার্ড পরিবর্তন করুন'
                }
              </button>
            </form>

            <Link href="/login"
                  className="flex items-center justify-center gap-2 text-sm mt-6 hover:underline"
                  style={{ color: '#04AA6D' }}>
              <ArrowLeft size={14} /> লগইনে ফিরে যান
            </Link>
          </>
        )}
      </div>
    </div>
  )
}

export default function ResetPasswordPage() {
  return (
    <div className="min-h-screen flex">

      {/* ── Left panel — dark branding ────────────────────────────────────── */}
      <div className="hidden lg:flex flex-col justify-between w-[420px] flex-shrink-0 p-10"
           style={{ backgroundColor: '#282A35' }}>
        <div>
          <div className="flex items-center gap-3 mb-14">
            <div className="w-9 h-9 rounded flex items-center justify-center"
                 style={{ backgroundColor: '#04AA6D' }}>
              <Bot size={18} className="text-white" />
            </div>
            <span className="text-white font-bold text-lg">OmniBot SaaS</span>
          </div>

          <h2 className="text-3xl font-bold text-white leading-snug mb-4">
            নিরাপদ পাসওয়ার্ড<br />তৈরি করুন
          </h2>
          <p className="text-sm leading-relaxed mb-10" style={{ color: '#B0BEC5' }}>
            একটি শক্তিশালী পাসওয়ার্ড আপনার account ও customer data সুরক্ষিত রাখে।
          </p>

          {/* Tips */}
          <div className="space-y-3">
            {[
              'কমপক্ষে ৮ অক্ষর ব্যবহার করুন',
              'বড় ও ছোট হাতের অক্ষর মেশান',
              'সংখ্যা ও বিশেষ চিহ্ন যোগ করুন',
              'আগের পাসওয়ার্ড পুনরায় ব্যবহার করবেন না',
            ].map(tip => (
              <div key={tip} className="flex items-center gap-3">
                <div className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                     style={{ backgroundColor: '#04AA6D' }} />
                <p className="text-sm" style={{ color: '#B0BEC5' }}>{tip}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="p-4 rounded"
             style={{ backgroundColor: 'rgba(4,170,109,0.12)', border: '1px solid rgba(4,170,109,0.3)' }}>
          <p className="text-xs mb-1" style={{ color: '#04AA6D' }}>Security</p>
          <p className="text-white font-semibold text-sm">আপনার পাসওয়ার্ড encrypted ভাবে সংরক্ষিত হয়</p>
        </div>
      </div>

      {/* ── Right panel ───────────────────────────────────────────────────── */}
      <Suspense fallback={
        <div className="flex-1 flex items-center justify-center">
          <div className="spinner h-8 w-8" />
        </div>
      }>
        <ResetPasswordForm />
      </Suspense>
    </div>
  )
}
