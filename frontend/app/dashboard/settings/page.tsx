'use client'
import { useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { configAPI, negotiationAPI, productsAPI, settingsAPI, otpAPI } from '@/lib/api'
import type { AIConfig } from '@/types'
import {
  Bot, Shield, AlertTriangle, Plus, X, Save, TrendingDown, Edit2, Trash2,
  Search, ChevronDown, ShoppingBag, Zap, MapPin, Heart, MessageSquare, Package,
} from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface NegotiationRule {
  id: string; tenant_id: string; product_id: string; sku: string
  product_name: string | null; max_discount_pct: number; min_price: number | null
  negotiation_style: 'aggressive' | 'moderate' | 'soft'; is_active: boolean; created_at: string
}
interface RawProduct { product_id: string; sku: string; name: string; mrp: number }
interface DeliveryCharge { district: string; charge: number }

type RuleForm = {
  product_id: string; sku: string; product_name: string
  max_discount_pct: string; min_price: string
  negotiation_style: 'aggressive' | 'moderate' | 'soft'
}
const EMPTY_RULE_FORM: RuleForm = { product_id: '', sku: '', product_name: '', max_discount_pct: '', min_price: '', negotiation_style: 'moderate' }

const STYLE_META = {
  aggressive: { label: 'Aggressive', bg: '#FFEBEE', color: '#C62828' },
  moderate:   { label: 'Moderate',   bg: '#E3F2FD', color: '#1565C0' },
  soft:       { label: 'Soft',       bg: '#E8F5E9', color: '#2E7D32' },
}

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
  { id: 'identity',    label: 'Bot পরিচয়',    icon: Bot },
  { id: 'orders',      label: 'অর্ডার',        icon: ShoppingBag },
  { id: 'smart',       label: 'Smart AI',      icon: Zap },
  { id: 'bangladesh',  label: '🇧🇩 বাংলাদেশ',  icon: MapPin },
  { id: 'loyalty',     label: 'Loyalty',       icon: Heart },
  { id: 'negotiation', label: 'দামাদামি',       icon: TrendingDown },
  { id: 'templates',   label: 'Templates',     icon: MessageSquare },
  { id: 'security',    label: 'Security',      icon: Shield },
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

// ─── Main page ─────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const [config, setConfig] = useState<Partial<AIConfig> & Record<string, unknown>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [activeTab, setActiveTab] = useState<TabId>('identity')

  // Tag input states
  const [newKW, setNewKW] = useState('')
  const [newFT, setNewFT] = useState('')

  // Negotiation rules
  const [rules, setRules]               = useState<NegotiationRule[]>([])
  const [rulesLoading, setRulesLoading] = useState(true)
  const [showRuleModal, setShowRuleModal] = useState(false)
  const [editingRule, setEditingRule]   = useState<NegotiationRule | null>(null)
  const [ruleForm, setRuleForm]         = useState<RuleForm>(EMPTY_RULE_FORM)
  const [savingRule, setSavingRule]     = useState(false)
  const [deletingRule, setDeletingRule] = useState<string | null>(null)
  const [products, setProducts]         = useState<RawProduct[]>([])
  const [productSearch, setProductSearch] = useState('')
  const [showDropdown, setShowDropdown] = useState(false)
  const dropdownRef   = useRef<HTMLDivElement>(null)

  // Delivery charges
  const [charges, setCharges]         = useState<DeliveryCharge[]>(BD_DISTRICTS.map(d => ({ district: d, charge: 0 })))
  const [chargesLoading, setChargesLoading] = useState(true)
  const [savingCharges, setSavingCharges]   = useState(false)
  const [districtSearch, setDistrictSearch] = useState('')

  // SMS / OTP test
  const [testPhone, setTestPhone]     = useState('')
  const [testingSms, setTestingSms]   = useState(false)

  // ── Load all data ─────────────────────────────────────────────────────────
  useEffect(() => {
    configAPI.get().then(d => setConfig(d || {})).catch(() => {}).finally(() => setLoading(false))

    negotiationAPI.list().then(d => setRules(d)).catch(() => {}).finally(() => setRulesLoading(false))

    productsAPI.list().then(d => setProducts(d.filter((p: RawProduct & { is_active?: boolean }) => p.is_active !== false))).catch(() => {})

    settingsAPI.getDeliveryCharges().then(d => setCharges(d)).catch(() => {}).finally(() => setChargesLoading(false))
  }, [])

  useEffect(() => {
    if (!showDropdown) return
    function handle(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setShowDropdown(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [showDropdown])

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

  // ── Negotiation rule modal ────────────────────────────────────────────────
  function openCreateRule() { setEditingRule(null); setRuleForm(EMPTY_RULE_FORM); setProductSearch(''); setShowDropdown(false); setShowRuleModal(true) }
  function openEditRule(r: NegotiationRule) {
    setEditingRule(r)
    setRuleForm({ product_id: r.product_id, sku: r.sku, product_name: r.product_name || '', max_discount_pct: String(r.max_discount_pct), min_price: r.min_price != null ? String(r.min_price) : '', negotiation_style: r.negotiation_style })
    setProductSearch(''); setShowDropdown(false); setShowRuleModal(true)
  }

  async function handleSaveRule() {
    if (!ruleForm.product_id || !ruleForm.sku) { toast.error('পণ্য নির্বাচন করুন'); return }
    const disc = parseFloat(ruleForm.max_discount_pct)
    if (!ruleForm.max_discount_pct || isNaN(disc) || disc < 0 || disc > 90) { toast.error('সর্বোচ্চ ছাড় ০–৯০% এর মধ্যে দিন'); return }
    setSavingRule(true)
    try {
      if (editingRule) {
        const updated = await negotiationAPI.update(editingRule.id, { max_discount_pct: disc, min_price: ruleForm.min_price ? parseFloat(ruleForm.min_price) : null, negotiation_style: ruleForm.negotiation_style })
        setRules(rs => rs.map(r => r.id === editingRule.id ? updated : r))
        toast.success('✅ Rule আপডেট হয়েছে!')
      } else {
        const created = await negotiationAPI.create({ product_id: ruleForm.product_id, sku: ruleForm.sku, product_name: ruleForm.product_name || undefined, max_discount_pct: disc, min_price: ruleForm.min_price ? parseFloat(ruleForm.min_price) : undefined, negotiation_style: ruleForm.negotiation_style })
        setRules(rs => [created, ...rs])
        toast.success('✅ Rule তৈরি হয়েছে!')
      }
      setShowRuleModal(false)
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      toast.error(msg || 'সমস্যা হয়েছে')
    } finally { setSavingRule(false) }
  }

  async function handleDeleteRule(id: string) {
    if (!confirm('এই rule মুছে ফেলবেন?')) return
    setDeletingRule(id)
    try { await negotiationAPI.delete(id); setRules(rs => rs.filter(r => r.id !== id)); toast.success('Rule মুছে ফেলা হয়েছে') }
    catch { toast.error('মুছতে পারা যায়নি') }
    finally { setDeletingRule(null) }
  }

  const filteredProducts = products.filter(p => { const q = productSearch.toLowerCase(); return !q || p.sku.toLowerCase().includes(q) || p.name.toLowerCase().includes(q) }).slice(0, 10)
  const filteredDistricts = charges.filter(c => !districtSearch || c.district.toLowerCase().includes(districtSearch.toLowerCase()))

  if (loading) return <div className="flex justify-center py-20"><div className="spinner h-8 w-8" /></div>

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

      {/* ══ TAB: Bot পরিচয় ══════════════════════════════════════════════════ */}
      {activeTab === 'identity' && (
        <div className="space-y-4">
          <SectionCard icon={Bot} title="Bot পরিচয়" subtitle="Bot-এর নাম, ভাষা ও ব্যক্তিত্ব">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--c-text)' }}>Bot-এর নাম</label>
                <input className="input" value={String(config.bot_name || '')} onChange={e => setConfig(c => ({ ...c, bot_name: e.target.value }))} placeholder="OmniBot" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--c-text)' }}>ভাষা</label>
                <select className="input" value={String(config.language || 'bangla')} onChange={e => setConfig(c => ({ ...c, language: e.target.value }))}>
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

      {/* ══ TAB: Order Management ══════════════════════════════════════════ */}
      {activeTab === 'orders' && (
        <div className="space-y-4">
          <SectionCard icon={ShoppingBag} title="Order Management" subtitle="AI অর্ডার গ্রহণের নিয়ম নির্ধারণ করুন">
            <div className="grid grid-cols-2 gap-4">
              <NumField label="সর্বনিম্ন অর্ডার পরিমাণ (৳)" value={String(config.min_order_amount ?? 0)} onChange={v => setConfig(c => ({ ...c, min_order_amount: parseFloat(v) || 0 }))} min={0} suffix="৳" />
              <NumField label="গ্রাহকপ্রতি সর্বোচ্চ পরিমাণ" value={String(config.max_order_qty_per_customer ?? 0)} onChange={v => setConfig(c => ({ ...c, max_order_qty_per_customer: parseInt(v) || 0 }))} min={0} suffix="টি" />
              <NumField label="Payment Deadline (ঘণ্টা)" value={String(config.payment_deadline_hours ?? 24)} onChange={v => setConfig(c => ({ ...c, payment_deadline_hours: parseInt(v) || 24 }))} min={1} suffix="h" />
              <NumField label="Advance Payment (%)" value={String(config.partial_payment_advance_pct ?? 50)} onChange={v => setConfig(c => ({ ...c, partial_payment_advance_pct: parseFloat(v) || 50 }))} min={10} step={5} suffix="%" />
            </div>
            <div className="grid grid-cols-1 gap-3 mt-2">
              <Toggle checked={Boolean(config.preorder_enabled)} onChange={v => setConfig(c => ({ ...c, preorder_enabled: v }))} label="Pre-order চালু রাখুন" sub="Stock শেষ হলে AI pre-order নেবে" />
              <Toggle checked={Boolean(config.waitlist_enabled)} onChange={v => setConfig(c => ({ ...c, waitlist_enabled: v }))} label="Waitlist চালু রাখুন" sub="Stock 0 হলে গ্রাহককে waitlist-এ রাখুন" />
              <Toggle checked={Boolean(config.partial_payment_enabled)} onChange={v => setConfig(c => ({ ...c, partial_payment_enabled: v }))} label="Partial Payment চালু" sub="গ্রাহক আংশিক অগ্রিম দিয়ে অর্ডার করতে পারবে" />
              <Toggle checked={Boolean(config.installment_enabled)} onChange={v => setConfig(c => ({ ...c, installment_enabled: v }))} label="Installment Option" sub="কিস্তিতে পেমেন্টের সুবিধা দিন" />
            </div>
          </SectionCard>
        </div>
      )}

      {/* ══ TAB: Smart AI ════════════════════════════════════════════════════ */}
      {activeTab === 'smart' && (
        <div className="space-y-4">
          <SectionCard icon={Zap} title="Smart AI Responses" subtitle="AI-এর স্বয়ংক্রিয় উত্তর কনফিগার করুন">
            <div className="grid grid-cols-1 gap-3">
              <Toggle checked={Boolean(config.price_range_filter_enabled !== false)} onChange={v => setConfig(c => ({ ...c, price_range_filter_enabled: v }))} label="Price Range Filter" sub="Budget বললে AI সেই দামের products দেখাবে" />
              <Toggle checked={Boolean(config.product_image_auto_send)} onChange={v => setConfig(c => ({ ...c, product_image_auto_send: v }))} label="Product Image Auto-Send" sub="পণ্যের নাম উল্লেখ হলে image স্বয়ংক্রিয়ভাবে পাঠাবে" />
              <Toggle checked={Boolean(config.catalog_pdf_auto_send)} onChange={v => setConfig(c => ({ ...c, catalog_pdf_auto_send: v }))} label="Catalog PDF Auto-Send" sub="গ্রাহক catalog চাইলে PDF পাঠাবে" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--c-text)' }}>Competitor Mention Response</label>
              <p className="text-xs mb-2" style={{ color: 'var(--c-muted)' }}>প্রতিযোগীর নাম উল্লেখ হলে AI এই উত্তর দেবে</p>
              <textarea className="input h-24 resize-none text-sm" value={String(config.competitor_response_template || '')} onChange={e => setConfig(c => ({ ...c, competitor_response_template: e.target.value }))} placeholder="আমরা বিশ্বাস করি আমাদের মানের সাথে কেউ প্রতিযোগিতা করতে পারবে না..." />
            </div>
          </SectionCard>

          {/* Conflict Resolution */}
          <SectionCard icon={TrendingDown} title="Discount Conflict Resolution" subtitle="একাধিক discount rule match হলে কোনটি প্রযোজ্য হবে">
            <div className="space-y-2">
              {([
                { value: 'best_deal',      label: 'Best Deal Wins',   desc: 'সর্বোচ্চ discount দেওয়া rule টি apply হবে' },
                { value: 'priority_wins',  label: 'Priority Wins',    desc: 'শুধু সর্বোচ্চ priority-র rule টি apply হবে' },
                { value: 'stack_all',      label: 'Stack All',        desc: 'সব matching rules একসাথে যোগ হবে' },
                { value: 'stack_with_cap', label: 'Stack with Cap',   desc: 'সব যোগ হবে কিন্তু সর্বোচ্চ cap পর্যন্ত' },
              ] as const).map(opt => (
                <label key={opt.value} className="flex items-start gap-3 p-3 rounded cursor-pointer"
                  style={{
                    border: `1px solid ${String(config.conflict_resolution || 'best_deal') === opt.value ? '#04AA6D' : 'var(--c-border)'}`,
                    background: String(config.conflict_resolution || 'best_deal') === opt.value ? 'rgba(4,170,109,0.06)' : 'var(--c-surface)',
                  }}>
                  <input type="radio" name="conflict_resolution" value={opt.value}
                    checked={String(config.conflict_resolution || 'best_deal') === opt.value}
                    onChange={() => setConfig(c => ({ ...c, conflict_resolution: opt.value }))}
                    className="mt-0.5" />
                  <div>
                    <p className="text-xs font-semibold" style={{ color: 'var(--c-text)' }}>{opt.label}</p>
                    <p className="text-xs" style={{ color: 'var(--c-muted)' }}>{opt.desc}</p>
                  </div>
                </label>
              ))}
            </div>
            {String(config.conflict_resolution) === 'stack_with_cap' && (
              <NumField label="Maximum Stack Cap (%)" value={String(config.discount_stack_cap ?? 30)}
                onChange={v => setConfig(c => ({ ...c, discount_stack_cap: parseFloat(v) || 30 }))}
                min={1} step={1} suffix="%" />
            )}
          </SectionCard>
        </div>
      )}

      {/* ══ TAB: বাংলাদেশ Settings ═══════════════════════════════════════════ */}
      {activeTab === 'bangladesh' && (
        <div className="space-y-4">

          {/* ── SMS / OTP Settings ────────────────────────────────────────── */}
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

              {/* SSL Wireless fields */}
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

              {/* Twilio fields */}
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

              {/* OTP details summary */}
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

              {/* Test OTP send */}
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
                  <button
                    onClick={handleTestOTP}
                    disabled={testingSms}
                    className="btn-secondary gap-2 flex-shrink-0"
                  >
                    {testingSms
                      ? <><span className="spinner h-4 w-4" /> পাঠানো হচ্ছে...</>
                      : <><MessageSquare size={14} /> Test OTP</>
                    }
                  </button>
                </div>
                <p className="text-xs mt-1" style={{ color: 'var(--c-muted)' }}>
                  Settings সেভ করার পরে Test করুন
                </p>
              </div>
            </>)}
          </SectionCard>

          {/* Courier Integrations */}
          <SectionCard icon={Package} title="Courier Integration" subtitle="Pathao ও Steadfast API credentials">
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--c-muted)' }}>Pathao</p>
              <div className="grid grid-cols-1 gap-3">
                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: 'var(--c-text)' }}>Store ID</label>
                  <input className="input" type="number" value={String(config.pathao_store_id || '')} onChange={e => setConfig(c => ({ ...c, pathao_store_id: e.target.value }))} placeholder="Pathao Store ID" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium mb-1" style={{ color: 'var(--c-text)' }}>Client ID</label>
                    <input className="input" value={String(config.pathao_client_id || '')} onChange={e => setConfig(c => ({ ...c, pathao_client_id: e.target.value }))} placeholder="Client ID" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1" style={{ color: 'var(--c-text)' }}>Client Secret</label>
                    <input className="input" type="password" value={String(config.pathao_client_secret || '')} onChange={e => setConfig(c => ({ ...c, pathao_client_secret: e.target.value }))} placeholder="••••••" />
                  </div>
                </div>
              </div>

              <div style={{ borderTop: '1px solid var(--c-border-subtle)', paddingTop: 12, marginTop: 4 }}>
                <p className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--c-muted)' }}>Steadfast</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium mb-1" style={{ color: 'var(--c-text)' }}>API Key</label>
                    <input className="input" value={String(config.steadfast_api_key || '')} onChange={e => setConfig(c => ({ ...c, steadfast_api_key: e.target.value }))} placeholder="API Key" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1" style={{ color: 'var(--c-text)' }}>API Secret</label>
                    <input className="input" type="password" value={String(config.steadfast_api_secret || '')} onChange={e => setConfig(c => ({ ...c, steadfast_api_secret: e.target.value }))} placeholder="••••••" />
                  </div>
                </div>
              </div>

              <Toggle checked={Boolean(config.sundarban_enabled)} onChange={v => setConfig(c => ({ ...c, sundarban_enabled: v }))} label="সুন্দরবন Courier" sub="সুন্দরবন Courier সার্ভিস ব্যবহার করুন" />
            </div>
          </SectionCard>

          {/* BD-Specific toggles */}
          <SectionCard icon={MapPin} title="বাংলাদেশ-নির্দিষ্ট সেটিংস" subtitle="হরতাল, নামাজ, রমজান ও ঈদ কনফিগারেশন">
            <div className="space-y-3">
              <Toggle checked={Boolean(config.hartal_mode)} onChange={v => setConfig(c => ({ ...c, hartal_mode: v }))} label="হরতাল/ধর্মঘট Mode" sub="চালু করলে AI ডেলিভারি বন্ধের message দেবে" />
              {config.hartal_mode && (
                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: 'var(--c-text)' }}>হরতাল Message</label>
                  <textarea className="input h-16 resize-none text-sm" value={String(config.hartal_message || '')} onChange={e => setConfig(c => ({ ...c, hartal_message: e.target.value }))} />
                </div>
              )}

              <Toggle checked={Boolean(config.friday_offline_enabled)} onChange={v => setConfig(c => ({ ...c, friday_offline_enabled: v }))} label="শুক্রবার নামাজের সময় Offline" sub="শুক্রবার ১:০০–৩:০০ PM AI বন্ধ থাকবে" />

              <Toggle checked={Boolean(config.ramadan_mode)} onChange={v => setConfig(c => ({ ...c, ramadan_mode: v }))} label="রমজান Mode" sub="কাস্টম business hours চালু করুন" />
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

              <Toggle checked={Boolean(config.eid_greeting_enabled)} onChange={v => setConfig(c => ({ ...c, eid_greeting_enabled: v }))} label="ঈদ Greeting" sub="নির্ধারিত তারিখে সবাইকে ঈদের শুভেচ্ছা পাঠাবে" />
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

      {/* ══ TAB: Loyalty & Referral ═════════════════════════════════════════ */}
      {activeTab === 'loyalty' && (
        <div className="space-y-4">
          <SectionCard icon={Heart} title="Loyalty Points" subtitle="গ্রাহকদের কেনাকাটায় পয়েন্ট দিন">
            <Toggle checked={Boolean(config.loyalty_enabled)} onChange={v => setConfig(c => ({ ...c, loyalty_enabled: v }))} label="Loyalty Points চালু করুন" sub="প্রতিটি কেনাকাটায় পয়েন্ট অর্জন করতে পারবে" />
            {config.loyalty_enabled && (
              <div className="grid grid-cols-2 gap-4">
                <NumField label="পয়েন্ট / ১ টাকা" value={String(config.loyalty_points_per_taka ?? 1)} onChange={v => setConfig(c => ({ ...c, loyalty_points_per_taka: parseFloat(v) || 1 }))} min={0.1} step={0.1} suffix="pts" />
                <NumField label="১ পয়েন্ট = কত টাকা" value={String(config.loyalty_point_value ?? 1)} onChange={v => setConfig(c => ({ ...c, loyalty_point_value: parseFloat(v) || 1 }))} min={0.01} step={0.01} suffix="৳" />
                <NumField label="Minimum Redeem Points" value={String(config.loyalty_min_redeem ?? 100)} onChange={v => setConfig(c => ({ ...c, loyalty_min_redeem: parseInt(v) || 100 }))} min={1} suffix="pts" />
              </div>
            )}
          </SectionCard>

          <SectionCard icon={Heart} title="Referral Program" subtitle="রেফারেল করলে উভয়পক্ষ পুরস্কার পাবে">
            <Toggle checked={Boolean(config.referral_enabled)} onChange={v => setConfig(c => ({ ...c, referral_enabled: v }))} label="Referral Program চালু করুন" sub="বন্ধুকে রেফার করলে ছাড় পাবে" />
            {config.referral_enabled && (
              <div className="grid grid-cols-2 gap-4">
                <NumField label="Referee Discount (%)" value={String(config.referral_discount_pct ?? 10)} onChange={v => setConfig(c => ({ ...c, referral_discount_pct: parseFloat(v) || 10 }))} min={0} step={1} suffix="%" />
                <NumField label="Referrer Reward (%)" value={String(config.referral_reward_pct ?? 5)} onChange={v => setConfig(c => ({ ...c, referral_reward_pct: parseFloat(v) || 5 }))} min={0} step={1} suffix="%" />
              </div>
            )}
          </SectionCard>
        </div>
      )}

      {/* ══ TAB: Negotiation Rules ══════════════════════════════════════════ */}
      {activeTab === 'negotiation' && (
        <div className="space-y-4">
          <div className="card p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded flex items-center justify-center" style={{ backgroundColor: 'rgba(4,170,109,0.12)' }}>
                  <TrendingDown size={16} style={{ color: '#04AA6D' }} />
                </div>
                <div>
                  <h2 className="font-semibold text-sm" style={{ color: 'var(--c-text)' }}>পণ্য-ভিত্তিক Negotiation Rules</h2>
                  <p className="text-xs" style={{ color: 'var(--c-muted)' }}>প্রতিটি পণ্যের জন্য আলাদা দামাদামির নিয়ম</p>
                </div>
              </div>
              <button onClick={openCreateRule} className="btn-primary gap-1.5 text-xs py-1.5 px-3"><Plus size={13} /> Rule যোগ করুন</button>
            </div>

          {rulesLoading ? (
            <div className="flex justify-center py-8"><div className="spinner h-6 w-6" /></div>
          ) : rules.length === 0 ? (
            <div className="text-center py-10 rounded" style={{ backgroundColor: 'var(--c-surface)', border: '1px dashed var(--c-border)' }}>
              <TrendingDown size={32} className="mx-auto mb-2" style={{ color: 'var(--c-border)' }} />
              <p className="text-sm font-medium" style={{ color: 'var(--c-text)' }}>কোনো পণ্য-নির্দিষ্ট rule নেই</p>
            </div>
          ) : (
            <div className="overflow-hidden rounded" style={{ border: '1px solid var(--c-border)' }}>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead style={{ backgroundColor: 'var(--c-surface)', borderBottom: '1px solid var(--c-border)' }}>
                    <tr>
                      <th className="th text-left" style={{ color: 'var(--c-muted)' }}>SKU</th>
                      <th className="th text-left" style={{ color: 'var(--c-muted)' }}>পণ্য</th>
                      <th className="th text-center" style={{ color: 'var(--c-muted)' }}>ছাড়%</th>
                      <th className="th text-right" style={{ color: 'var(--c-muted)' }}>সর্বনিম্ন</th>
                      <th className="th text-center" style={{ color: 'var(--c-muted)' }}>Style</th>
                      <th className="th text-right" style={{ color: 'var(--c-muted)' }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rules.map((r, i) => {
                      const sm = STYLE_META[r.negotiation_style]
                      return (
                        <tr key={r.id} style={{ borderTop: i > 0 ? '1px solid var(--c-border-subtle)' : 'none' }}>
                          <td className="td"><code className="text-xs font-mono" style={{ color: 'var(--c-muted)' }}>{r.sku}</code></td>
                          <td className="td text-xs font-medium" style={{ color: 'var(--c-text)', maxWidth: 140 }}><span className="block truncate">{r.product_name || '—'}</span></td>
                          <td className="td text-center"><span className="font-bold text-sm" style={{ color: '#04AA6D' }}>{r.max_discount_pct}%</span></td>
                          <td className="td text-right text-xs" style={{ color: 'var(--c-muted)' }}>{r.min_price != null ? `৳${r.min_price.toLocaleString()}` : '—'}</td>
                          <td className="td text-center"><span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: sm.bg, color: sm.color }}>{sm.label}</span></td>
                          <td className="td">
                            <div className="flex items-center justify-end gap-1">
                              <button onClick={() => openEditRule(r)} className="p-1.5 rounded" style={{ color: 'var(--c-muted)' }}><Edit2 size={13} /></button>
                              <button onClick={() => handleDeleteRule(r.id)} disabled={deletingRule === r.id} className="p-1.5 rounded" style={{ color: '#EF5350' }}>
                                {deletingRule === r.id ? <span className="spinner h-3.5 w-3.5" /> : <Trash2 size={13} />}
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
        </div>
      )}

      {/* ══ TAB: Templates ══════════════════════════════════════════════════ */}
      {activeTab === 'templates' && (
        <div className="space-y-4">
          <SectionCard icon={MessageSquare} title="Message Templates" subtitle="AI এই template দিয়ে গ্রাহকদের message পাঠাবে">
            <div className="grid grid-cols-1 gap-4">
              <TemplateField label="📦 Shipping Confirmation" value={String(config.tpl_shipping_confirm || '')} onChange={v => setConfig(c => ({ ...c, tpl_shipping_confirm: v }))} placeholder="আপনার অর্ডার #{{order_id}} শিপ করা হয়েছে। Tracking: {{tracking}}..." />
              <TemplateField label="⏳ Delay Notification" value={String(config.tpl_delay_notify || '')} onChange={v => setConfig(c => ({ ...c, tpl_delay_notify: v }))} placeholder="দুঃখিত, আপনার অর্ডার {{delay_days}} দিন দেরি হবে কারণ..." />
              <TemplateField label="❌ Out of Stock Reply" value={String(config.tpl_out_of_stock || '')} onChange={v => setConfig(c => ({ ...c, tpl_out_of_stock: v }))} placeholder="দুঃখিত, {{product_name}} বর্তমানে stock নেই। Pre-order/Waitlist-এ যোগ করবেন?" />
              <TemplateField label="📫 Wrong Item Complaint" value={String(config.tpl_wrong_item || '')} onChange={v => setConfig(c => ({ ...c, tpl_wrong_item: v }))} placeholder="আমরা সমস্যাটি সমাধান করব। ছবি পাঠান, আমরা দ্রুত ব্যবস্থা নেব।" />
              <TemplateField label="⭐ Review Request" value={String(config.tpl_review_request || '')} onChange={v => setConfig(c => ({ ...c, tpl_review_request: v }))} placeholder="আপনার অর্ডার পেয়েছেন? একটু review দিলে ভালো হতো! 😊" />
              <TemplateField label="🎁 Referral Program" value={String(config.tpl_referral || '')} onChange={v => setConfig(c => ({ ...c, tpl_referral: v }))} placeholder="বন্ধুকে refer করুন, আপনি পাবেন {{discount}}% ছাড়!" />
            </div>
          </SectionCard>
        </div>
      )}

      {/* ══ TAB: Security ═══════════════════════════════════════════════════ */}
      {activeTab === 'security' && (
        <SectionCard icon={Shield} title="Security" subtitle="Bot-এর নিরাপত্তা নিয়ন্ত্রণ করুন">
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

      {/* Save button (bottom) */}
      {activeTab !== 'negotiation' && activeTab !== 'bangladesh' && (
        <button onClick={handleSave} disabled={saving} className="btn-primary px-8 py-2.5 gap-2">
          {saving ? <><span className="spinner h-4 w-4" /> সংরক্ষণ হচ্ছে...</> : <><Save size={15} /> পরিবর্তন সংরক্ষণ করুন</>}
        </button>
      )}

      {/* ── Negotiation Rule Modal ────────────────────────────────────────────── */}
      {showRuleModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/50" onClick={() => setShowRuleModal(false)} />
          <div className="relative w-full max-w-md rounded-xl shadow-2xl overflow-visible flex flex-col" style={{ backgroundColor: 'var(--c-card)', maxHeight: '90vh' }}>
            <div className="flex items-center justify-between px-5 py-4 flex-shrink-0" style={{ backgroundColor: '#282A35', borderRadius: '12px 12px 0 0' }}>
              <h2 className="font-semibold text-white text-sm">{editingRule ? '✏️ Rule সম্পাদনা' : '➕ নতুন Negotiation Rule'}</h2>
              <button onClick={() => setShowRuleModal(false)} className="text-gray-400 hover:text-white transition-colors"><X size={18} /></button>
            </div>

            <div className="p-5 space-y-4 overflow-y-auto">
              {!editingRule ? (
                <div>
                  <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--c-text)' }}>পণ্য নির্বাচন <span style={{ color: '#EF5350' }}>*</span></label>
                  <div ref={dropdownRef} className="relative">
                    <div className="relative">
                      <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--c-muted)' }} />
                      <input className="input pl-9 pr-3" placeholder="SKU বা পণ্যের নাম দিয়ে খুঁজুন..." value={productSearch}
                             onChange={e => { setProductSearch(e.target.value); setShowDropdown(true) }} onFocus={() => setShowDropdown(true)} autoComplete="off" />
                      {productSearch && <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--c-muted)' }} onClick={() => { setProductSearch(''); setRuleForm(f => ({ ...f, product_id: '', sku: '', product_name: '' })) }}><X size={13} /></button>}
                    </div>
                    {showDropdown && filteredProducts.length > 0 && (
                      <div className="absolute z-20 w-full rounded-lg shadow-xl mt-1 max-h-52 overflow-y-auto" style={{ backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)' }}>
                        {filteredProducts.map(p => (
                          <button key={p.product_id} type="button" className="w-full text-left px-3 py-2.5 text-sm transition-colors" style={{ borderBottom: '1px solid var(--c-border-subtle)' }}
                                  onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--c-surface)')}
                                  onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                                  onMouseDown={e => { e.preventDefault(); setRuleForm(f => ({ ...f, product_id: p.product_id, sku: p.sku, product_name: p.name })); setProductSearch(p.sku); setShowDropdown(false) }}>
                            <span className="font-mono text-xs" style={{ color: 'var(--c-muted)' }}>{p.sku}</span>
                            <span className="mx-2" style={{ color: 'var(--c-border)' }}>·</span>
                            <span className="font-medium" style={{ color: 'var(--c-text)' }}>{p.name}</span>
                            <span className="float-right text-xs" style={{ color: 'var(--c-muted)' }}>৳{p.mrp.toLocaleString()}</span>
                          </button>
                        ))}
                      </div>
                    )}
                    {showDropdown && productSearch && filteredProducts.length === 0 && (
                      <div className="absolute z-20 w-full rounded-lg shadow-xl mt-1 px-3 py-3 text-xs text-center" style={{ backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)', color: 'var(--c-muted)' }}>কোনো পণ্য পাওয়া যায়নি</div>
                    )}
                  </div>
                  {ruleForm.product_id && (
                    <div className="mt-2 flex items-center gap-2 px-3 py-2 rounded text-xs" style={{ backgroundColor: 'rgba(4,170,109,0.08)', border: '1px solid rgba(4,170,109,0.2)' }}>
                      <span style={{ color: '#04AA6D' }}>✓ নির্বাচিত:</span>
                      <code className="font-mono font-bold" style={{ color: 'var(--c-text)' }}>{ruleForm.sku}</code>
                      <span style={{ color: 'var(--c-muted)' }}>—</span>
                      <span style={{ color: 'var(--c-text)' }}>{ruleForm.product_name}</span>
                    </div>
                  )}
                </div>
              ) : (
                <div>
                  <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--c-text)' }}>পণ্য</label>
                  <div className="px-3 py-2.5 rounded text-sm" style={{ backgroundColor: 'var(--c-surface)', border: '1px solid var(--c-border)' }}>
                    <code className="font-mono font-bold" style={{ color: '#04AA6D' }}>{editingRule.sku}</code>
                    <span className="mx-2" style={{ color: 'var(--c-muted)' }}>—</span>
                    <span style={{ color: 'var(--c-text)' }}>{editingRule.product_name}</span>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--c-text)' }}>সর্বোচ্চ ছাড় (%) <span style={{ color: '#EF5350' }}>*</span></label>
                  <input type="number" min="0" max="90" step="0.5" className="input" placeholder="যেমন: 20" value={ruleForm.max_discount_pct} onChange={e => setRuleForm(f => ({ ...f, max_discount_pct: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--c-text)' }}>সর্বনিম্ন মূল্য (৳)</label>
                  <input type="number" min="0" step="1" className="input" placeholder="ঐচ্ছিক" value={ruleForm.min_price} onChange={e => setRuleForm(f => ({ ...f, min_price: e.target.value }))} />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--c-text)' }}>Negotiation Style</label>
                <div className="relative">
                  <select className="input appearance-none pr-8" value={ruleForm.negotiation_style} onChange={e => setRuleForm(f => ({ ...f, negotiation_style: e.target.value as RuleForm['negotiation_style'] }))}>
                    <option value="aggressive">🔴 Aggressive — কম ছাড়, দৃঢ়ভাবে</option>
                    <option value="moderate">🟡 Moderate — ভারসাম্যপূর্ণ</option>
                    <option value="soft">🟢 Soft — বেশি নমনীয়</option>
                  </select>
                  <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--c-muted)' }} />
                </div>
              </div>
            </div>

            <div className="px-5 py-4 flex justify-end gap-3 flex-shrink-0" style={{ borderTop: '1px solid var(--c-border)' }}>
              <button onClick={() => setShowRuleModal(false)} className="btn-secondary">বাতিল</button>
              <button onClick={handleSaveRule} disabled={savingRule} className="btn-primary gap-2">
                {savingRule ? <><span className="spinner h-4 w-4" /> সংরক্ষণ...</> : <><Save size={14} /> সংরক্ষণ করুন</>}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
