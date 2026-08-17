'use client'
import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { settingsAPI } from '@/lib/api'
import {
  KeyRound, Eye, EyeOff, ExternalLink, CheckCircle2, XCircle, CircleDashed,
  RefreshCw, Save, Trash2,
} from 'lucide-react'

interface GeminiStatus {
  has_key: boolean
  key_valid: boolean
  model: string
  last_checked: string | null
  key_preview: string
  using?: 'tenant_key' | 'platform_default'
}

function SectionCard({ icon: Icon, title, subtitle, children }: {
  icon: React.ElementType; title: string; subtitle?: string; children: React.ReactNode
}) {
  return (
    <div className="card p-5 space-y-4">
      <div className="flex items-center gap-2.5 pb-1" style={{ borderBottom: '1px solid var(--c-border-subtle)' }}>
        <div className="w-8 h-8 rounded flex items-center justify-center flex-shrink-0"
             style={{ backgroundColor: 'rgba(4,170,109,0.12)' }}>
          <Icon size={16} style={{ color: '#04AA6D' }} />
        </div>
        <div>
          <h2 className="font-semibold text-sm" style={{ color: 'var(--c-text)' }}>{title}</h2>
          {subtitle && <p className="text-xs mt-0.5" style={{ color: 'var(--c-muted)' }}>{subtitle}</p>}
        </div>
      </div>
      {children}
    </div>
  )
}

export default function ApiKeysPage() {
  const [geminiStatus, setGeminiStatus]           = useState<GeminiStatus | null>(null)
  const [statusLoading, setStatusLoading]         = useState(true)
  const [geminiKeyInput, setGeminiKeyInput]       = useState('')
  const [geminiShowKey, setGeminiShowKey]         = useState(false)
  const [geminiChecking, setGeminiChecking]       = useState(false)
  const [geminiSaving, setGeminiSaving]           = useState(false)
  const [geminiRemoving, setGeminiRemoving]       = useState(false)
  const [geminiCheckResult, setGeminiCheckResult] = useState<{ valid: boolean; message?: string; error?: string } | null>(null)

  useEffect(() => {
    settingsAPI.getGeminiStatus()
      .then((d: GeminiStatus) => setGeminiStatus(d))
      .catch(() => {})
      .finally(() => setStatusLoading(false))
  }, [])

  async function handleCheckGeminiKey() {
    const key = geminiKeyInput.trim()
    if (!key) { toast.error('আগে API key লিখুন'); return }
    setGeminiChecking(true)
    setGeminiCheckResult(null)
    try {
      const res = await settingsAPI.validateGeminiKey(key)
      setGeminiCheckResult(res)
      if (res.valid) {
        toast.success('✅ API key সঠিক! Gemini 2.5 Flash কাজ করছে')
      } else {
        toast.error(`❌ ${res.error || 'API key ভুল। সঠিক key দিন।'}`)
      }
    } catch {
      toast.error('⚠️ চেক করতে পারিনি। ইন্টারনেট চেক করুন।')
    } finally {
      setGeminiChecking(false)
    }
  }

  async function handleSaveGeminiKey() {
    const key = geminiKeyInput.trim()
    if (!key) { toast.error('আগে API key লিখুন'); return }
    setGeminiSaving(true)
    try {
      const res = await settingsAPI.saveGeminiKey(key)
      toast.success('💾 Gemini API key সংরক্ষিত হয়েছে!')
      setGeminiKeyInput('')
      setGeminiCheckResult(null)
      setGeminiStatus({
        has_key: true,
        key_valid: true,
        model: res.model,
        last_checked: new Date().toISOString(),
        key_preview: res.key_preview,
        using: 'tenant_key',
      })
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      toast.error(msg ? `❌ ${msg}` : '❌ API key ভুল। সঠিক key দিন।')
    } finally {
      setGeminiSaving(false)
    }
  }

  async function handleRemoveGeminiKey() {
    setGeminiRemoving(true)
    try {
      await settingsAPI.removeGeminiKey()
      toast.success('🗑️ Key মুছে ফেলা হয়েছে — এখন থেকে platform default key ব্যবহার হবে')
      setGeminiKeyInput('')
      setGeminiCheckResult(null)
      setGeminiStatus({
        has_key: false,
        key_valid: false,
        model: geminiStatus?.model || 'gemini-2.5-flash',
        last_checked: null,
        key_preview: '',
        using: 'platform_default',
      })
    } catch {
      toast.error('⚠️ Key মুছতে পারিনি। আবার চেষ্টা করুন।')
    } finally {
      setGeminiRemoving(false)
    }
  }

  if (statusLoading) return <div className="flex justify-center py-20"><div className="spinner h-8 w-8" /></div>

  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <h1 className="page-title">🔑 Manage API Keys</h1>
        <p className="page-subtitle">Gemini AI API key সেট করুন</p>
      </div>

      {/* Card 1: Current Status */}
      <SectionCard icon={KeyRound} title="বর্তমান অবস্থা" subtitle="এখন কোন key দিয়ে বট চলছে">
        <div className="flex items-center gap-2 text-sm">
          {(() => {
            const hasAny = Boolean(geminiStatus?.has_key)
            if (!hasAny) {
              return (
                <span className="flex items-center gap-1.5" style={{ color: 'var(--c-muted)' }}>
                  <CircleDashed size={15} /> ⚪ Platform default key ব্যবহার হচ্ছে
                </span>
              )
            }
            if (geminiStatus?.key_valid) {
              return (
                <span className="flex items-center gap-1.5" style={{ color: '#04AA6D' }}>
                  <CheckCircle2 size={15} /> 🟢 আপনার নিজের key কাজ করছে
                  {geminiStatus.key_preview && (
                    <span style={{ color: 'var(--c-muted)' }}>({geminiStatus.key_preview})</span>
                  )}
                </span>
              )
            }
            return (
              <span className="flex items-center gap-1.5" style={{ color: '#ef4444' }}>
                <XCircle size={15} /> 🔴 Key সংরক্ষিত কিন্তু কাজ করছে না
              </span>
            )
          })()}
        </div>
        {geminiStatus?.last_checked && (
          <p className="text-xs" style={{ color: 'var(--c-muted)' }}>
            সর্বশেষ চেক: {new Date(geminiStatus.last_checked).toLocaleString('bn-BD')}
          </p>
        )}
      </SectionCard>

      {/* Card 2: API Key input */}
      <SectionCard icon={KeyRound} title="🤖 Gemini AI Configuration" subtitle="আপনার Gemini API key সেট করুন">
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--c-text)' }}>API Key</label>
            <div className="relative">
              <input
                className="input pr-10"
                type={geminiShowKey ? 'text' : 'password'}
                value={geminiKeyInput}
                onChange={e => { setGeminiKeyInput(e.target.value); setGeminiCheckResult(null) }}
                placeholder={geminiStatus?.key_preview ? `সংরক্ষিত: ${geminiStatus.key_preview} — নতুন key দিতে এখানে লিখুন` : 'AIza...'}
              />
              <button
                type="button"
                onClick={() => setGeminiShowKey(v => !v)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2"
                style={{ color: 'var(--c-muted)' }}
                tabIndex={-1}
              >
                {geminiShowKey ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>

          {geminiCheckResult && (
            <div className="flex items-center gap-2 text-sm">
              {geminiCheckResult.valid ? (
                <span className="flex items-center gap-1.5" style={{ color: '#04AA6D' }}>
                  <CheckCircle2 size={15} /> কাজ করছে
                </span>
              ) : (
                <span className="flex items-center gap-1.5" style={{ color: '#ef4444' }}>
                  <XCircle size={15} /> {geminiCheckResult.error || 'Invalid key'}
                </span>
              )}
            </div>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleCheckGeminiKey}
              disabled={geminiChecking || geminiSaving}
              className="btn-secondary gap-1.5 text-xs py-1.5 px-3"
            >
              {geminiChecking ? <><span className="spinner h-3.5 w-3.5" /> চেক হচ্ছে...</> : <><RefreshCw size={14} /> এখনই চেক করুন</>}
            </button>
            <button
              type="button"
              onClick={handleSaveGeminiKey}
              disabled={geminiSaving || geminiChecking}
              className="btn-primary gap-1.5 text-xs py-1.5 px-3"
            >
              {geminiSaving ? <><span className="spinner h-3.5 w-3.5" /> সংরক্ষণ হচ্ছে...</> : <><Save size={14} /> সংরক্ষণ করুন</>}
            </button>
            {geminiStatus?.has_key && (
              <button
                type="button"
                onClick={handleRemoveGeminiKey}
                disabled={geminiRemoving || geminiSaving || geminiChecking}
                className="btn-secondary gap-1.5 text-xs py-1.5 px-3"
                style={{ color: '#ef4444' }}
              >
                {geminiRemoving ? <><span className="spinner h-3.5 w-3.5" /> মুছে ফেলা হচ্ছে...</> : <><Trash2 size={14} /> Key মুছুন</>}
              </button>
            )}
          </div>

          <div className="p-3 rounded text-xs leading-relaxed flex items-start gap-2" style={{ backgroundColor: 'var(--c-surface)', border: '1px solid var(--c-border-subtle)', color: 'var(--c-muted)' }}>
            <span>ℹ️</span>
            <span>
              API key পেতে{' '}
              <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1" style={{ color: '#04AA6D' }}>
                Google AI Studio <ExternalLink size={11} />
              </a>
              {' '}দেখুন। Free tier: 15 RPM, 1M tokens/min। Key না দিলে আমাদের default key ব্যবহার হবে।
            </span>
          </div>
        </div>
      </SectionCard>

      {/* Card 3: Model display */}
      <SectionCard icon={KeyRound} title="Model" subtitle="বর্তমানে ব্যবহৃত AI মডেল">
        <input className="input" value={geminiStatus?.model || 'gemini-2.5-flash'} disabled style={{ opacity: 0.6, cursor: 'not-allowed' }} />
      </SectionCard>
    </div>
  )
}
