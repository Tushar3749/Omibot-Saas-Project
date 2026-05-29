'use client'
import { useState, useId, forwardRef } from 'react'
import { Check, AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

interface FloatingInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string
  error?: string
  success?: boolean
  hint?: string
}

export const FloatingInput = forwardRef<HTMLInputElement, FloatingInputProps>(
  ({ label, error, success, hint, className, value, defaultValue, onChange, ...props }, ref) => {
    const id = useId()
    const [internalValue, setInternalValue] = useState(defaultValue ?? '')
    const [focused, setFocused] = useState(false)

    const controlled = value !== undefined
    const currentValue = controlled ? value : internalValue
    const hasValue = String(currentValue ?? '').length > 0
    const lifted = focused || hasValue

    function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
      if (!controlled) setInternalValue(e.target.value)
      onChange?.(e)
    }

    return (
      <div className="space-y-1">
        <div className="float-wrap">
          <input
            id={id}
            ref={ref}
            value={controlled ? value : internalValue}
            onChange={handleChange}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder=" "
            className={cn(
              'float-input',
              error   && 'error',
              success && 'success',
              className,
            )}
            {...props}
          />
          <label
            htmlFor={id}
            className="float-label"
            style={{
              top:        lifted ? 5   : 14,
              fontSize:   lifted ? 10  : 14,
              fontWeight: lifted ? 600 : 400,
              color: error
                ? 'var(--c-error)'
                : lifted
                  ? focused ? 'var(--c-accent)' : 'var(--c-text-2)'
                  : 'var(--c-text-2)',
              letterSpacing: lifted ? '0.02em' : 0,
              transition: 'all 0.15s ease',
            }}
          >
            {label}
          </label>

          {/* Right icon */}
          {success && !error && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 success-pop">
              <Check size={15} style={{ color: 'var(--c-success)' }} />
            </span>
          )}
          {error && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2">
              <AlertCircle size={15} style={{ color: 'var(--c-error)' }} />
            </span>
          )}
        </div>

        {/* Helper text */}
        {error && (
          <p className="text-xs px-1 anim-fade-in" style={{ color: 'var(--c-error)' }}>
            {error}
          </p>
        )}
        {hint && !error && (
          <p className="text-xs px-1" style={{ color: 'var(--c-text-3)' }}>{hint}</p>
        )}
      </div>
    )
  }
)
FloatingInput.displayName = 'FloatingInput'
