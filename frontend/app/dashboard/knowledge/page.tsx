'use client'
import { useEffect, useState, useRef } from 'react'
import toast from 'react-hot-toast'
import { knowledgeAPI } from '@/lib/api'
import { BookOpen, Upload, Trash2, FileText, FileType, File as FileIcon } from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────
interface KnowledgeEntry {
  file_name: string | null
  file_type: string | null
  file_size: number | null
  content_type: string
  chunk_count: number
  created_at: string
  first_id?: string
  // for ungrouped entries
  id?: string
}

const CONTENT_TYPES = [
  { value: 'policy',        label: 'সাধারণ Policy' },
  { value: 'return_policy', label: 'ফেরত নীতি' },
  { value: 'bonus_policy',  label: 'বোনাস নীতি' },
  { value: 'company_desc',  label: 'কোম্পানি পরিচয়' },
  { value: 'faq',           label: 'FAQ' },
]

function contentTypeLabel(ct: string) {
  return CONTENT_TYPES.find(t => t.value === ct)?.label || ct
}

function formatBytes(bytes: number | null) {
  if (!bytes) return '—'
  if (bytes < 1024)      return `${bytes} B`
  if (bytes < 1024*1024) return `${(bytes/1024).toFixed(1)} KB`
  return `${(bytes/1024/1024).toFixed(2)} MB`
}

function FileTypeIcon({ type }: { type: string | null }) {
  if (!type) return <FileIcon size={20} style={{ color: '#9E9E9E' }} />
  if (type === 'pdf')  return <FileType size={20} style={{ color: '#EF5350' }} />
  if (type === 'docx' || type === 'doc') return <FileText size={20} style={{ color: '#1565C0' }} />
  return <FileText size={20} style={{ color: '#9E9E9E' }} />
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function KnowledgePage() {
  const [docs, setDocs]         = useState<KnowledgeEntry[]>([])
  const [loading, setLoading]   = useState(true)
  const [uploading, setUploading] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [contentType, setContentType] = useState('policy')
  const fileRef = useRef<HTMLInputElement>(null)
  const dragRef = useRef<HTMLDivElement>(null)

  async function load() {
    try {
      const data = await knowledgeAPI.list()
      setDocs(data)
    } catch {
      toast.error('Knowledge base লোড করা যায়নি')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  // ── Upload ────────────────────────────────────────────────────────────────
  async function handleUpload(files: FileList | null) {
    if (!files || files.length === 0) return
    const file = files[0]
    setUploading(true)
    try {
      const result = await knowledgeAPI.upload(file, contentType) as {
        file_name: string; chunks: number; errors: number; file_size: number
      }
      toast.success(`"${result.file_name}" upload হয়েছে (${result.chunks} টি chunk)`)
      await load()
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      toast.error(msg || 'Upload ব্যর্থ হয়েছে')
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  // ── Delete ────────────────────────────────────────────────────────────────
  async function handleDelete(entry: KnowledgeEntry) {
    const label = entry.file_name || 'এই document'
    if (!confirm(`"${label}" মুছে ফেলবেন?`)) return
    const key = entry.file_name || entry.id!
    setDeleting(key)
    try {
      if (entry.file_name) {
        await knowledgeAPI.deleteFile(entry.file_name)
      } else if (entry.id) {
        await knowledgeAPI.deleteDoc(entry.id)
      }
      toast.success('মুছে ফেলা হয়েছে')
      await load()
    } catch {
      toast.error('মুছতে পারা যায়নি')
    } finally {
      setDeleting(null)
    }
  }

  // ── Drag & drop ────────────────────────────────────────────────────────────
  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    handleUpload(e.dataTransfer.files)
  }

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-3xl space-y-5">

      {/* Header */}
      <div>
        <h1 className="page-title flex items-center gap-2">
          <BookOpen size={22} style={{ color: '#04AA6D' }} />
          Knowledge Base
        </h1>
        <p className="page-subtitle">AI-এর জ্ঞানভাণ্ডারে নথি যোগ করুন — PDF, DOCX, TXT সমর্থিত</p>
      </div>

      {/* Upload zone */}
      <div className="card p-5 space-y-4">
        <h2 className="font-semibold text-sm" style={{ color: '#282A35' }}>নতুন দলিল আপলোড</h2>

        {/* Content type selector */}
        <div>
          <label className="block text-sm font-medium mb-1.5" style={{ color: '#282A35' }}>দলিলের ধরন</label>
          <select
            className="input max-w-xs"
            value={contentType}
            onChange={e => setContentType(e.target.value)}
          >
            {CONTENT_TYPES.map(t => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>

        {/* Drop zone */}
        <div
          ref={dragRef}
          onDragOver={e => e.preventDefault()}
          onDrop={onDrop}
          onClick={() => !uploading && fileRef.current?.click()}
          className="border-2 border-dashed rounded-lg p-10 text-center cursor-pointer transition-colors"
          style={{ borderColor: '#C8E6C9', backgroundColor: uploading ? '#F9F9F9' : '#F1FFF5' }}
        >
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.docx,.doc,.txt,.md"
            className="hidden"
            onChange={e => handleUpload(e.target.files)}
          />
          {uploading ? (
            <div className="flex flex-col items-center gap-2">
              <span className="spinner h-8 w-8" />
              <p className="text-sm font-medium" style={{ color: '#04AA6D' }}>আপলোড ও এমবেড হচ্ছে...</p>
              <p className="text-xs" style={{ color: '#9E9E9E' }}>বড় ফাইলে একটু সময় লাগতে পারে</p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <Upload size={36} style={{ color: '#A5D6A7' }} />
              <p className="text-sm font-medium" style={{ color: '#282A35' }}>
                ফাইল এখানে টেনে আনুন বা ক্লিক করুন
              </p>
              <p className="text-xs" style={{ color: '#9E9E9E' }}>PDF, DOCX, DOC, TXT, MD — সর্বোচ্চ 10 MB</p>
            </div>
          )}
        </div>
      </div>

      {/* Doc list */}
      <div className="card overflow-hidden">
        <div className="px-5 py-4" style={{ borderBottom: '1px solid #E0E0E0' }}>
          <h2 className="font-semibold text-sm" style={{ color: '#282A35' }}>আপলোড করা দলিল</h2>
        </div>

        {loading ? (
          <div className="flex justify-center py-12"><div className="spinner h-8 w-8" /></div>
        ) : docs.length === 0 ? (
          <div className="py-12 text-center">
            <BookOpen size={36} className="mx-auto mb-3" style={{ color: '#E0E0E0' }} />
            <p className="text-sm" style={{ color: '#9E9E9E' }}>কোনো দলিল নেই। প্রথম দলিল আপলোড করুন।</p>
          </div>
        ) : (
          <ul>
            {docs.map((entry, i) => {
              const key = entry.file_name || entry.id || String(i)
              const isDel = deleting === (entry.file_name || entry.id)
              return (
                <li
                  key={key}
                  className="flex items-center gap-4 px-5 py-3.5"
                  style={{ borderTop: i > 0 ? '1px solid #F0F0F0' : 'none' }}
                >
                  <FileTypeIcon type={entry.file_type} />

                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate" style={{ color: '#282A35' }}>
                      {entry.file_name || '(plain text)'}
                    </p>
                    <div className="flex items-center gap-3 mt-0.5">
                      <span className="text-xs px-1.5 py-0.5 rounded"
                            style={{ backgroundColor: '#E8F5E9', color: '#2E7D32' }}>
                        {contentTypeLabel(entry.content_type)}
                      </span>
                      <span className="text-xs" style={{ color: '#9E9E9E' }}>
                        {entry.chunk_count} chunk{entry.chunk_count !== 1 ? 's' : ''}
                      </span>
                      <span className="text-xs" style={{ color: '#9E9E9E' }}>
                        {formatBytes(entry.file_size)}
                      </span>
                      <span className="text-xs" style={{ color: '#BDBDBD' }}>
                        {new Date(entry.created_at).toLocaleDateString('bn-BD')}
                      </span>
                    </div>
                  </div>

                  <button
                    onClick={() => handleDelete(entry)}
                    disabled={isDel}
                    className="p-2 rounded hover:bg-red-50 transition-colors flex-shrink-0"
                    style={{ color: '#EF5350' }}
                  >
                    {isDel ? <span className="spinner h-4 w-4" /> : <Trash2 size={15} />}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {/* Info box */}
      <div className="text-xs p-4 rounded" style={{ backgroundColor: '#E3F2FD', color: '#1565C0', border: '1px solid #BBDEFB' }}>
        <strong>কীভাবে কাজ করে?</strong> আপলোড করা প্রতিটি দলিল ছোট ছোট অংশে বিভক্ত হয়ে AI-এর memory-তে সংরক্ষিত হয়।
        কোনো গ্রাহক প্রশ্ন করলে AI স্বয়ংক্রিয়ভাবে প্রাসঙ্গিক তথ্য খুঁজে উত্তর দেয়।
        একই নামের ফাইল পুনরায় আপলোড করলে পুরানো তথ্য replace হয়।
      </div>
    </div>
  )
}
