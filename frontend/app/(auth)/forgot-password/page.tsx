'use client'
import { useState } from 'react'
import Link from 'next/link'
import toast from 'react-hot-toast'
import { authAPI } from '@/lib/api'
import { Bot, Mail, ArrowLeft, CheckCircle } from 'lucide-react'

export default function ForgotPasswordPage() {
  const [email, setEmail]     = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent]       = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      const res = await authAPI.forgotPassword(email)
      setSent(true)
      // Dev mode: show token in toast
      if (res.dev_token) {
        toast('Dev mode: token = ' + res.dev_token, { icon: '🔑', duration: 20000 })
      }
    } catch {
      toast.error('সমস্যা হয়েছে। পরে আবার চেষ্টা করুন।')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex">

      {/* ── Left panel — dark branding ────────────────────────────────────── */}
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
            পাসওয়ার্ড রিসেট
          </h2>
          <p className="text-sm leading-relaxed mb-10" style={{ color: '#B0BEC5' }}>
            আপনার নিবন্ধিত ইমেইল দিন — আমরা একটি secure reset link পাঠাব।
          </p>

          <div className="p-4 rounded space-y-3"
               style={{ backgroundColor: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}>
            <div className="flex items-start gap-3">
              <div className="w-6 h-6 rounded flex items-center justify-center flex-shrink-0 mt-0.5"
                   style={{ backgroundColor: 'rgba(4,170,109,0.2)' }}>
                <span style={{ color: '#04AA6D', fontSize: 11, fontWeight: 700 }}>1</span>
              </div>
              <p className="text-sm" style={{ color: '#B0BEC5' }}>ইমেইল দিন ও Submit করুন</p>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-6 h-6 rounded flex items-center justify-center flex-shrink-0 mt-0.5"
                   style={{ backgroundColor: 'rgba(4,170,109,0.2)' }}>
                <span style={{ color: '#04AA6D', fontSize: 11, fontWeight: 700 }}>2</span>
              </div>
              <p className="text-sm" style={{ color: '#B0BEC5' }}>Inbox চেক করুন (Spam ও দেখুন)</p>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-6 h-6 rounded flex items-center justify-center flex-shrink-0 mt-0.5"
                   style={{ backgroundColor: 'rgba(4,170,109,0.2)' }}>
                <span style={{ color: '#04AA6D', fontSize: 11, fontWeight: 700 }}>3</span>
              </div>
              <p className="text-sm" style={{ color: '#B0BEC5' }}>Link-এ ক্লিক করে নতুন পাসওয়ার্ড দিন</p>
            </div>
          </div>
        </div>

        <p className="text-xs" style={{ color: '#607D8B' }}>Reset link ১ ঘণ্টা পর মেয়াদোত্তীর্ণ হয়।</p>
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

          {sent ? (
            /* ── Success state ─────────────────────────────────────────────── */
            <div className="text-center">
              <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-5"
                   style={{ backgroundColor: '#E8F5E9' }}>
                <CheckCircle size={32} style={{ color: '#04AA6D' }} />
              </div>
              <h1 className="text-2xl font-bold mb-2" style={{ color: '#282A35' }}>ইমেইল পাঠানো হয়েছে!</h1>
              <p className="text-sm mb-2" style={{ color: '#757575' }}>
                <strong style={{ color: '#282A35' }}>{email}</strong> ঠিকানায় একটি reset link পাঠানো হয়েছে।
              </p>
              <p className="text-sm mb-8" style={{ color: '#9E9E9E' }}>
                Spam/Junk folder-ও চেক করুন। Link ১ ঘণ্টা পর মেয়াদোত্তীর্ণ হবে।
              </p>

              <div className="p-4 rounded mb-6 text-left"
                   style={{ backgroundColor: '#F9F9F9', border: '1px solid #E0E0E0' }}>
                <p className="text-xs" style={{ color: '#757575' }}>
                  ইমেইল পাননি?{' '}
                  <button
                    onClick={() => setSent(false)}
                    className="font-medium hover:underline underline-offset-2"
                    style={{ color: '#04AA6D' }}>
                    আবার চেষ্টা করুন
                  </button>
                  {' '}অথবা Spam folder চেক করুন।
                </p>
              </div>

              <Link href="/login"
                    className="flex items-center justify-center gap-2 text-sm font-medium hover:underline"
                    style={{ color: '#04AA6D' }}>
                <ArrowLeft size={14} /> লগইন পেজে ফিরে যান
              </Link>
            </div>
          ) : (
            /* ── Email form ────────────────────────────────────────────────── */
            <>
              <div className="mb-8">
                <h1 className="text-2xl font-bold" style={{ color: '#282A35' }}>পাসওয়ার্ড ভুলে গেছেন?</h1>
                <p className="text-sm mt-1" style={{ color: '#757575' }}>
                  আপনার account-এর ইমেইল দিন — আমরা reset link পাঠাব।
                </p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1.5" style={{ color: '#282A35' }}>
                    নিবন্ধিত ইমেইল
                  </label>
                  <div className="relative">
                    <input
                      type="email" required className="input pl-9"
                      placeholder="you@example.com"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                    />
                    <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2"
                          style={{ color: '#9E9E9E' }} />
                  </div>
                </div>

                <button type="submit" disabled={loading} className="btn-primary w-full py-2.5 mt-2">
                  {loading
                    ? <><span className="spinner h-4 w-4" /> পাঠানো হচ্ছে...</>
                    : 'Reset Link পাঠান'
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
    </div>
  )
}
