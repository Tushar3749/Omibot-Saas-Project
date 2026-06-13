'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { policyAPI } from '@/lib/api'
import { Upload, FileText, Trash2, FileCheck, Loader2 } from 'lucide-react'

interface PolicyDoc {
  file_name: string
  file_type: string
  file_size: number
  content_type: string
  chunk_count: number
  created_at: string
  first_id: string
}

const TYPE_LABEL: Record<string, string> = {
  return_policy:   'রিটার্ন নীতিমালা',
  discount_policy: 'ছাড় নীতিমালা',
  delivery_policy: 'ডেলিভারি নীতিমালা',
  order_policy:    'অর্ডার নীতিমালা',
  policy:          'নীতিমালা',
}

function fmtSize(bytes: number): string {
  if (!bytes) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export default function PolicyDocs({ contentType }: { contentType: string }) {
  const [docs,      setDocs]      = useState<PolicyDoc[]>([])
  const [loading,   setLoading]   = useState(true)
  const [uploading, setUploading] = useState(false)
  const [dragging,  setDragging]  = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  async function load() {
    setLoading(true)
    try {
      const data = await policyAPI.list(contentType)
      setDocs(data as PolicyDoc[])
    } catch {
      toast.error('ডকুমেন্ট লোড করা যায়নি')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [contentType]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleUpload(file: File) {
    const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
    if (!['pdf', 'docx', 'doc', 'txt', 'md'].includes(ext)) {
      toast.error('শুধু PDF, DOCX, TXT, বা MD ফাইল আপলোড করা যাবে')
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error('ফাইলের আকার সর্বোচ্চ 10 MB')
      return
    }
    setUploading(true)
    try {
      await policyAPI.upload(file, contentType)
      toast.success(`"${file.name}" আপলোড সম্পন্ন`)
      load()
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      toast.error(msg || 'আপলোড ব্যর্থ হয়েছে')
    } finally {
      setUploading(false)
    }
  }

  async function handleDelete(fileName: string) {
    if (!confirm(`"${fileName}" মুছে ফেলবেন?`)) return
    try {
      await policyAPI.deleteFile(fileName)
      setDocs(ds => ds.filter(d => d.file_name !== fileName))
      toast.success('ডকুমেন্ট মুছে ফেলা হয়েছে')
    } catch {
      toast.error('মুছতে পারা যায়নি')
    }
  }

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleUpload(file)
  }, [contentType]) // eslint-disable-line react-hooks/exhaustive-deps

  const label = TYPE_LABEL[contentType] || 'নীতিমালা ডকুমেন্ট'

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-semibold" style={{ color: 'var(--c-text)' }}>{label}</h3>
        <p className="text-xs mt-0.5" style={{ color: 'var(--c-muted)' }}>
          PDF, DOCX, বা TXT ফাইল আপলোড করুন। Bot RAG ব্যবহার করে এই ডকুমেন্ট থেকে গ্রাহকের প্রশ্নের উত্তর দেবে।
        </p>
      </div>

      {/* Drop zone */}
      <div
        onDragOver={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => !uploading && fileRef.current?.click()}
        className="border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all select-none"
        style={{
          borderColor: dragging ? '#04AA6D' : 'var(--c-border)',
          backgroundColor: dragging ? 'rgba(4,170,109,0.04)' : 'var(--c-surface)',
        }}
      >
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.docx,.doc,.txt,.md"
          className="hidden"
          onChange={e => {
            const f = e.target.files?.[0]
            if (f) handleUpload(f)
            e.target.value = ''
          }}
        />
        {uploading ? (
          <div className="flex flex-col items-center gap-2">
            <Loader2 size={28} className="animate-spin" style={{ color: '#04AA6D' }} />
            <p className="text-sm" style={{ color: 'var(--c-muted)' }}>আপলোড ও Embedding হচ্ছে...</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <Upload size={28} style={{ color: dragging ? '#04AA6D' : 'var(--c-muted)' }} />
            <p className="text-sm font-medium" style={{ color: 'var(--c-text)' }}>
              ফাইল এখানে টেনে আনুন অথবা ক্লিক করুন
            </p>
            <p className="text-xs" style={{ color: 'var(--c-muted)' }}>
              PDF · DOCX · TXT · MD — সর্বোচ্চ 10 MB
            </p>
          </div>
        )}
      </div>

      {/* File list */}
      {loading ? (
        <div className="flex justify-center py-6">
          <div className="spinner h-6 w-6" />
        </div>
      ) : docs.length === 0 ? (
        <div className="rounded-xl p-8 text-center" style={{ backgroundColor: 'var(--c-surface)', border: '1px solid var(--c-border)' }}>
          <FileText size={32} className="mx-auto mb-2" style={{ color: 'var(--c-border)' }} />
          <p className="text-sm font-medium" style={{ color: 'var(--c-text)' }}>কোনো ডকুমেন্ট আপলোড করা হয়নি</p>
          <p className="text-xs mt-1" style={{ color: 'var(--c-muted)' }}>
            উপরে ফাইল drag-and-drop করুন বা ক্লিক করে আপলোড করুন
          </p>
        </div>
      ) : (
        <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--c-border)' }}>
          {docs.map((doc, i) => (
            <div
              key={doc.file_name}
              className="flex items-center gap-3 px-4 py-3"
              style={{
                borderTop: i > 0 ? '1px solid var(--c-border)' : 'none',
                backgroundColor: 'var(--c-card)',
              }}
            >
              <FileCheck size={16} style={{ color: '#04AA6D', flexShrink: 0 }} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate" style={{ color: 'var(--c-text)' }}>
                  {doc.file_name}
                </p>
                <p className="text-xs" style={{ color: 'var(--c-muted)' }}>
                  {fmtSize(doc.file_size)} · {doc.chunk_count} chunk
                  · {new Date(doc.created_at).toLocaleDateString('bn-BD')}
                </p>
              </div>
              <button
                onClick={() => handleDelete(doc.file_name)}
                className="p-1.5 rounded transition-colors hover:bg-red-50"
                style={{ color: 'var(--c-muted)' }}
                title="মুছুন"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      <p className="text-xs" style={{ color: 'var(--c-muted)' }}>
        একই নামের ফাইল আবার আপলোড করলে পুরনো version replace হবে।
      </p>
    </div>
  )
}
