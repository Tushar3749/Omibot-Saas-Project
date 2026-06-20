/**
 * OmniBot SaaS — Typed API client
 * Wraps every backend endpoint with a typed function.
 * Reads the JWT from localStorage and attaches it to every request.
 */
import axios, { AxiosInstance } from 'axios'
import type { CSVImportType, CSVImportResult } from '@/types'

const LOCAL_API_URL  = process.env.NEXT_PUBLIC_API_URL         || 'http://localhost:8000'
const NGROK_API_URL  = process.env.NEXT_PUBLIC_BACKEND_NGROK_URL || ''

// ── Axios instance ────────────────────────────────────────────────────────────
const api: AxiosInstance = axios.create({
  baseURL: LOCAL_API_URL,
  headers: { 'ngrok-skip-browser-warning': 'true' },
})

// Attach JWT + switch to ngrok baseURL when accessed from a non-localhost hostname
api.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const isRemote = window.location.hostname !== 'localhost' &&
                     window.location.hostname !== '127.0.0.1'
    if (isRemote && NGROK_API_URL) config.baseURL = NGROK_API_URL
    const token = localStorage.getItem('omnibot_token')
    if (token) config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// Auto-refresh on 401; redirect to subscription on 402
let isRefreshing = false
let failedQueue: Array<{ resolve: (token: string) => void; reject: (err: unknown) => void }> = []

const processQueue = (error: unknown, token: string | null = null) => {
  failedQueue.forEach(({ resolve, reject }) => (error ? reject(error) : resolve(token!)))
  failedQueue = []
}

api.interceptors.response.use(
  (res) => res,
  async (err) => {
    if (typeof window === 'undefined') return Promise.reject(err)

    if (err.response?.status === 402) {
      if (!window.location.pathname.startsWith('/dashboard/subscription')) {
        window.location.href = '/dashboard/subscription?expired=true'
      }
      return Promise.reject(err)
    }

    const originalRequest = err.config
    const storedToken = localStorage.getItem('omnibot_token')
    // Skip refresh if: not a 401, already retried, no token to refresh,
    // or the failing request is any auth endpoint (prevents loops on wrong credentials)
    if (
      err.response?.status !== 401 ||
      originalRequest._retry ||
      !storedToken ||
      originalRequest.url?.includes('/api/auth/refresh') ||
      originalRequest.url?.includes('/api/auth/login') ||
      originalRequest.url?.includes('/api/auth/register')
    ) {
      return Promise.reject(err)
    }

    // Queue concurrent requests while a refresh is in progress
    if (isRefreshing) {
      return new Promise<string>((resolve, reject) => {
        failedQueue.push({ resolve, reject })
      }).then((token) => {
        originalRequest.headers.Authorization = `Bearer ${token}`
        return api(originalRequest)
      })
    }

    originalRequest._retry = true
    isRefreshing = true

    try {
      const { data } = await api.post('/api/auth/refresh')
      const newToken: string = data.access_token
      localStorage.setItem('omnibot_token', newToken)
      if (data.tenant) localStorage.setItem('omnibot_tenant', JSON.stringify(data.tenant))
      api.defaults.headers.common.Authorization = `Bearer ${newToken}`
      processQueue(null, newToken)
      originalRequest.headers.Authorization = `Bearer ${newToken}`
      return api(originalRequest)
    } catch (refreshErr) {
      processQueue(refreshErr, null)
      localStorage.removeItem('omnibot_token')
      localStorage.removeItem('omnibot_tenant')
      window.location.href = '/login'
      return Promise.reject(refreshErr)
    } finally {
      isRefreshing = false
    }
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

// ── Settings (delivery charges + bulk discounts) ──────────────────────────────
export const settingsAPI = {
  getDeliveryCharges: () =>
    api.get('/api/settings/delivery-charges').then(r => r.data),
  saveDeliveryCharges: (charges: { district: string; charge: number }[]) =>
    api.put('/api/settings/delivery-charges', { charges }).then(r => r.data),

  listBulkDiscounts: () =>
    api.get('/api/settings/bulk-discounts').then(r => r.data),
  createBulkDiscount: (data: Record<string, unknown>) =>
    api.post('/api/settings/bulk-discounts', data).then(r => r.data),
  updateBulkDiscount: (id: string, data: Record<string, unknown>) =>
    api.patch(`/api/settings/bulk-discounts/${id}`, data).then(r => r.data),
  deleteBulkDiscount: (id: string) =>
    api.delete(`/api/settings/bulk-discounts/${id}`).then(r => r.data),
}

// ── Courier ───────────────────────────────────────────────────────────────────
export const courierAPI = {
  saveTracking: (orderId: string, data: { tracking_number: string; courier_name: string }) =>
    api.patch(`/api/courier/orders/${orderId}/tracking`, data).then(r => r.data),

  createSteadfast: (data: Record<string, unknown>) =>
    api.post('/api/courier/steadfast/create', data).then(r => r.data),

  createPathao: (data: Record<string, unknown>) =>
    api.post('/api/courier/pathao/create', data).then(r => r.data),

  track: (orderId: string) =>
    api.get(`/api/courier/track/${orderId}`).then(r => r.data),
}

// ── Products ─────────────────────────────────────────────────────────────────
export const productsAPI = {
  list:   () => api.get('/api/products/').then(r => r.data),
  get:    (id: string) => api.get(`/api/products/${id}`).then(r => r.data),
  create: (data: Record<string, unknown>) =>
    api.post('/api/products/', data).then(r => r.data),
  update: (id: string, data: Record<string, unknown>) =>
    api.patch(`/api/products/${id}`, data).then(r => r.data),
  delete: (id: string) => api.delete(`/api/products/${id}`).then(r => r.data),

  importCSV: (file: File, importType: CSVImportType = 'products'): Promise<CSVImportResult> => {
    const formData = new FormData()
    formData.append('file', file)
    formData.append('import_type', importType)
    return api.post('/api/products/import/csv', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then(r => r.data)
  },

  importHistory: () => api.get('/api/products/import/history').then(r => r.data),

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
  list:     () => api.get('/api/conversations/').then(r => r.data),
  get:      (id: string) => api.get(`/api/conversations/${id}`).then(r => r.data),
  messages: (id: string) => api.get(`/api/conversations/${id}/messages`).then(r => r.data),
  takeover: (id: string, is_ai_active: boolean) =>
    api.patch(`/api/conversations/${id}/takeover`, { is_ai_active }).then(r => r.data),
  toggleAI: (id: string, is_ai_active: boolean) =>
    api.patch(`/api/conversations/${id}/takeover`, { is_ai_active }).then(r => r.data),
}

// ── Orders ────────────────────────────────────────────────────────────────────
export const ordersAPI = {
  list:         (status?: string) =>
    api.get('/api/orders/', { params: status ? { status } : {} }).then(r => r.data),
  get:          (id: string) => api.get(`/api/orders/${id}`).then(r => r.data),
  updateStatus: (id: string, status: string) =>
    api.patch(`/api/orders/${id}/status`, { status }).then(r => r.data),
  saveTracking: (id: string, tracking_number: string, courier_name: string) =>
    api.patch(`/api/courier/orders/${id}/tracking`, { tracking_number, courier_name }).then(r => r.data),
}

// ── Discounts ─────────────────────────────────────────────────────────────────
export const discountsAPI = {
  list:               () => api.get('/api/discounts/').then(r => r.data),
  get:                (id: string) => api.get(`/api/discounts/${id}`).then(r => r.data),
  create:             (data: Record<string, unknown>) => api.post('/api/discounts/', data).then(r => r.data),
  update:             (id: string, data: Record<string, unknown>) => api.patch(`/api/discounts/${id}`, data).then(r => r.data),
  delete:             (id: string) => api.delete(`/api/discounts/${id}`).then(r => r.data),
  getByOrder:         (orderId: string) => api.get(`/api/discounts/order/${orderId}`).then(r => r.data),
  report:             (params?: Record<string, unknown>) => api.get('/api/discounts/report', { params }).then(r => r.data),
  reportMonthly:      () => api.get('/api/discounts/report/monthly').then(r => r.data),
  reportMonthlyDetail:(year: number, month: number) => api.get(`/api/discounts/report/monthly/${year}/${month}`).then(r => r.data),
  updatePriority:     (id: string, priority: number) => api.put(`/api/discounts/${id}/priority`, { priority }).then(r => r.data),
  simulate:           (id: string, params: Record<string, unknown>) => api.post(`/api/discounts/${id}/simulate`, params).then(r => r.data),
}

// ── Analytics ─────────────────────────────────────────────────────────────────
export const analyticsAPI = {
  overview: () => api.get('/api/analytics/overview').then(r => r.data),
  daily:    (days = 30) =>
    api.get('/api/analytics/daily', { params: { days } }).then(r => r.data),
  advanced: (period: '7d' | '30d' | '90d' = '30d') =>
    api.get('/api/analytics/advanced', { params: { period } }).then(r => r.data),
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

// ── Policy Documents (thin wrapper around knowledgeAPI, filters by content_type) ─
export const policyAPI = {
  list: (contentType: string) =>
    api.get('/api/knowledge/').then(r =>
      (r.data as Array<{ content_type: string; file_name: string | null }>)
        .filter(d => d.content_type === contentType && d.file_name)
    ),
  upload: (file: File, contentType: string) => {
    const formData = new FormData()
    formData.append('file', file)
    formData.append('content_type', contentType)
    return api.post('/api/knowledge/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then(r => r.data)
  },
  deleteFile: (fileName: string) =>
    api.delete(`/api/knowledge/file/${encodeURIComponent(fileName)}`).then(r => r.data),
}

// ── AI Instructions ───────────────────────────────────────────────────────────
export interface AISummary {
  summary_text: string
  display_points: string[]
  ai_summary_updated_at: string | null
  rules_count?: number
  merged_count?: number
}

export const aiInstructionsAPI = {
  list: (): Promise<Array<{ id: string; title: string; body: string; sort_order: number; is_active: boolean; created_at: string }>> =>
    api.get('/api/ai-instructions/').then(r => r.data),
  create: (data: { title: string; body: string; sort_order?: number; is_active?: boolean }) =>
    api.post('/api/ai-instructions/', data).then(r => r.data),
  update: (id: string, data: { title?: string; body?: string; sort_order?: number; is_active?: boolean }) =>
    api.put(`/api/ai-instructions/${id}`, data).then(r => r.data),
  delete: (id: string) =>
    api.delete(`/api/ai-instructions/${id}`).then(r => r.data),
  getSummary: (): Promise<AISummary> =>
    api.get('/api/ai-instructions/summary').then(r => r.data),
  generateSummary: (): Promise<AISummary> =>
    api.post('/api/ai-instructions/generate-summary').then(r => r.data),
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
  chat: (message: string, customer_phone?: string, quick_reply_payload?: string): Promise<{
    message: string; reply: string; model: string
    order_flow: string | null
    conversation_id: string
    state: Record<string, unknown>
    discount_context?: Record<string, unknown> | null
  }> =>
    api.post('/api/test-bot/chat', { message, customer_phone, quick_reply_payload }).then(r => r.data),

  reset: (): Promise<{ ok: boolean; conversation_id: string }> =>
    api.post('/api/test-bot/reset').then(r => r.data),

  sendImage: (file: File): Promise<{
    reply:           string
    analysis:        { likely_product_name: string; confidence: string; product_description: string; category: string }
    products:        Array<{ product_id: string; name: string; sku: string; mrp: number; image_url?: string }>
    conversation_id: string
  }> => {
    const fd = new FormData()
    fd.append('file', file)
    return api.post('/api/test-bot/image', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then(r => r.data)
  },
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

// ── Combos ────────────────────────────────────────────────────────────────────
export const combosAPI = {
  list:   () => api.get('/api/combos/').then(r => r.data),
  get:    (id: string) => api.get(`/api/combos/${id}`).then(r => r.data),
  create: (data: Record<string, unknown>) => api.post('/api/combos/', data).then(r => r.data),
  update: (id: string, data: Record<string, unknown>) => api.patch(`/api/combos/${id}`, data).then(r => r.data),
  delete: (id: string) => api.delete(`/api/combos/${id}`).then(r => r.data),
}

// ── Stock ─────────────────────────────────────────────────────────────────────
export const stockAPI = {
  list:         () => api.get('/api/stock/').then(r => r.data),
  update:       (data: Record<string, unknown>) => api.patch('/api/stock/update', data).then(r => r.data),
  history:      () => api.get('/api/stock/history').then(r => r.data),
  alerts:       () => api.get('/api/stock/alerts').then(r => r.data),
  setThreshold: (threshold: number) => api.patch('/api/stock/threshold', { threshold }).then(r => r.data),
  report:       (params: { from_date?: string; to_date?: string; product_id?: string }) =>
    api.get('/api/stock/report', { params }).then(r => r.data),
  importCSV:    (file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return api.post('/api/stock/import/csv', fd).then(r => r.data)
  },
}

// ── Returns ───────────────────────────────────────────────────────────────────
export const returnsAPI = {
  list:    (status?: string) => api.get('/api/returns/', { params: status ? { status } : {} }).then(r => r.data),
  counts:  ()                => api.get('/api/returns/counts').then(r => r.data),
  approve: (id: string)      => api.patch(`/api/returns/${id}/approve`).then(r => r.data),
  reject:  (id: string, owner_note?: string) =>
    api.patch(`/api/returns/${id}/reject`, { owner_note: owner_note ?? null }).then(r => r.data),
  delete:  (id: string)      => api.delete(`/api/returns/${id}`).then(r => r.data),
}

// ── Complaints ────────────────────────────────────────────────────────────────
export const complaintsAPI = {
  list:   (status?: string) => api.get('/api/complaints/', { params: status ? { status } : {} }).then(r => r.data),
  create: (data: Record<string, unknown>) => api.post('/api/complaints/', data).then(r => r.data),
  update: (id: string, data: Record<string, unknown>) => api.patch(`/api/complaints/${id}`, data).then(r => r.data),
  stats:  () => api.get('/api/complaints/stats').then(r => r.data),
}

// ── Product Images ────────────────────────────────────────────────────────────
export const productImagesAPI = {
  list: (productId: string) =>
    api.get('/api/product-images/', { params: { product_id: productId } }).then(r => r.data),

  upload: (
    productId: string,
    file: File,
    description: string,
    isPrimary: boolean,
    autoDescribe = false,
  ) => {
    const fd = new FormData()
    fd.append('product_id',    productId)
    fd.append('file',          file)
    fd.append('description',   description)
    fd.append('is_primary',    String(isPrimary))
    fd.append('auto_describe', String(autoDescribe))
    return api.post('/api/product-images/', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then(r => r.data)
  },

  setPrimary: (imageId: string) =>
    api.patch(`/api/product-images/${imageId}/primary`).then(r => r.data),

  updateDescription: (imageId: string, description: string) =>
    api.patch(`/api/product-images/${imageId}/description`, { description }).then(r => r.data),

  delete: (imageId: string) =>
    api.delete(`/api/product-images/${imageId}`).then(r => r.data),

  search: (q: string, limit = 5) =>
    api.get('/api/product-images/search', { params: { q, limit } }).then(r => r.data),
}

// ── OTP ───────────────────────────────────────────────────────────────────────
export const otpAPI = {
  testSend: (phone: string): Promise<{ message: string }> =>
    api.post('/api/otp/test-send', { phone }).then(r => r.data),
}

// ── Discount Rules ────────────────────────────────────────────────────────────
export const discountRulesAPI = {
  list:   () => api.get('/api/discount-rules/').then(r => r.data),
  create: (data: Record<string, unknown>) =>
    api.post('/api/discount-rules/', data).then(r => r.data),
  update: (id: string, data: Record<string, unknown>) =>
    api.patch(`/api/discount-rules/${id}`, data).then(r => r.data),
  delete: (id: string) =>
    api.delete(`/api/discount-rules/${id}`).then(r => r.data),
}


// ── Notifications ─────────────────────────────────────────────────────────────
export const notificationsAPI = {
  count:      () => api.get('/api/notifications/count').then(r => r.data as { count: number }),
  list:       (limit = 30) => api.get('/api/notifications/', { params: { limit } }).then(r => r.data),
  markRead:   (id: string) => api.patch(`/api/notifications/${id}/read`).then(r => r.data),
  markAllRead: () => api.post('/api/notifications/read-all').then(r => r.data),
}

export default api
