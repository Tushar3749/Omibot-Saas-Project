'use client'
import { useState } from 'react'
import { ChevronDown, ChevronUp, FileText } from 'lucide-react'

// ─── Type definitions ────────────────────────────────────────────────────────

type ColumnGuide = {
  name_en: string
  name_bn: string
  required: boolean
  description: string
  example: string
}

export type CsvGuideType = 'products' | 'stock' | 'combo'

// ─── Guide definitions ────────────────────────────────────────────────────────

const GUIDES: Record<CsvGuideType, { title: string; note?: string; columns: ColumnGuide[] }> = {
  products: {
    title: 'পণ্য আমদানি — Products Import',
    note: 'বিদ্যমান SKU → আপডেট হবে। নতুন SKU → নতুন পণ্য তৈরি হবে।',
    columns: [
      { name_en: 'sku',       name_bn: 'SKU',             required: true,  description: 'পণ্যের অনন্য পরিচয় কোড। একবার সেট করলে পরিবর্তন করবেন না।', example: 'SHIRT-001' },
      { name_en: 'name',      name_bn: 'পণ্যের নাম',      required: true,  description: 'পণ্যের সম্পূর্ণ নাম',                                           example: 'কটন শার্ট সাদা' },
      { name_en: 'mrp',       name_bn: 'সর্বোচ্চ মূল্য',  required: true,  description: 'সর্বোচ্চ খুচরা মূল্য — টাকায় সংখ্যা',                         example: '500' },
      { name_en: 'stock',     name_bn: 'প্রারম্ভিক স্টক', required: false, description: 'প্রারম্ভিক মজুদ সংখ্যা (stock table-এ সংরক্ষিত)',               example: '100' },
      { name_en: 'category',  name_bn: 'ক্যাটাগরি',       required: false, description: 'পণ্যের শ্রেণী বা গ্রুপ',                                        example: 'পোশাক' },
      { name_en: 'image_url', name_bn: 'ছবির লিংক',       required: false, description: 'পণ্যের ছবির সম্পূর্ণ URL (https://...)',                         example: 'https://example.com/img.jpg' },
    ],
  },
  stock: {
    title: 'স্টক আপডেট — Stock Update',
    note: 'শুধুমাত্র বিদ্যমান SKU-এর স্টক আপডেট করে। নতুন পণ্য তৈরি করে না।',
    columns: [
      { name_en: 'sku',   name_bn: 'SKU',          required: true, description: 'পণ্যের অনন্য কোড — সিস্টেমে আগে থেকে থাকতে হবে', example: 'SHIRT-001' },
      { name_en: 'stock', name_bn: 'নতুন স্টক',    required: true, description: 'নতুন মজুদ সংখ্যা। পুরনো মানটি সম্পূর্ণ replace হবে।',   example: '75' },
    ],
  },
  combo: {
    title: 'কম্বো অফার — Combo Import',
    note: 'পণ্যের SKU গুলো পাইপ (|) দিয়ে আলাদা করতে হবে।',
    columns: [
      { name_en: 'name',         name_bn: 'কম্বো নাম',        required: true,  description: 'কম্বো অফারের শিরোনাম',                          example: 'গ্রীষ্মের প্যাকেজ' },
      { name_en: 'combo_price',  name_bn: 'কম্বো মূল্য',      required: true,  description: 'পুরো কম্বোর বিক্রয় মূল্য — টাকায়',             example: '800' },
      { name_en: 'product_skus', name_bn: 'পণ্য SKU তালিকা',  required: true,  description: 'পাইপ চিহ্ন (|) দিয়ে আলাদা করা পণ্যের SKU তালিকা', example: 'SHIRT-001|PANT-002' },
      { name_en: 'description',  name_bn: 'বিবরণ',             required: false, description: 'কম্বোর সংক্ষিপ্ত বিবরণ',                        example: 'সেরা সমন্বয়' },
      { name_en: 'stock',        name_bn: 'স্টক পরিমাণ',      required: false, description: 'কম্বো মজুদ সংখ্যা',                              example: '50' },
    ],
  },
}

// ─── Component ────────────────────────────────────────────────────────────────

interface CsvGuideProps {
  type: CsvGuideType
  defaultOpen?: boolean
}

export default function CsvGuide({ type, defaultOpen = false }: CsvGuideProps) {
  const [open, setOpen] = useState(defaultOpen)
  const guide = GUIDES[type]
  if (!guide) return null

  return (
    <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--c-border)' }}>
      {/* Header (toggle) */}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-left transition-colors"
        style={{ backgroundColor: open ? 'var(--c-border-subtle)' : 'var(--c-surface)' }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <FileText size={13} style={{ color: '#04AA6D', flexShrink: 0 }} />
          <span className="text-xs font-semibold" style={{ color: 'var(--c-text)', flexShrink: 0 }}>
            📋 CSV গাইড
          </span>
          <span className="text-xs truncate" style={{ color: 'var(--c-muted)' }}>
            — {guide.title}
          </span>
        </div>
        {open
          ? <ChevronUp  size={13} style={{ color: 'var(--c-muted)', flexShrink: 0 }} />
          : <ChevronDown size={13} style={{ color: 'var(--c-muted)', flexShrink: 0 }} />
        }
      </button>

      {/* Expanded content */}
      {open && (
        <>
          {/* Note */}
          {guide.note && (
            <div className="px-4 py-2 text-xs"
                 style={{
                   backgroundColor: 'rgba(4,170,109,0.08)',
                   borderTop: '1px solid var(--c-border)',
                   color: '#2E7D32',
                 }}>
              ℹ️ {guide.note}
            </div>
          )}

          {/* Column table */}
          <div className="overflow-x-auto" style={{ borderTop: '1px solid var(--c-border)' }}>
            <table className="w-full">
              <thead>
                <tr style={{ backgroundColor: 'var(--c-surface)' }}>
                  {(['কলাম (Column)', 'আবশ্যক?', 'বিবরণ', 'উদাহরণ মান'] as const).map(h => (
                    <th
                      key={h}
                      className="px-3 py-2 text-left font-semibold whitespace-nowrap"
                      style={{
                        fontSize: 10,
                        color: 'var(--c-muted)',
                        borderBottom: '1px solid var(--c-border)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {guide.columns.map((col, i) => (
                  <tr
                    key={col.name_en}
                    style={{ borderTop: i > 0 ? '1px solid var(--c-border-subtle)' : 'none' }}
                  >
                    {/* Column name */}
                    <td className="px-3 py-2 whitespace-nowrap">
                      <code className="text-xs font-mono font-bold" style={{ color: 'var(--c-text)' }}>
                        {col.name_en}
                      </code>
                      <span className="block text-xs mt-0.5" style={{ color: 'var(--c-muted)', fontSize: 10 }}>
                        {col.name_bn}
                      </span>
                    </td>

                    {/* Required badge */}
                    <td className="px-3 py-2 text-center">
                      {col.required ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full font-semibold whitespace-nowrap"
                              style={{ fontSize: 10, backgroundColor: '#FFEBEE', color: '#C62828' }}>
                          ✱ আবশ্যক
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full whitespace-nowrap"
                              style={{ fontSize: 10, backgroundColor: '#E8F5E9', color: '#2E7D32' }}>
                          ঐচ্ছিক
                        </span>
                      )}
                    </td>

                    {/* Description */}
                    <td className="px-3 py-2 text-xs" style={{ color: 'var(--c-text-2)' }}>
                      {col.description}
                    </td>

                    {/* Example */}
                    <td className="px-3 py-2 whitespace-nowrap">
                      <code
                        className="text-xs font-mono px-2 py-0.5 rounded"
                        style={{
                          backgroundColor: 'rgba(4,170,109,0.08)',
                          color: '#04AA6D',
                          border: '1px solid rgba(4,170,109,0.2)',
                        }}
                      >
                        {col.example}
                      </code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
