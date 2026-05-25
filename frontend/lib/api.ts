/**
 * OmniBot SaaS — Typed API client
 * Wraps every backend endpoint with a typed function.
 * Reads the JWT from localStorage and attaches it to every request.
 */
import axios, { AxiosInstance } from 'axios'
import type { CSVImportType, CSVImportResult } from '@/types'

const BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

// ── Axios instance ────────────────────────────────────────────────────────────
const api: AxiosInstance = axios.create({ baseURL: BASE_URL })

// Attach JWT on every request
api.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('omnibot_token')
    if (token) config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// Auto-logout on 401; redirect to subscription on 402
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (typeof window !== 'undefined') {
      if (err.response?.status === 401) {
        localStorage.removeItem('omnibot_token')
        localStorage.removeItem('omnibot_tenant')
        window.location.href = '/login'
      } else if (err.response?.status === 402) {
        window.location.href = '/dashboard/subscription?expired=true'
      }
    }
    return Promise.reject(err)
  }
)

// ── Auth ─────────────────────────────────────────────────────────────────────
export const authAPI = {
  register: (data: { email: string; password: string; business_name: string }) =>
    api.post('/api/auth/register', data).then(r => r.data),

  login: (data: { email: string; password: string }) =>
    api.post('/api/auth/login', data).then(r => r.data),

  me: () => api.get('/api/auth/me').then(r => r.data),

  forgotPassword: (email: string) =>
    api.post('/api/auth/forgot-password', { email }).then(r => r.data),

  resetPassword: (token: string, new_password: string) =>
    api.post('/api/auth/reset-password', { token, new_password }).then(r => r.data),
}

// ── AI Config ────────────────────────────────────────────────────────────────
export const configAPI = {
  get:    () => api.get('/api/payment/ai-config').then(r => r.data),
  update: (data: Record<string, unknown>) =>
    api.patch('/api/payment/ai-config', data).then(r => r.data),
}

// ── Products ─────────────────────────────────────────────────────────────────
export const productsAPI = {
  // ── CRUD ──────────────────────────────────────────────────────────────────
  list:   () => api.get('/api/products/').then(r => r.data),
  get:    (id: string) => api.get(`/api/products/${id}`).then(r => r.data),
  create: (data: Record<string, unknown>) =>
    api.post('/api/products/', data).then(r => r.data),
  update: (id: string, data: Record<string, unknown>) =>
    api.patch(`/api/products/${id}`, data).then(r => r.data),
  delete: (id: string) => api.delete(`/api/products/${id}`).then(r => r.data),

  // ── CSV Import ────────────────────────────────────────────────────────────
  /**
   * Upload a CSV file for bulk import.
   * importType: 'products' | 'stock' | 'campaign'
   */
  importCSV: (file: File, importType: CSVImportType = 'products'): Promise<CSVImportResult> => {
    const formData = new FormData()
    formData.append('file', file)
    formData.append('import_type', importType)
    return api.post('/api/products/import/csv', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then(r => r.data)
  },

  /** Last 10 import audit log entries */
  importHistory: () => api.get('/api/products/import/history').then(r => r.data),

  // ── CSV Template download (authenticated, streams file) ───────────────────
  /**
   * Downloads a CSV template file.
   * Uses axios so the auth header is sent, then triggers a browser download.
   */
  downloadTemplate: async (templateType: CSVImportType): Promise<void> => {
    const response = await api.get(`/api/products/templates/${templateType}`, {
      responseType: 'blob',
    })
    const blob = new Blob([response.data], { type: 'text/csv' })
    const url  = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href  = url
    link.download = `${templateType}-template.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    window.URL.revokeObjectURL(url)
  },

  // ── Custom Columns ────────────────────────────────────────────────────────
  customColumns: {
    list: () => api.get('/api/products/custom-columns').then(r => r.data),
    create: (data: {
      column_name: string
      display_name: string
      column_type: string
      is_required?: boolean
      sort_order?: number
    }) => api.post('/api/products/custom-columns', data).then(r => r.data),
    delete: (columnName: string) =>
      api.delete(`/api/products/custom-columns/${columnName}`).then(r => r.data),
  },
}

// ── Conversations ─────────────────────────────────────────────────────────────
export const conversationsAPI = {
  list:        () => api.get('/api/conversations/').then(r => r.data),
  get:         (id: string) => api.get(`/api/conversations/${id}`).then(r => r.data),
  messages:    (id: string) => api.get(`/api/conversations/${id}/messages`).then(r => r.data),
  takeover:    (id: string, is_ai_active: boolean) =>
    api.patch(`/api/conversations/${id}/takeover`, { is_ai_active }).then(r => r.data),
  // Alias used in conversations page
  toggleAI:    (id: string, is_ai_active: boolean) =>
    api.patch(`/api/conversations/${id}/takeover`, { is_ai_active }).then(r => r.data),
}

// ── Orders ────────────────────────────────────────────────────────────────────
export const ordersAPI = {
  list:         (status?: string) =>
    api.get('/api/orders/', { params: status ? { status } : {} }).then(r => r.data),
  get:          (id: string) => api.get(`/api/orders/${id}`).then(r => r.data),
  updateStatus: (id: string, status: string) =>
    api.patch(`/api/orders/${id}/status`, { status }).then(r => r.data),
}

// ── Analytics ─────────────────────────────────────────────────────────────────
export const analyticsAPI = {
  overview: () => api.get('/api/analytics/overview').then(r => r.data),
  daily:    (days = 30) =>
    api.get('/api/analytics/daily', { params: { days } }).then(r => r.data),
}

// ── Channels ──────────────────────────────────────────────────────────────────
export const channelsAPI = {
  list:       () => api.get('/api/channels/').then(r => r.data),
  connect:    (data: Record<string, unknown>) =>
    api.post('/api/channels/connect', data).then(r => r.data),
  disconnect: (pageId: string) =>
    api.delete(`/api/channels/${pageId}`).then(r => r.data),
  oauthUrl:   () =>
    api.get('/api/channels/facebook/oauth-url').then(r => r.data),
}

// ── Payment ───────────────────────────────────────────────────────────────────
export const paymentAPI = {
  plans:    () => api.get('/api/payment/plans').then(r => r.data),
  initiate: (data: Record<string, unknown>) =>
    api.post('/api/payment/initiate', data).then(r => r.data),
  history:  () => api.get('/api/payment/history').then(r => r.data),
}

// ── Campaigns ─────────────────────────────────────────────────────────────────
export const campaignsAPI = {
  list:   () => api.get('/api/campaigns/').then(r => r.data),
  create: (data: Record<string, unknown>) =>
    api.post('/api/campaigns/', data).then(r => r.data),
  update: (id: string, data: Record<string, unknown>) =>
    api.patch(`/api/campaigns/${id}`, data).then(r => r.data),
  delete: (id: string) => api.delete(`/api/campaigns/${id}`).then(r => r.data),
  importCSV: (file: File): Promise<{ imported: number; errors: number; warnings: unknown[] }> => {
    const formData = new FormData()
    formData.append('file', file)
    return api.post('/api/campaigns/import/csv', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then(r => r.data)
  },
}

// ── Knowledge Base ────────────────────────────────────────────────────────────
export const knowledgeAPI = {
  list:   () => api.get('/api/knowledge/').then(r => r.data),
  upload: (file: File, contentType: string): Promise<Record<string, unknown>> => {
    const formData = new FormData()
    formData.append('file', file)
    formData.append('content_type', contentType)
    return api.post('/api/knowledge/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then(r => r.data)
  },
  addText: (data: { content: string; content_type: string; metadata?: Record<string, unknown> }) =>
    api.post('/api/knowledge/text', data).then(r => r.data),
  deleteFile: (fileName: string) =>
    api.delete(`/api/knowledge/file/${encodeURIComponent(fileName)}`).then(r => r.data),
  deleteDoc: (docId: string) =>
    api.delete(`/api/knowledge/${docId}`).then(r => r.data),
}

// ── Test Bot ─────────────────────────────────────────────────────────────────
export const testBotAPI = {
  chat: (message: string): Promise<{ message: string; reply: string; model: string }> =>
    api.post('/api/test-bot/chat', { message }).then(r => r.data),
}

// ── Product Image Upload ──────────────────────────────────────────────────────
export const uploadAPI = {
  productImage: (file: File, productId?: string): Promise<{ image_url: string }> => {
    const formData = new FormData()
    formData.append('file', file)
    if (productId) formData.append('product_id', productId)
    return api.post('/api/products/upload-image', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then(r => r.data)
  },
}

export default api
