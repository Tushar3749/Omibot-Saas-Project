'use client'
import { useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { productImagesAPI } from '@/lib/api'
import type { ProductImage } from '@/types'
import { X, Upload, Star, Trash2, Edit2, Check, Loader2, ImagePlus, Sparkles, Image } from 'lucide-react'

interface Props {
  productId:   string
  productName: string
  onClose:     () => void
}

interface EditState {
  imageId:     string
  description: string
}

export default function ProductImageManager({ productId, productName, onClose }: Props) {
  const [images,       setImages]       = useState<ProductImage[]>([])
  const [loading,      setLoading]      = useState(true)
  const [uploading,    setUploading]    = useState(false)
  const [deletingId,   setDeletingId]   = useState<string | null>(null)
  const [settingPrimId, setSettingPrimId] = useState<string | null>(null)
  const [editState,    setEditState]    = useState<EditState | null>(null)
  const [savingDesc,   setSavingDesc]   = useState(false)

  // Upload form state
  const [description,  setDescription]  = useState('')
  const [isPrimary,    setIsPrimary]    = useState(false)
  const [autoDescribe, setAutoDescribe] = useState(false)
  const [dragOver,     setDragOver]     = useState(false)

  const fileRef = useRef<HTMLInputElement>(null)

  // ── Load ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    productImagesAPI.list(productId)
      .then(d => setImages(d))
      .catch(() => toast.error('Images লোড হয়নি'))
      .finally(() => setLoading(false))
  }, [productId])

  // Close on Escape
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  // ── Upload ────────────────────────────────────────────────────────────────
  async function handleUpload(files: FileList | null) {
    if (!files?.length) return
    const file = files[0]
    if (!file.type.startsWith('image/')) { toast.error('শুধু image file আপলোড করুন'); return }
    if (file.size > 8 * 1024 * 1024)    { toast.error('8MB-এর কম file বেছে নিন');      return }

    setUploading(true)
    try {
      const uploaded = await productImagesAPI.upload(productId, file, description, isPrimary, autoDescribe)
      setImages(prev => {
        const updated = isPrimary ? prev.map(i => ({ ...i, is_primary: false })) : [...prev]
        return [...updated, uploaded]
      })
      setDescription('')
      setIsPrimary(false)
      toast.success('✅ Image আপলোড হয়েছে!')
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      toast.error(msg || 'আপলোড ব্যর্থ হয়েছে')
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  // ── Set Primary ───────────────────────────────────────────────────────────
  async function handleSetPrimary(imageId: string) {
    setSettingPrimId(imageId)
    try {
      await productImagesAPI.setPrimary(imageId)
      setImages(prev => prev.map(i => ({ ...i, is_primary: i.image_id === imageId })))
      toast.success('Primary image সেট হয়েছে!')
    } catch {
      toast.error('Primary সেট করা যায়নি')
    } finally {
      setSettingPrimId(null)
    }
  }

  // ── Delete ────────────────────────────────────────────────────────────────
  async function handleDelete(imageId: string) {
    if (!confirm('এই image মুছে ফেলবেন?')) return
    setDeletingId(imageId)
    try {
      await productImagesAPI.delete(imageId)
      setImages(prev => {
        const remaining = prev.filter(i => i.image_id !== imageId)
        // If deleted was primary, auto-promote first remaining
        const wasP = prev.find(i => i.image_id === imageId)?.is_primary
        if (wasP && remaining.length > 0) remaining[0].is_primary = true
        return remaining
      })
      toast.success('Image মুছে ফেলা হয়েছে')
    } catch {
      toast.error('মুছতে পারা যায়নি')
    } finally {
      setDeletingId(null)
    }
  }

  // ── Update Description ────────────────────────────────────────────────────
  async function handleSaveDesc() {
    if (!editState) return
    if (!editState.description.trim()) { toast.error('Description দিন'); return }
    setSavingDesc(true)
    try {
      await productImagesAPI.updateDescription(editState.imageId, editState.description)
      setImages(prev => prev.map(i =>
        i.image_id === editState.imageId ? { ...i, image_description: editState.description } : i
      ))
      setEditState(null)
      toast.success('Description আপডেট হয়েছে!')
    } catch {
      toast.error('আপডেট ব্যর্থ')
    } finally {
      setSavingDesc(false)
    }
  }

  // ── Drag & Drop ───────────────────────────────────────────────────────────
  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    handleUpload(e.dataTransfer.files)
  }

  const primaryImg = images.find(i => i.is_primary)

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div
        className="relative w-full rounded-t-2xl sm:rounded-xl shadow-2xl flex flex-col"
        style={{
          backgroundColor: 'var(--c-card)',
          maxWidth: '780px',
          maxHeight: '92vh',
          animation: 'modalIn 0.28s cubic-bezier(0.22,1,0.36,1)',
        }}
      >
        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-5 py-4 flex-shrink-0"
             style={{ borderBottom: '1px solid var(--c-border)', background: 'linear-gradient(90deg, #282A35, #1e3530)', borderRadius: '12px 12px 0 0' }}>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center"
                 style={{ backgroundColor: 'rgba(4,170,109,0.25)' }}>
              <Image size={15} style={{ color: '#04AA6D' }} />
            </div>
            <div>
              <h2 className="font-bold text-white text-sm">Product Images</h2>
              <p className="text-xs" style={{ color: '#78909C' }}>{productName}</p>
            </div>
          </div>
          <button onClick={onClose}
                  className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors"
                  style={{ color: '#78909C' }}
                  onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.1)')}
                  onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}>
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">

          {/* ── Upload area ─────────────────────────────────────────────── */}
          <div
            className="rounded-xl border-2 border-dashed p-5 transition-all duration-200 cursor-pointer"
            style={{
              borderColor: dragOver ? '#04AA6D' : 'var(--c-border)',
              backgroundColor: dragOver ? 'rgba(4,170,109,0.05)' : 'var(--c-surface)',
            }}
            onDragOver={e => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileRef.current?.click()}
          >
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={e => handleUpload(e.target.files)}
            />
            <div className="text-center space-y-2">
              <div className="w-12 h-12 rounded-full mx-auto flex items-center justify-center"
                   style={{ backgroundColor: 'rgba(4,170,109,0.12)' }}>
                <Upload size={20} style={{ color: '#04AA6D' }} />
              </div>
              <p className="text-sm font-medium" style={{ color: 'var(--c-text)' }}>
                {uploading ? 'আপলোড হচ্ছে...' : 'ছবি drag করুন বা ক্লিক করুন'}
              </p>
              <p className="text-xs" style={{ color: 'var(--c-muted)' }}>
                JPG, PNG, WebP — সর্বোচ্চ 8MB
              </p>
            </div>
          </div>

          {/* ── Upload options ───────────────────────────────────────────── */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" onClick={e => e.stopPropagation()}>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--c-text)' }}>
                Image Description
              </label>
              <input
                className="input text-sm"
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="যেমন: কালো সিল্ক শাড়ি, সোনালি বর্ডার"
              />
            </div>
            <div className="flex flex-col gap-2">
              <label className="flex items-center gap-2 cursor-pointer p-2 rounded"
                     style={{ border: '1px solid var(--c-border)', backgroundColor: 'var(--c-surface)' }}>
                <input type="checkbox" checked={isPrimary} onChange={e => setIsPrimary(e.target.checked)}
                       className="w-4 h-4 accent-green-600" />
                <div>
                  <p className="text-xs font-medium" style={{ color: 'var(--c-text)' }}>Primary Image হিসেবে সেট করুন</p>
                  <p className="text-2xs" style={{ color: 'var(--c-muted)' }}>Customer-কে প্রথমে এটি দেখানো হবে</p>
                </div>
              </label>
              <label className="flex items-center gap-2 cursor-pointer p-2 rounded"
                     style={{ border: '1px solid var(--c-border)', backgroundColor: 'var(--c-surface)' }}>
                <input type="checkbox" checked={autoDescribe} onChange={e => setAutoDescribe(e.target.checked)}
                       className="w-4 h-4 accent-purple-600" />
                <div className="flex items-center gap-1">
                  <Sparkles size={11} style={{ color: '#7B1FA2' }} />
                  <p className="text-xs font-medium" style={{ color: 'var(--c-text)' }}>AI দিয়ে Description তৈরি</p>
                </div>
              </label>
            </div>
          </div>

          {/* Upload button */}
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="btn-primary w-full gap-2"
          >
            {uploading
              ? <><Loader2 size={15} className="animate-spin" /> আপলোড হচ্ছে...</>
              : <><ImagePlus size={15} /> Image আপলোড করুন</>
            }
          </button>

          {/* ── Image Grid ──────────────────────────────────────────────── */}
          {loading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {[1,2,3].map(i => <div key={i} className="skeleton rounded-xl aspect-square" />)}
            </div>
          ) : images.length === 0 ? (
            <div className="text-center py-10 rounded-xl"
                 style={{ border: '1px dashed var(--c-border)', backgroundColor: 'var(--c-surface)' }}>
              <ImagePlus size={36} className="mx-auto mb-2 empty-icon" style={{ color: 'var(--c-muted)' }} />
              <p className="text-sm font-medium" style={{ color: 'var(--c-text)' }}>এখনো কোনো image নেই</p>
              <p className="text-xs mt-1" style={{ color: 'var(--c-muted)' }}>উপরের upload area থেকে যোগ করুন</p>
            </div>
          ) : (
            <div>
              <p className="text-xs font-medium mb-3 flex items-center gap-1.5" style={{ color: 'var(--c-text)' }}>
                <Image size={12} />
                {images.length}টি Image
                {primaryImg && (
                  <span className="ml-auto flex items-center gap-1 text-yellow-600">
                    <Star size={11} fill="currentColor" /> Primary সেট আছে
                  </span>
                )}
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {images.map((img, idx) => (
                  <div
                    key={img.image_id}
                    className="rounded-xl overflow-hidden"
                    style={{
                      border: img.is_primary ? '2px solid #04AA6D' : '1px solid var(--c-border)',
                      animation: `floatUp 0.3s ease-out ${idx * 60}ms both`,
                      backgroundColor: 'var(--c-surface)',
                    }}
                  >
                    {/* Image */}
                    <div className="relative aspect-square bg-gray-100 overflow-hidden">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={img.image_url}
                        alt={img.image_description || productName}
                        className="w-full h-full object-cover transition-transform duration-300 hover:scale-105"
                        loading="lazy"
                      />
                      {img.is_primary && (
                        <div className="absolute top-1.5 left-1.5 flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs font-bold"
                             style={{ backgroundColor: '#04AA6D', color: 'white' }}>
                          <Star size={9} fill="white" /> Primary
                        </div>
                      )}
                    </div>

                    {/* Description + actions */}
                    <div className="p-2.5 space-y-2">
                      {editState?.imageId === img.image_id ? (
                        <div className="space-y-1.5" onClick={e => e.stopPropagation()}>
                          <textarea
                            className="input text-xs resize-none h-16"
                            value={editState.description}
                            onChange={e => setEditState({ ...editState, description: e.target.value })}
                            autoFocus
                          />
                          <div className="flex gap-1">
                            <button onClick={handleSaveDesc} disabled={savingDesc}
                                    className="btn-primary text-xs py-1 px-2 flex-1 gap-1">
                              {savingDesc ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
                              Save
                            </button>
                            <button onClick={() => setEditState(null)}
                                    className="btn-secondary text-xs py-1 px-2">
                              <X size={11} />
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <p className="text-xs line-clamp-2 min-h-[32px]"
                             style={{ color: img.image_description ? 'var(--c-text)' : 'var(--c-muted)' }}>
                            {img.image_description || 'কোনো description নেই'}
                          </p>
                          <div className="flex gap-1">
                            {/* Edit description */}
                            <button
                              onClick={() => setEditState({ imageId: img.image_id, description: img.image_description || '' })}
                              className="flex-1 flex items-center justify-center gap-1 py-1 rounded text-xs transition-colors"
                              style={{ border: '1px solid var(--c-border)', color: 'var(--c-muted)' }}
                              onMouseEnter={e => (e.currentTarget.style.borderColor = '#04AA6D')}
                              onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--c-border)')}
                              title="Description সম্পাদনা"
                            >
                              <Edit2 size={10} /> Edit
                            </button>
                            {/* Set primary */}
                            {!img.is_primary && (
                              <button
                                onClick={() => handleSetPrimary(img.image_id)}
                                disabled={settingPrimId === img.image_id}
                                className="flex items-center justify-center py-1 px-1.5 rounded text-xs transition-colors"
                                style={{ border: '1px solid #FDD835', color: '#F57F17', backgroundColor: '#FFF8E1' }}
                                title="Primary হিসেবে সেট করুন"
                              >
                                {settingPrimId === img.image_id
                                  ? <Loader2 size={10} className="animate-spin" />
                                  : <Star size={10} />
                                }
                              </button>
                            )}
                            {/* Delete */}
                            <button
                              onClick={() => handleDelete(img.image_id)}
                              disabled={deletingId === img.image_id}
                              className="flex items-center justify-center py-1 px-1.5 rounded text-xs transition-colors"
                              style={{ border: '1px solid #FFCDD2', color: '#C62828', backgroundColor: '#FFEBEE' }}
                              title="মুছে ফেলুন"
                            >
                              {deletingId === img.image_id
                                ? <Loader2 size={10} className="animate-spin" />
                                : <Trash2 size={10} />
                              }
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 flex-shrink-0 flex items-center justify-between"
             style={{ borderTop: '1px solid var(--c-border)', backgroundColor: 'var(--c-surface)' }}>
          <p className="text-xs" style={{ color: 'var(--c-muted)' }}>
            {images.length} image · Primary image AI search-এ ব্যবহৃত হয়
          </p>
          <button onClick={onClose} className="btn-secondary text-sm">বন্ধ করুন</button>
        </div>
      </div>
    </div>
  )
}
