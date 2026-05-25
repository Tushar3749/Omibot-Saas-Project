'use client'
import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { configAPI } from '@/lib/api'
import type { AIConfig } from '@/types'
import { Bot, Shield, AlertTriangle, Plus, X, Save, TrendingDown } from 'lucide-react'

export default function SettingsPage() {
  const [config, setConfig]   = useState<Partial<AIConfig>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)
  const [newKW, setNewKW]     = useState('')
  const [newFT, setNewFT]     = useState('')
  const [newPhrase, setNewPhrase] = useState('')

  useEffect(() => {
    configAPI.get()
      .then(d => { setConfig(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  async function handleSave() {
    setSaving(true)
    try {
      await configAPI.update(config)
      toast.success('AI settings সংরক্ষিত হয়েছে!')
    } catch { toast.error('সমস্যা হয়েছে') }
    finally { setSaving(false) }
  }

  function addKeyword() {
    if (!newKW.trim()) return
    setConfig(c => ({ ...c, escalation_keywords: [...(c.escalation_keywords || []), newKW.trim()] }))
    setNewKW('')
  }
  function removeKeyword(kw: string) {
    setConfig(c => ({ ...c, escalation_keywords: (c.escalation_keywords || []).filter(k => k !== kw) }))
  }
  function addForbidden() {
    if (!newFT.trim()) return
    setConfig(c => ({ ...c, forbidden_topics: [...(c.forbidden_topics || []), newFT.trim()] }))
    setNewFT('')
  }
  function removeForbidden(ft: string) {
    setConfig(c => ({ ...c, forbidden_topics: (c.forbidden_topics || []).filter(f => f !== ft) }))
  }
  function addPhrase() {
    if (!newPhrase.trim()) return
    setConfig(c => ({ ...c, negotiation_phrases: [...(c.negotiation_phrases || []), newPhrase.trim()] }))
    setNewPhrase('')
  }
  function removePhrase(ph: string) {
    setConfig(c => ({ ...c, negotiation_phrases: (c.negotiation_phrases || []).filter(p => p !== ph) }))
  }

  if (loading) return (
    <div className="flex justify-center py-20">
      <div className="spinner h-8 w-8" />
    </div>
  )

  function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
    return (
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`toggle-track ${checked ? 'toggle-track-on' : ''}`}
      >
        <span className={`toggle-thumb ${checked ? 'toggle-thumb-on' : ''}`} />
      </button>
    )
  }

  return (
    <div className="max-w-2xl space-y-5">

      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">AI Settings</h1>
          <p className="page-subtitle">Bot-এর personality ও security configure করুন</p>
        </div>
        <button onClick={handleSave} disabled={saving} className="btn-primary gap-2">
          {saving ? <><span className="spinner h-4 w-4" /> সংরক্ষণ...</> : <><Save size={15} /> সংরক্ষণ করুন</>}
        </button>
      </div>

      {/* ── Identity card ─────────────────────────────────────────────────── */}
      <div className="card p-5 space-y-4">
        <div className="flex items-center gap-2.5 pb-1">
          <div className="w-8 h-8 rounded flex items-center justify-center"
               style={{ backgroundColor: '#E8F5E9' }}>
            <Bot size={16} style={{ color: '#04AA6D' }} />
          </div>
          <h2 className="font-semibold" style={{ color: '#282A35' }}>Bot পরিচয়</h2>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1.5" style={{ color: '#282A35' }}>Bot-এর নাম</label>
            <input className="input" value={config.bot_name || ''}
              onChange={e => setConfig(c => ({ ...c, bot_name: e.target.value }))} />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5" style={{ color: '#282A35' }}>ভাষা</label>
            <select className="input" value={config.language || 'bangla'}
              onChange={e => setConfig(c => ({ ...c, language: e.target.value as AIConfig['language'] }))}>
              <option value="bangla">বাংলা</option>
              <option value="english">English</option>
              <option value="banglish">Banglish</option>
            </select>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1.5" style={{ color: '#282A35' }}>System Prompt</label>
          <p className="text-xs mb-2" style={{ color: '#9E9E9E' }}>Security protection headers স্বয়ংক্রিয়ভাবে যোগ হবে</p>
          <textarea
            className="input h-36 resize-none font-mono text-xs leading-relaxed"
            value={config.system_prompt || ''}
            onChange={e => setConfig(c => ({ ...c, system_prompt: e.target.value }))}
          />
        </div>

        <div className="flex items-center justify-between p-3.5 rounded"
             style={{ backgroundColor: '#F9F9F9', border: '1px solid #E0E0E0' }}>
          <div>
            <p className="text-sm font-medium" style={{ color: '#282A35' }}>দামাদামি Allow</p>
            <p className="text-xs mt-0.5" style={{ color: '#757575' }}>AI সর্বোচ্চ নির্ধারিত % পর্যন্ত ছাড় দিতে পারবে</p>
          </div>
          <Toggle
            checked={config.allow_negotiation || false}
            onChange={v => setConfig(c => ({ ...c, allow_negotiation: v }))}
          />
        </div>
      </div>

      {/* ── Negotiation card ───────────────────────────────────────────────── */}
      <div className="card p-5 space-y-4">
        <div className="flex items-center gap-2.5 pb-1">
          <div className="w-8 h-8 rounded flex items-center justify-center"
               style={{ backgroundColor: '#E8F5E9' }}>
            <TrendingDown size={16} style={{ color: '#04AA6D' }} />
          </div>
          <div>
            <h2 className="font-semibold" style={{ color: '#282A35' }}>Negotiation সেটিংস</h2>
            <p className="text-xs" style={{ color: '#9E9E9E' }}>দামাদামির সীমা ও কৌশল নির্ধারণ করুন</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1.5" style={{ color: '#282A35' }}>
              সর্বোচ্চ ছাড় (%)
            </label>
            <input
              type="number"
              min="0"
              max="80"
              step="0.5"
              className="input"
              value={config.max_discount_pct ?? 15}
              onChange={e => setConfig(c => ({ ...c, max_discount_pct: parseFloat(e.target.value) || 0 }))}
            />
            <p className="text-xs mt-1" style={{ color: '#9E9E9E' }}>AI এই সীমার বাইরে ছাড় দেবে না</p>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5" style={{ color: '#282A35' }}>
              Negotiation স্টাইল
            </label>
            <select
              className="input"
              value={config.negotiation_style || 'moderate'}
              onChange={e => setConfig(c => ({ ...c, negotiation_style: e.target.value as AIConfig['negotiation_style'] }))}
            >
              <option value="aggressive">Aggressive (কম ছাড়, দৃঢ়)</option>
              <option value="moderate">Moderate (ভারসাম্য)</option>
              <option value="soft">Soft (বেশি নমনীয়)</option>
            </select>
          </div>
        </div>

        {/* Custom negotiation phrases in Bangla */}
        <div>
          <p className="text-sm font-medium mb-1.5" style={{ color: '#282A35' }}>কাস্টম দামাদামি বাক্য (বাংলায়)</p>
          <p className="text-xs mb-3" style={{ color: '#9E9E9E' }}>AI এই বাক্যগুলো ব্যবহার করে দামাদামি করবে</p>
          <div className="flex flex-wrap gap-2 mb-3 min-h-8">
            {(config.negotiation_phrases || []).map((ph, i) => (
              <span key={i} className="badge border text-xs"
                    style={{ backgroundColor: '#E8F5E9', color: '#2E7D32', borderColor: '#A5D6A7' }}>
                {ph}
                <button onClick={() => removePhrase(ph)} className="hover:text-red-600 transition-colors ml-0.5">
                  <X size={10} />
                </button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              className="input flex-1"
              placeholder="যেমন: ভাই, এইটুকু ছাড় দিতে পারলে নিয়ে নেন..."
              value={newPhrase}
              onChange={e => setNewPhrase(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addPhrase()}
            />
            <button onClick={addPhrase} className="btn-secondary px-3"><Plus size={15} /></button>
          </div>
        </div>
      </div>

      {/* ── Security card ─────────────────────────────────────────────────── */}
      <div className="card p-5 space-y-4">
        <div className="flex items-center gap-2.5 pb-1">
          <div className="w-8 h-8 rounded flex items-center justify-center"
               style={{ backgroundColor: '#E8F5E9' }}>
            <Shield size={16} style={{ color: '#04AA6D' }} />
          </div>
          <h2 className="font-semibold" style={{ color: '#282A35' }}>Security</h2>
        </div>

        {/* Injection guard */}
        <div className="flex items-center justify-between p-3.5 rounded"
             style={{ backgroundColor: '#E8F5E9', border: '1px solid #C8E6C9' }}>
          <div>
            <p className="text-sm font-medium" style={{ color: '#282A35' }}>Prompt Injection Protection</p>
            <p className="text-xs mt-0.5" style={{ color: '#4CAF50' }}>AI-কে manipulate করা থেকে সুরক্ষিত রাখে</p>
          </div>
          <Toggle
            checked={config.prompt_injection_guard !== false}
            onChange={v => setConfig(c => ({ ...c, prompt_injection_guard: v }))}
          />
        </div>

        {/* Escalation keywords */}
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <AlertTriangle size={13} style={{ color: '#F57F17' }} />
            <p className="text-sm font-medium" style={{ color: '#282A35' }}>Escalation Keywords</p>
          </div>
          <p className="text-xs mb-3" style={{ color: '#9E9E9E' }}>এই শব্দ দেখলে AI আপনাকে alert করবে</p>
          <div className="flex flex-wrap gap-2 mb-3 min-h-8">
            {(config.escalation_keywords || []).map(kw => (
              <span key={kw} className="badge border text-xs"
                    style={{ backgroundColor: '#FFF8E1', color: '#F57F17', borderColor: '#FFE082' }}>
                {kw}
                <button onClick={() => removeKeyword(kw)} className="hover:text-red-600 transition-colors ml-0.5">
                  <X size={10} />
                </button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              className="input flex-1"
              placeholder="keyword লিখুন..."
              value={newKW}
              onChange={e => setNewKW(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addKeyword()}
            />
            <button onClick={addKeyword} className="btn-secondary px-3"><Plus size={15} /></button>
          </div>
        </div>

        {/* Forbidden topics */}
        <div>
          <p className="text-sm font-medium mb-1.5" style={{ color: '#282A35' }}>Forbidden Topics</p>
          <p className="text-xs mb-3" style={{ color: '#9E9E9E' }}>এই বিষয়ে AI কথা বলবে না</p>
          <div className="flex flex-wrap gap-2 mb-3 min-h-8">
            {(config.forbidden_topics || []).map(ft => (
              <span key={ft} className="badge border text-xs"
                    style={{ backgroundColor: '#FFEBEE', color: '#C62828', borderColor: '#EF9A9A' }}>
                {ft}
                <button onClick={() => removeForbidden(ft)} className="hover:text-red-900 transition-colors ml-0.5">
                  <X size={10} />
                </button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              className="input flex-1"
              placeholder="topic লিখুন..."
              value={newFT}
              onChange={e => setNewFT(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addForbidden()}
            />
            <button onClick={addForbidden} className="btn-secondary px-3"><Plus size={15} /></button>
          </div>
        </div>
      </div>

      <button onClick={handleSave} disabled={saving} className="btn-primary px-8 py-2.5">
        {saving ? <><span className="spinner h-4 w-4" /> সংরক্ষণ হচ্ছে...</> : <><Save size={15} /> পরিবর্তন সংরক্ষণ করুন</>}
      </button>
    </div>
  )
}
