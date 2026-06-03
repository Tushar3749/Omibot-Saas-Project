'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function DiscountCategoriesRedirect() {
  const router = useRouter()
  useEffect(() => { router.replace('/dashboard/discounts') }, [router])
  return null
}
