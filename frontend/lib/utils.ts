import { type ClassValue, clsx } from 'clsx'

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs)
}

export function formatBDT(amount: number): string {
  return `৳${amount.toLocaleString('en-BD')}`
}

export function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('bn-BD', {
    year: 'numeric', month: 'short', day: 'numeric',
  })
}

export function formatDateTime(dateString: string): string {
  return new Date(dateString).toLocaleString('en-BD', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

export function getStatusColor(status: string): string {
  const map: Record<string, string> = {
    pending:    'bg-yellow-100 text-yellow-800',
    confirmed:  'bg-blue-100 text-blue-800',
    shipped:    'bg-purple-100 text-purple-800',
    delivered:  'bg-green-100 text-green-800',
    cancelled:  'bg-red-100 text-red-800',
  }
  return map[status] ?? 'bg-gray-100 text-gray-800'
}

export function getPlanColor(plan: string): string {
  const map: Record<string, string> = {
    starter:    'bg-gray-100 text-gray-700',
    pro:        'bg-blue-100 text-blue-700',
    enterprise: 'bg-purple-100 text-purple-700',
  }
  return map[plan] ?? 'bg-gray-100 text-gray-700'
}

/** Save auth data to localStorage */
export function saveAuth(token: string, tenant: Record<string, unknown>): void {
  localStorage.setItem('omnibot_token', token)
  localStorage.setItem('omnibot_tenant', JSON.stringify(tenant))
}

/** Clear auth data */
export function clearAuth(): void {
  localStorage.removeItem('omnibot_token')
  localStorage.removeItem('omnibot_tenant')
}

/** Get current tenant from localStorage */
export function getStoredTenant(): Record<string, unknown> | null {
  if (typeof window === 'undefined') return null
  const raw = localStorage.getItem('omnibot_tenant')
  if (!raw) return null
  try { return JSON.parse(raw) } catch { return null }
}
