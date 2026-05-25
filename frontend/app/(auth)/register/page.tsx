'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import toast from 'react-hot-toast'
import { authAPI } from '@/lib/api'
import { saveAuth } from '@/lib/utils'
import { Bot, Check, ArrowRight, Star } from 'lucide-react'

const FEATURES = [
  'বাংলায় AI chatbot — Gemini 2.5 Flash powered',
  'Facebook Messenger + Instagram DM integration',
  'স্বয়ংক্রিয় order extraction via function calling',
  'Real-time analytics ও conversation history',
  'Prompt injection protection — enterprise security',
]

const TESTIMONIAL = {
  quote: '"OmniBot আমার Facebook shop-এর customer service সম্পূর্ণ বদলে দিয়েছে। ৮০% queries এখন automatically handle হয়।"',
  name: 'Rina Begum',
  role: 'Rina Fashion House, Dhaka',
}

export default function RegisterPage() {
  const router = useRouter()
  const [form, setForm] = useState({ email: '', password: '', business_name: '' })
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      const data = await authAPI.register(form)
      saveAuth(data.access_token, data.tenant)
      toast.success('স্বাগতম! Setup wizard শুরু হচ্ছে...')
      router.push('/onboarding')
    } catch (err: unknown) {
      toast.error((err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Registration ব্যর্থ হয়েছে')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex">

      {/* ── Left panel — form ─────────────────────────────────────────────── */}
      <div className="flex-1 flex items-center justify-center p-6 bg-white">
        <div className="w-full max-w-sm animate-fade-in">

          {/* Logo */}
          <div className="flex items-center gap-2.5 mb-8">
            <div className="w-8 h-8 rounded flex items-center justify-center"
                 style={{ backgroundColor: '#04AA6D' }}>
              <Bot size={15} className="text-white" />
            </div>
            <span className="font-bold" style={{ color: '#282A35' }}>OmniBot SaaS</span>
          </div>

          <div className="mb-7">
            <h1 className="text-2xl font-bold" style={{ color: '#282A35' }}>Create your account</h1>
            <p className="text-sm mt-1" style={{ color: '#757575' }}>১৪ দিন বিনামূল্যে — কোনো credit card নেই</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1.5" style={{ color: '#282A35' }}>ব্যবসার নাম</label>
              <input type="text" required className="input"
                placeholder="যেমন: Rina Fashion House"
                value={form.business_name}
                onChange={e => setForm(f => ({ ...f, business_name: e.target.value }))} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5" style={{ color: '#282A35' }}>ইমেইল</label>
              <input type="email" required className="input"
                placeholder="you@example.com"
                value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5" style={{ color: '#282A35' }}>পাসওয়ার্ড</label>
              <input type="password" required minLength={6} className="input"
                placeholder="কমপক্ষে ৬ অক্ষর"
                value={form.password}
                onChange={e => setForm(f => ({ ...f, password: e.target.value }))} />
            </div>

            <button type="submit" disabled={loading} className="btn-primary w-full py-2.5 mt-2">
              {loading
                ? <><span className="spinner h-4 w-4" /> তৈরি হচ্ছে...</>
                : <>বিনামূল্যে শুরু করুন <ArrowRight size={15} /></>
              }
            </button>
          </form>

          <p className="text-center text-sm mt-5" style={{ color: '#757575' }}>
            ইতিমধ্যে account আছে?{' '}
            <Link href="/login" className="font-medium hover:underline underline-offset-2"
                  style={{ color: '#04AA6D' }}>
              লগইন করুন
            </Link>
          </p>

          <p className="text-center text-xs mt-4" style={{ color: '#9E9E9E' }}>
            Sign up করে আপনি আমাদের Terms of Service ও Privacy Policy-তে সম্মত হচ্ছেন
          </p>
        </div>
      </div>

      {/* ── Right panel — features (dark) ─────────────────────────────────── */}
      <div className="hidden lg:flex flex-col justify-between w-[440px] flex-shrink-0 p-10"
           style={{ backgroundColor: '#282A35' }}>
        <div>
          <div className="flex items-center gap-1.5 mb-12">
            {[1,2,3,4,5].map(i => <Star key={i} size={14} className="text-yellow-400 fill-yellow-400" />)}
            <span className="text-xs ml-1" style={{ color: '#78909C' }}>4.9/5 · 200+ businesses</span>
          </div>

          <h2 className="text-2xl font-bold text-white leading-snug mb-3">
            Everything you need to automate customer support
          </h2>
          <p className="text-sm leading-relaxed mb-8" style={{ color: '#90A4AE' }}>
            No technical skills needed. Set up your AI bot in under 15 minutes.
          </p>

          <div className="space-y-3 mb-10">
            {FEATURES.map(f => (
              <div key={f} className="flex items-start gap-3">
                <div className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
                     style={{ backgroundColor: 'rgba(4,170,109,0.2)' }}>
                  <Check size={11} style={{ color: '#04AA6D' }} />
                </div>
                <p className="text-sm" style={{ color: '#B0BEC5' }}>{f}</p>
              </div>
            ))}
          </div>

          {/* Pricing pills */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { name: 'Starter',    price: '৳২,৯৯৯' },
              { name: 'Pro',        price: '৳৫,৯৯৯', highlight: true },
              { name: 'Enterprise', price: '৳৯,৯৯৯' },
            ].map(p => (
              <div key={p.name}
                className="rounded p-3 text-center"
                style={p.highlight
                  ? { backgroundColor: '#04AA6D' }
                  : { backgroundColor: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }
                }>
                <p className="text-xs mb-1" style={{ color: p.highlight ? 'rgba(255,255,255,0.8)' : '#78909C' }}>{p.name}</p>
                <p className="text-sm font-bold text-white">
                  {p.price}<span className="font-normal text-xs opacity-70">/mo</span>
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Testimonial */}
        <div className="p-5 rounded" style={{ backgroundColor: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <p className="text-sm leading-relaxed italic mb-4" style={{ color: '#B0BEC5' }}>{TESTIMONIAL.quote}</p>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                 style={{ backgroundColor: '#04AA6D' }}>
              {TESTIMONIAL.name[0]}
            </div>
            <div>
              <p className="text-white text-sm font-medium">{TESTIMONIAL.name}</p>
              <p className="text-xs" style={{ color: '#607D8B' }}>{TESTIMONIAL.role}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
