'use client'
import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { configAPI, settingsAPI, otpAPI } from '@/lib/api'
import type { AIConfig } from '@/types'
import {
  Bot, Shield, AlertTriangle, Plus, X, Save,
  Search, ShoppingBag, Zap, MapPin, Heart, MessageSquare, Package, Globe,
} from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface DeliveryCharge { district: string; charge: number }

const BD_DISTRICTS = [
  'Bagerhat','Bandarban','Barguna','Barisal','Bhola','Bogra','Brahmanbaria',
  'Chandpur','Chapainawabganj','Chattogram','Chuadanga','Cumilla',"Cox's Bazar",
  'Dhaka','Dinajpur','Faridpur','Feni','Gaibandha','Gazipur','Gopalganj',
  'Habiganj','Jamalpur','Jashore','Jhalokathi','Jhenaidah','Joypurhat',
  'Khagrachhari','Khulna','Kishoreganj','Kurigram','Kushtia','Lakshmipur',
  'Lalmonirhat','Madaripur','Magura','Manikganj','Meherpur','Moulvibazar',
  'Munshiganj','Mymensingh','Naogaon','Narail','Narayanganj','Narsingdi',
  'Natore','Netrakona','Nilphamari','Noakhali','Pabna','Panchagarh',
  'Patuakhali','Pirojpur','Rajbari','Rajshahi','Rangamati','Rangpur',
  'Satkhira','Shariatpur','Sherpur','Sirajganj','Sunamganj','Sylhet',
  'Tangail','Thakurgaon',
]

const TABS = [
  { id: 'identity',     label: 'পরিচয়',           icon: Bot },
  { id: 'orders',       label: 'অর্ডার',           icon: ShoppingBag },
  { id: 'ai',           label: 'AI আচরণ',          icon: Zap },
  { id: 'integrations', label: 'ইন্টিগ্রেশন',      icon: Globe },
  { id: 'local',        label: 'স্থানীয় সেটিংস',  icon: MapPin },
  { id: 'loyalty',      label: 'লয়ালটি',          icon: Heart },
  { id: 'templates',    label: 'টেমপ্লেট',         icon: MessageSquare },
  { id: 'security',     label: 'সিকিউরিটি',        icon: Shield },
] as const
type TabId = typeof TABS[number]['id']

// ─── Mini components ──────────────────────────────────────────────────────────

function Toggle({ checked, onChange, label, sub }: { checked: boolean; onChange: (v: boolean) => void; label?: string; sub?: string }) {
  return (
    <div className="flex items-center justify-between p-3.5 rounded"
         style={{ backgroundColor: 'var(--c-surface)', border: '1px solid var(--c-border)' }}>
      {(label || sub) && (
        <div>
          {label && <p className="text-sm font-medium" style={{ color: 'var(--c-text)' }}>{label}</p>}
          {sub && <p className="text-xs mt-0.5" style={{ color: 'var(--c-muted)' }}>{sub}</p>}
        </div>
      )}
      <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
              className={`toggle-track ${checked ? 'toggle-track-on' : ''}`}>
        <span className={`toggle-thumb ${checked ? 'toggle-thumb-on' : ''}`} />
      </button>
    </div>
  )
}

function TagList({ tags, onRemove, inputValue, onInputChange, onAdd, placeholder, tagStyle }: {
  tags: string[]; onRemove: (t: string) => void; inputValue: string
  onInputChange: (v: string) => void; onAdd: () => void; placeholder: string
  tagStyle: { backgroundColor: string; color: string; borderColor: string }
}) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5 min-h-[32px]">
        {tags.map(tag => (
          <span key={tag} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border" style={tagStyle}>
            {tag}
            <button type="button" onClick={() => onRemove(tag)} className="ml-0.5 hover:opacity-60 transition-opacity flex items-center"><X size={10} /></button>
          </span>
        ))}
        {tags.length === 0 && <span className="text-xs italic" style={{ color: 'var(--c-muted)' }}>কোনো আইটেম যোগ হয়নি</span>}
      </div>
      <div className="flex gap-2">
        <input className="input flex-1 text-sm" placeholder={placeholder} value={inputValue}
               onChange={e => onInputChange(e.target.value)}
               onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); onAdd() } }} />
        <button type="button" onClick={onAdd} className="btn-secondary px-3" title="যোগ করুন"><Plus size={15} /></button>
      </div>
    </div>
  )
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

function TemplateField({ label, value, onChange, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; placeholder: string
}) {
  return (
    <div>
      <label className="block text-xs font-medium mb-1" style={{ color: 'var(--c-text)' }}>{label}</label>
      <textarea className="input text-xs resize-none h-20" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  )
}

function NumField({ label, value, onChange, min = 0, step = 1, suffix }: {
  label: string; value: number | string; onChange: (v: string) => void
  min?: number; step?: number; suffix?: string
}) {
  return (
    <div>
      <label className="block text-xs font-medium mb-1" style={{ color: 'var(--c-text)' }}>{label}</label>
      <div className="relative">
        <input type="number" min={min} step={step} className="input pr-10" value={value}
               onChange={e => onChange(e.target.value)} />
        {suffix && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs pointer-events-none" style={{ color: 'var(--c-muted)' }}>{suffix}</span>}
      </div>
    </div>
  )
}

// ─── Coming Soon wrappers ─────────────────────────────────────────────────────

function ComingSoon({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative rounded overflow-hidden">
      <div className="pointer-events-none select-none" style={{ opacity: 0.45 }}>
        {children}
      </div>
      <div className="absolute inset-0 flex items-center justify-center" style={{ zIndex: 2 }}>
        <span
          title="এই feature শীঘ্রই চালু হবে"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold shadow-md"
          style={{ background: 'rgba(255,152,0,0.18)', border: '1px solid rgba(255,152,0,0.45)', color: '#FF9800' }}
        >
          🚧 শীঘ্রই আসছে
        </span>
      </div>
    </div>
  )
}

function FullTabComingSoon({ children, feature }: { children: React.ReactNode; feature: string }) {
  return (
    <div className="relative" style={{ minHeight: 320 }}>
      <div className="pointer-events-none select-none" style={{ opacity: 0.22 }}>
        {children}
      </div>
      <div className="absolute inset-0 flex flex-col items-center justify-center"
           style={{ zIndex: 2, backdropFilter: 'blur(3px)', borderRadius: 12 }}>
        <div className="text-center px-8 py-7 rounded-2xl"
             style={{ background: 'var(--c-card)', border: '1px solid var(--c-border)', maxWidth: 340, boxShadow: '0 8px 40px rgba(0,0,0,0.3)' }}>
          <p className="text-4xl mb-3">🚧</p>
          <p className="text-lg font-bold mb-1" style={{ color: 'var(--c-text)' }}>শীঘ্রই আসছে</p>
          <p className="text-sm mt-2" style={{ color: 'var(--c-muted)' }}>{feature} feature শীঘ্রই চালু হবে</p>
          <p className="text-xs mt-1" style={{ color: 'var(--c-muted)', opacity: 0.7 }}>এই feature শীঘ্রই চালু হবে</p>
        </div>
      </div>
    </div>
  )
}

// ─── Main page ─────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const [config, setConfig] = useState<Partial<AIConfig> & Record<string, unknown>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [activeTab, setActiveTab] = useState<TabId>('identity')

  // Tag input states
  const [newKW, setNewKW] = useState('')
  const [newFT, setNewFT] = useState('')

  // Delivery charges
  const [charges, setCharges]               = useState<DeliveryCharge[]>(BD_DISTRICTS.map(d => ({ district: d, charge: 0 })))
  const [chargesLoading, setChargesLoading] = useState(true)
  const [savingCharges, setSavingCharges]   = useState(false)
  const [districtSearch, setDistrictSearch] = useState('')

  // SMS / OTP test
  const [testPhone, setTestPhone]   = useState('')
  const [testingSms, setTestingSms] = useState(false)

  // ── Load all data ─────────────────────────────────────────────────────────
  useEffect(() => {
    configAPI.get().then(d => setConfig(d || {})).catch(() => {}).finally(() => setLoading(false))
    settingsAPI.getDeliveryCharges().then(d => setCharges(d)).catch(() => {}).finally(() => setChargesLoading(false))
  }, [])

  // ── Save AI Config ────────────────────────────────────────────────────────
  async function handleSave() {
    setSaving(true)
    try {
      await configAPI.update(config as Record<string, unknown>)
      toast.success('✅ Settings সংরক্ষিত হয়েছে!')
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      toast.error(msg || 'সংরক্ষণ ব্যর্থ হয়েছে')
    } finally {
      setSaving(false)
    }
  }

  // ── Save Delivery Charges ─────────────────────────────────────────────────
  async function handleSaveCharges() {
    setSavingCharges(true)
    try {
      await settingsAPI.saveDeliveryCharges(charges)
      toast.success('✅ Delivery charges সংরক্ষিত!')
    } catch {
      toast.error('সংরক্ষণ ব্যর্থ')
    } finally {
      setSavingCharges(false)
    }
  }

  function setCharge(district: string, value: string) {
    setCharges(prev => prev.map(c => c.district === district ? { ...c, charge: parseFloat(value) || 0 } : c))
  }

  async function handleTestOTP() {
    if (!testPhone.trim()) { toast.error('ফোন নম্বর দিন'); return }
    setTestingSms(true)
    try {
      const res = await otpAPI.testSend(testPhone.trim())
      toast.success(res.message || '✅ Test OTP পাঠানো হয়েছে!')
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      toast.error(msg || 'SMS পাঠানো যায়নি')
    } finally {
      setTestingSms(false)
    }
  }

  // ── Tag helpers ───────────────────────────────────────────────────────────
  function addKeyword() {
    const kw = newKW.trim(); if (!kw) return
    const arr = (config.escalation_keywords as string[] || [])
    if (!arr.includes(kw)) setConfig(c => ({ ...c, escalation_keywords: [...arr, kw] }))
    setNewKW('')
  }
  function removeKeyword(kw: string) { setConfig(c => ({ ...c, escalation_keywords: (c.escalation_keywords as string[] || []).filter(k => k !== kw) })) }

  function addForbidden() {
    const ft = newFT.trim(); if (!ft) return
    const arr = (config.forbidden_topics as string[] || [])
    if (!arr.includes(ft)) setConfig(c => ({ ...c, forbidden_topics: [...arr, ft] }))
    setNewFT('')
  }
  function removeForbidden(ft: string) { setConfig(c => ({ ...c, forbidden_topics: (c.forbidden_topics as string[] || []).filter(f => f !== ft) })) }

  const filteredDistricts = charges.filter(c => !districtSearch || c.district.toLowerCase().includes(districtSearch.toLowerCase()))

  if (loading) return <div className="flex justify-center py-20"><div className="spinner h-8 w-8" /></div>

  const fridayStart = config.friday_start_hour ?? 13
  const fridayEnd   = config.friday_end_hour   ?? 15

  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-3xl space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">AI Settings</h1>
          <p className="page-subtitle">Bot কনফিগারেশন, অর্ডার নিয়ম ও বাংলাদেশ সেটিংস</p>
        </div>
        <button onClick={handleSave} disabled={saving} className="btn-primary gap-2">
          {saving ? <><span className="spinner h-4 w-4" /> সংরক্ষণ...</> : <><Save size={15} /> সংরক্ষণ করুন</>}
        </button>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 overflow-x-auto pb-1" style={{ borderBottom: '2px solid var(--c-border)' }}>
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-t text-xs font-medium whitespace-nowrap transition-all flex-shrink-0"
            style={{
              color: activeTab === t.id ? '#04AA6D' : 'var(--c-muted)',
              borderBottom: activeTab === t.id ? '2px solid #04AA6D' : '2px solid transparent',
              marginBottom: -2,
              backgroundColor: activeTab === t.id ? 'rgba(4,170,109,0.07)' : 'transparent',
            }}
          >
            <t.icon size={13} />
            {t.label}
          </button>
        ))}
      </div>

      {/* ══ TAB: পরিচয় ══════════════════════════════════════════════════════ */}
      {activeTab === 'identity' && (
        <div className="space-y-4">
          <SectionCard icon={Bot} title="Bot পরিচয়" subtitle="Bot-এর নাম, ভাষা ও ব্যক্তিত্ব">
            <div>
              <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--c-text)' }}>দোকানের নাম</label>
              <input className="input" value={String(config.store_name || '')} onChange={e => setConfig(c => ({ ...c, store_name: e.target.value }))} placeholder="আমাদের স্টোর" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--c-text)' }}>Bot-এর নাম</label>
                <input className="input" value={String(config.bot_name || '')} onChange={e => setConfig(c => ({ ...c, bot_name: e.target.value }))} placeholder="OmniBot" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--c-text)' }}>ভাষা</label>
                <select className="input" value={String(config.language || 'bangla')} onChange={e => setConfig(c => ({ ...c, language: e.target.value as 'bangla' | 'english' | 'banglish' }))}>
                  <option value="bangla">বাংলা</option>
                  <option value="english">English</option>
                  <option value="banglish">Banglish</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: 'var(--c-text)' }}>System Prompt</label>
              <p className="text-xs mb-2" style={{ color: 'var(--c-muted)' }}>Security headers স্বয়ংক্রিয়ভাবে যোগ হবে</p>
              <textarea className="input h-28 resize-none font-mono text-xs leading-relaxed" value={String(config.system_prompt || '')} onChange={e => setConfig(c => ({ ...c, system_prompt: e.target.value }))} placeholder="আপনার bot-এর instructions এখানে লিখুন..." />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: 'var(--c-text)' }}>Greeting Message</label>
              <p className="text-xs mb-2" style={{ color: 'var(--c-muted)' }}>নতুন conversation শুরুতে bot এই message দেবে</p>
              <textarea className="input h-20 resize-none text-sm" value={String(config.greeting_message || '')} onChange={e => setConfig(c => ({ ...c, greeting_message: e.target.value }))} placeholder="স্বাগতম! আমি OmniBot, আপনাকে কীভাবে সাহায্য করতে পারি?" />
            </div>
          </SectionCard>
        </div>
      )}

      {/* ══ TAB: অর্ডার ══════════════════════════════════════════════════════ */}
      {activeTab === 'orders' && (
        <div className="space-y-4">
          <SectionCard icon={ShoppingBag} title="অর্ডার সেটিংস" subtitle="AI অর্ডার গ্রহণের নিয়ম নির্ধারণ করুন">
            <NumField label="রিটার্ন সময়সীমা (দিন)" value={String(config.return_window_days ?? 7)} onChange={v => setConfig(c => ({ ...c, return_window_days: parseInt(v) || 7 }))} min={0} suffix="দিন" />

            <div className="grid grid-cols-2 gap-4">
              <ComingSoon>
                <NumField label="সর্বনিম্ন অর্ডার পরিমাণ (৳)" value={String(config.min_order_amount ?? 0)} onChange={v => setConfig(c => ({ ...c, min_order_amount: parseFloat(v) || 0 }))} min={0} suffix="৳" />
              </ComingSoon>
              <ComingSoon>
                <NumField label="গ্রাহকপ্রতি সর্বোচ্চ পরিমাণ" value={String(config.max_order_qty_per_customer ?? 0)} onChange={v => setConfig(c => ({ ...c, max_order_qty_per_customer: parseInt(v) || 0 }))} min={0} suffix="টি" />
              </ComingSoon>
              <ComingSoon>
                <NumField label="Payment Deadline (ঘণ্টা)" value={String(config.payment_deadline_hours ?? 24)} onChange={v => setConfig(c => ({ ...c, payment_deadline_hours: parseInt(v) || 24 }))} min={1} suffix="h" />
              </ComingSoon>
              <ComingSoon>
                <NumField label="Advance Payment (%)" value={String(config.partial_payment_advance_pct ?? 50)} onChange={v => setConfig(c => ({ ...c, partial_payment_advance_pct: parseFloat(v) || 50 }))} min={10} step={5} suffix="%" />
              </ComingSoon>
            </div>

            <div className="grid grid-cols-1 gap-3">
              <ComingSoon>
                <Toggle checked={Boolean(config.preorder_enabled)} onChange={v => setConfig(c => ({ ...c, preorder_enabled: v }))} label="Pre-order চালু রাখুন" sub="Stock শেষ হলে AI pre-order নেবে" />
              </ComingSoon>
              <ComingSoon>
                <Toggle checked={Boolean(config.waitlist_enabled)} onChange={v => setConfig(c => ({ ...c, waitlist_enabled: v }))} label="Waitlist চালু রাখুন" sub="Stock 0 হলে গ্রাহককে waitlist-এ রাখুন" />
              </ComingSoon>
              <ComingSoon>
                <Toggle checked={Boolean(config.partial_payment_enabled)} onChange={v => setConfig(c => ({ ...c, partial_payment_enabled: v }))} label="Partial Payment চালু" sub="গ্রাহক আংশিক অগ্রিম দিয়ে অর্ডার করতে পারবে" />
              </ComingSoon>
              <ComingSoon>
                <Toggle checked={Boolean(config.installment_enabled)} onChange={v => setConfig(c => ({ ...c, installment_enabled: v }))} label="Installment Option" sub="কিস্তিতে পেমেন্টের সুবিধা দিন" />
              </ComingSoon>
            </div>
          </SectionCard>
        </div>
      )}

      {/* ══ TAB: AI আচরণ ══════════════════════════════════════════════════════ */}
      {activeTab === 'ai' && (
        <div className="space-y-4">
          <SectionCard icon={Zap} title="AI আচরণ" subtitle="AI-এর স্বয়ংক্রিয় উত্তর কনফিগার করুন">
            <div className="grid grid-cols-1 gap-3">
              <Toggle checked={Boolean(config.product_image_auto_send)} onChange={v => setConfig(c => ({ ...c, product_image_auto_send: v }))} label="Product Image Auto-Send" sub="পণ্যের নাম উল্লেখ হলে image স্বয়ংক্রিয়ভাবে পাঠাবে" />
            </div>
          </SectionCard>
        </div>
      )}

      {/* ══ TAB: ইন্টিগ্রেশন ══════════════════════════════════════════════════ */}
      {activeTab === 'integrations' && (
        <div className="space-y-4">

          {/* SMS / OTP Settings */}
          <SectionCard icon={MessageSquare} title="SMS OTP Settings" subtitle="Order tracking-এ customer-এর পরিচয় নিশ্চিত করুন">
            <Toggle
              checked={Boolean(config.sms_enabled)}
              onChange={v => setConfig(c => ({ ...c, sms_enabled: v }))}
              label="SMS OTP চালু করুন"
              sub="Customer 'আমার অর্ডার দেখতে চাই' বললে OTP দিয়ে verify করবে"
            />

            {config.sms_enabled && (<>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--c-text)' }}>SMS Provider</label>
                <select className="input"
                  value={String(config.sms_provider || 'ssl_wireless')}
                  onChange={e => setConfig(c => ({ ...c, sms_provider: e.target.value as 'ssl_wireless' | 'twilio' }))}>
                  <option value="ssl_wireless">SSL Wireless (Bangladesh)</option>
                  <option value="twilio">Twilio</option>
                </select>
              </div>

              {String(config.sms_provider || 'ssl_wireless') === 'ssl_wireless' && (
                <div className="space-y-3 p-3 rounded" style={{ backgroundColor: 'var(--c-surface)', border: '1px solid var(--c-border)' }}>
                  <p className="text-xs font-semibold" style={{ color: 'var(--c-muted)' }}>SSL Wireless Credentials</p>
                  <div>
                    <label className="block text-xs font-medium mb-1" style={{ color: 'var(--c-text)' }}>API Key</label>
                    <input className="input" value={String(config.ssl_wireless_api_key || '')}
                      onChange={e => setConfig(c => ({ ...c, ssl_wireless_api_key: e.target.value }))}
                      placeholder="SSL Wireless API Key" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1" style={{ color: 'var(--c-text)' }}>SID (Sender ID)</label>
                    <input className="input" value={String(config.ssl_wireless_sid || '')}
                      onChange={e => setConfig(c => ({ ...c, ssl_wireless_sid: e.target.value }))}
                      placeholder="OmniBot" />
                  </div>
                </div>
              )}

              {String(config.sms_provider || 'ssl_wireless') === 'twilio' && (
                <div className="space-y-3 p-3 rounded" style={{ backgroundColor: 'var(--c-surface)', border: '1px solid var(--c-border)' }}>
                  <p className="text-xs font-semibold" style={{ color: 'var(--c-muted)' }}>Twilio Credentials</p>
                  <div className="grid grid-cols-1 gap-3">
                    <div>
                      <label className="block text-xs font-medium mb-1" style={{ color: 'var(--c-text)' }}>Account SID</label>
                      <input className="input" value={String(config.twilio_account_sid || '')}
                        onChange={e => setConfig(c => ({ ...c, twilio_account_sid: e.target.value }))}
                        placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1" style={{ color: 'var(--c-text)' }}>Auth Token</label>
                      <input className="input" type="password" value={String(config.twilio_auth_token || '')}
                        onChange={e => setConfig(c => ({ ...c, twilio_auth_token: e.target.value }))}
                        placeholder="••••••••••••••••••••••••••••••••" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1" style={{ color: 'var(--c-text)' }}>From Number</label>
                      <input className="input" value={String(config.twilio_from_number || '')}
                        onChange={e => setConfig(c => ({ ...c, twilio_from_number: e.target.value }))}
                        placeholder="+15551234567" />
                    </div>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-3 gap-2 text-center">
                {[
                  { label: 'OTP মেয়াদ', value: '৫ মিনিট' },
                  { label: 'সর্বোচ্চ চেষ্টা', value: '৩ বার' },
                  { label: 'Block সময়', value: '১৫ মিনিট' },
                ].map(({ label, value }) => (
                  <div key={label} className="p-2 rounded" style={{ backgroundColor: 'var(--c-surface)', border: '1px solid var(--c-border)' }}>
                    <p className="text-xs font-bold" style={{ color: 'var(--c-accent)' }}>{value}</p>
                    <p className="text-2xs" style={{ color: 'var(--c-muted)' }}>{label}</p>
                  </div>
                ))}
              </div>

              <div style={{ borderTop: '1px solid var(--c-border-subtle)', paddingTop: 12 }}>
                <p className="text-xs font-medium mb-2" style={{ color: 'var(--c-text)' }}>Test SMS পাঠান</p>
                <div className="flex gap-2">
                  <input
                    className="input flex-1 text-sm"
                    placeholder="01712345678"
                    value={testPhone}
                    onChange={e => setTestPhone(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleTestOTP() }}
                    maxLength={11}
                  />
                  <button onClick={handleTestOTP} disabled={testingSms} className="btn-secondary gap-2 flex-shrink-0">
                    {testingSms
                      ? <><span className="spinner h-4 w-4" /> পাঠানো হচ্ছে...</>
                      : <><MessageSquare size={14} /> Test OTP</>
                    }
                  </button>
                </div>
                <p className="text-xs mt-1" style={{ color: 'var(--c-muted)' }}>Settings সেভ করার পরে Test করুন</p>
              </div>
            </>)}
          </SectionCard>

          {/* Courier Integration — Coming Soon */}
          <SectionCard icon={Package} title="Courier Integration" subtitle="Pathao ও Steadfast API credentials">
            <ComingSoon>
              <div className="space-y-3">
                <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--c-muted)' }}>Pathao</p>
                <div className="grid grid-cols-1 gap-3">
                  <div>
                    <label className="block text-xs font-medium mb-1" style={{ color: 'var(--c-text)' }}>Store ID</label>
                    <input className="input" type="number" value={String(config.pathao_store_id || '')} onChange={() => {}} placeholder="Pathao Store ID" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium mb-1" style={{ color: 'var(--c-text)' }}>Client ID</label>
                      <input className="input" value={String(config.pathao_client_id || '')} onChange={() => {}} placeholder="Client ID" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1" style={{ color: 'var(--c-text)' }}>Client Secret</label>
                      <input className="input" type="password" value="" onChange={() => {}} placeholder="••••••" />
                    </div>
                  </div>
                </div>
                <div style={{ borderTop: '1px solid var(--c-border-subtle)', paddingTop: 12 }}>
                  <p className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--c-muted)' }}>Steadfast</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium mb-1" style={{ color: 'var(--c-text)' }}>API Key</label>
                      <input className="input" value="" onChange={() => {}} placeholder="API Key" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1" style={{ color: 'var(--c-text)' }}>API Secret</label>
                      <input className="input" type="password" value="" onChange={() => {}} placeholder="••••••" />
                    </div>
                  </div>
                </div>
                <Toggle checked={false} onChange={() => {}} label="সুন্দরবন Courier" sub="সুন্দরবন Courier সার্ভিস ব্যবহার করুন" />
              </div>
            </ComingSoon>
          </SectionCard>
        </div>
      )}

      {/* ══ TAB: স্থানীয় সেটিংস ════════════════════════════════════════════ */}
      {activeTab === 'local' && (
        <div className="space-y-4">

          {/* BD-Specific toggles */}
          <SectionCard icon={MapPin} title="স্থানীয় সেটিংস" subtitle="হরতাল, নামাজ, রমজান ও ঈদ কনফিগারেশন">
            <div className="space-y-3">
              <Toggle checked={Boolean(config.hartal_mode)} onChange={v => setConfig(c => ({ ...c, hartal_mode: v }))} label="হরতাল/ধর্মঘট Mode" sub="চালু করলে AI ডেলিভারি বন্ধের message দেবে" />
              {config.hartal_mode && (
                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: 'var(--c-text)' }}>হরতাল Message</label>
                  <textarea className="input h-16 resize-none text-sm" value={String(config.hartal_message || '')} onChange={e => setConfig(c => ({ ...c, hartal_message: e.target.value }))} />
                </div>
              )}

              <Toggle
                checked={Boolean(config.friday_offline_enabled)}
                onChange={v => setConfig(c => ({ ...c, friday_offline_enabled: v }))}
                label="শুক্রবার নামাজের সময় Offline"
                sub={`শুক্রবার ${fridayStart}:00–${fridayEnd}:00 সময় bot অফলাইন থাকবে`}
              />
              {config.friday_offline_enabled && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium mb-1" style={{ color: 'var(--c-text)' }}>শুরুর সময় (ঘণ্টা)</label>
                    <select className="input" value={String(fridayStart)} onChange={e => setConfig(c => ({ ...c, friday_start_hour: parseInt(e.target.value) }))}>
                      {Array.from({ length: 24 }, (_, i) => (
                        <option key={i} value={i}>{String(i).padStart(2, '0')}:00</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1" style={{ color: 'var(--c-text)' }}>শেষের সময় (ঘণ্টা)</label>
                    <select className="input" value={String(fridayEnd)} onChange={e => setConfig(c => ({ ...c, friday_end_hour: parseInt(e.target.value) }))}>
                      {Array.from({ length: 24 }, (_, i) => (
                        <option key={i} value={i}>{String(i).padStart(2, '0')}:00</option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              <Toggle checked={Boolean(config.ramadan_mode)} onChange={v => setConfig(c => ({ ...c, ramadan_mode: v }))} label="রমজান Mode" sub="রমজান মাসে বিশেষ greeting ও নির্ধারিত সময়ে service" />
              {config.ramadan_mode && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium mb-1" style={{ color: 'var(--c-text)' }}>শুরু (HH:MM)</label>
                    <input className="input" type="time" value={String(config.ramadan_start_time || '09:00')} onChange={e => setConfig(c => ({ ...c, ramadan_start_time: e.target.value }))} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1" style={{ color: 'var(--c-text)' }}>শেষ (HH:MM)</label>
                    <input className="input" type="time" value={String(config.ramadan_end_time || '17:00')} onChange={e => setConfig(c => ({ ...c, ramadan_end_time: e.target.value }))} />
                  </div>
                </div>
              )}

              <Toggle checked={Boolean(config.eid_greeting_enabled)} onChange={v => setConfig(c => ({ ...c, eid_greeting_enabled: v }))} label="ঈদ Greeting" sub="ঈদের দিনে স্বয়ংক্রিয় শুভেচ্ছা বার্তা" />
              {config.eid_greeting_enabled && (
                <div className="space-y-2">
                  <div>
                    <label className="block text-xs font-medium mb-1" style={{ color: 'var(--c-text)' }}>ঈদের তারিখ</label>
                    <input className="input" type="date" value={String(config.eid_greeting_date || '')} onChange={e => setConfig(c => ({ ...c, eid_greeting_date: e.target.value }))} />
                  </div>
                  <TemplateField label="ঈদ Message" value={String(config.eid_greeting_message || '')} onChange={v => setConfig(c => ({ ...c, eid_greeting_message: v }))} placeholder="ঈদ মোবারক! 🌙" />
                </div>
              )}
            </div>
          </SectionCard>

          {/* District delivery charges */}
          <div className="card p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded flex items-center justify-center" style={{ backgroundColor: 'rgba(4,170,109,0.12)' }}>
                  <MapPin size={16} style={{ color: '#04AA6D' }} />
                </div>
                <div>
                  <h2 className="font-semibold text-sm" style={{ color: 'var(--c-text)' }}>জেলা-ভিত্তিক ডেলিভারি চার্জ</h2>
                  <p className="text-xs" style={{ color: 'var(--c-muted)' }}>৬৪ জেলার জন্য ডেলিভারি চার্জ নির্ধারণ করুন</p>
                </div>
              </div>
              <button onClick={handleSaveCharges} disabled={savingCharges} className="btn-primary gap-1.5 text-xs py-1.5 px-3">
                {savingCharges ? <><span className="spinner h-3 w-3" /> সংরক্ষণ...</> : <><Save size={12} /> Save Charges</>}
              </button>
            </div>

            <div className="relative">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--c-muted)' }} />
              <input className="input pl-9 text-sm" placeholder="জেলার নাম খুঁজুন..." value={districtSearch} onChange={e => setDistrictSearch(e.target.value)} />
            </div>

            {chargesLoading ? (
              <div className="flex justify-center py-8"><div className="spinner h-5 w-5" /></div>
            ) : (
              <div className="grid grid-cols-2 gap-2 max-h-96 overflow-y-auto pr-1">
                {filteredDistricts.map(c => (
                  <div key={c.district} className="flex items-center gap-2">
                    <span className="text-xs flex-1 truncate" style={{ color: 'var(--c-text)' }}>{c.district}</span>
                    <div className="relative w-24 flex-shrink-0">
                      <input
                        type="number" min="0" step="10"
                        className="input text-xs pr-5 py-1.5 h-auto"
                        value={c.charge}
                        onChange={e => setCharge(c.district, e.target.value)}
                      />
                      <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs pointer-events-none" style={{ color: 'var(--c-muted)' }}>৳</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══ TAB: লয়ালটি ══════════════════════════════════════════════════════ */}
      {activeTab === 'loyalty' && (
        <FullTabComingSoon feature="Loyalty Program">
          <div className="space-y-4">
            <SectionCard icon={Heart} title="Loyalty Points" subtitle="গ্রাহকদের কেনাকাটায় পয়েন্ট দিন">
              <Toggle checked={false} onChange={() => {}} label="Loyalty Points চালু করুন" sub="প্রতিটি কেনাকাটায় পয়েন্ট অর্জন করতে পারবে" />
              <div className="grid grid-cols-2 gap-4">
                <NumField label="পয়েন্ট / ১ টাকা" value="1" onChange={() => {}} suffix="pts" />
                <NumField label="১ পয়েন্ট = কত টাকা" value="1" onChange={() => {}} suffix="৳" />
                <NumField label="Minimum Redeem Points" value="100" onChange={() => {}} suffix="pts" />
              </div>
            </SectionCard>
            <SectionCard icon={Heart} title="Referral Program" subtitle="রেফারেল করলে উভয়পক্ষ পুরস্কার পাবে">
              <Toggle checked={false} onChange={() => {}} label="Referral Program চালু করুন" sub="বন্ধুকে রেফার করলে ছাড় পাবে" />
              <div className="grid grid-cols-2 gap-4">
                <NumField label="Referee Discount (%)" value="10" onChange={() => {}} suffix="%" />
                <NumField label="Referrer Reward (%)" value="5" onChange={() => {}} suffix="%" />
              </div>
            </SectionCard>
          </div>
        </FullTabComingSoon>
      )}

      {/* ══ TAB: টেমপ্লেট ════════════════════════════════════════════════════ */}
      {activeTab === 'templates' && (
        <FullTabComingSoon feature="Message Templates">
          <div className="space-y-4">
            <SectionCard icon={MessageSquare} title="Message Templates" subtitle="AI এই template দিয়ে গ্রাহকদের message পাঠাবে">
              <div className="grid grid-cols-1 gap-4">
                <TemplateField label="📦 Shipping Confirmation" value="" onChange={() => {}} placeholder="আপনার অর্ডার #{{order_id}} শিপ করা হয়েছে। Tracking: {{tracking}}..." />
                <TemplateField label="⏳ Delay Notification" value="" onChange={() => {}} placeholder="দুঃখিত, আপনার অর্ডার {{delay_days}} দিন দেরি হবে কারণ..." />
                <TemplateField label="❌ Out of Stock Reply" value="" onChange={() => {}} placeholder="দুঃখিত, {{product_name}} বর্তমানে stock নেই। Pre-order/Waitlist-এ যোগ করবেন?" />
                <TemplateField label="📫 Wrong Item Complaint" value="" onChange={() => {}} placeholder="আমরা সমস্যাটি সমাধান করব। ছবি পাঠান, আমরা দ্রুত ব্যবস্থা নেব।" />
                <TemplateField label="⭐ Review Request" value="" onChange={() => {}} placeholder="আপনার অর্ডার পেয়েছেন? একটু review দিলে ভালো হতো! 😊" />
                <TemplateField label="🎁 Referral Program" value="" onChange={() => {}} placeholder="বন্ধুকে refer করুন, আপনি পাবেন {{discount}}% ছাড়!" />
              </div>
            </SectionCard>
          </div>
        </FullTabComingSoon>
      )}

      {/* ══ TAB: সিকিউরিটি ═══════════════════════════════════════════════════ */}
      {activeTab === 'security' && (
        <SectionCard icon={Shield} title="সিকিউরিটি" subtitle="Bot-এর নিরাপত্তা নিয়ন্ত্রণ করুন">
          <div className="flex items-center justify-between p-3.5 rounded"
               style={{ backgroundColor: 'rgba(4,170,109,0.08)', border: '1px solid rgba(4,170,109,0.25)' }}>
            <div>
              <p className="text-sm font-medium" style={{ color: 'var(--c-text)' }}>Prompt Injection Protection</p>
              <p className="text-xs mt-0.5" style={{ color: '#2E7D32' }}>AI-কে manipulate করা থেকে সুরক্ষিত রাখে</p>
            </div>
            <button type="button" role="switch" aria-checked={config.prompt_injection_guard !== false}
                    onClick={() => setConfig(c => ({ ...c, prompt_injection_guard: !c.prompt_injection_guard }))}
                    className={`toggle-track ${config.prompt_injection_guard !== false ? 'toggle-track-on' : ''}`}>
              <span className={`toggle-thumb ${config.prompt_injection_guard !== false ? 'toggle-thumb-on' : ''}`} />
            </button>
          </div>

          <div>
            <div className="flex items-center gap-2 mb-0.5">
              <AlertTriangle size={13} style={{ color: '#F57F17' }} />
              <p className="text-sm font-medium" style={{ color: 'var(--c-text)' }}>Escalation Keywords</p>
            </div>
            <p className="text-xs mb-3" style={{ color: 'var(--c-muted)' }}>এই শব্দ দেখলে AI আপনাকে alert করবে ও human-এর কাছে পাঠাবে।</p>
            <TagList tags={config.escalation_keywords as string[] || []} onRemove={removeKeyword} inputValue={newKW} onInputChange={setNewKW} onAdd={addKeyword} placeholder="keyword লিখুন (Enter চাপুন)..." tagStyle={{ backgroundColor: '#FFF8E1', color: '#F57F17', borderColor: '#FFE082' }} />
          </div>

          <div>
            <p className="text-sm font-medium mb-0.5" style={{ color: 'var(--c-text)' }}>Forbidden Topics</p>
            <p className="text-xs mb-3" style={{ color: 'var(--c-muted)' }}>এই বিষয়ে AI কথা বলবে না।</p>
            <TagList tags={config.forbidden_topics as string[] || []} onRemove={removeForbidden} inputValue={newFT} onInputChange={setNewFT} onAdd={addForbidden} placeholder="topic লিখুন (Enter চাপুন)..." tagStyle={{ backgroundColor: '#FFEBEE', color: '#C62828', borderColor: '#EF9A9A' }} />
          </div>
        </SectionCard>
      )}

      {/* Save button (bottom) — not shown for loyalty/templates (full coming soon) or local (has own charges button) */}
      {activeTab !== 'loyalty' && activeTab !== 'templates' && activeTab !== 'local' && (
        <button onClick={handleSave} disabled={saving} className="btn-primary px-8 py-2.5 gap-2">
          {saving ? <><span className="spinner h-4 w-4" /> সংরক্ষণ হচ্ছে...</> : <><Save size={15} /> পরিবর্তন সংরক্ষণ করুন</>}
        </button>
      )}

    </div>
  )
}
