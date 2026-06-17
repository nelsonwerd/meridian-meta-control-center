import { useEffect, useRef } from 'react'

/** Calls `onOutside` when a pointerdown/escape happens outside the ref element. */
export function useClickOutside<T extends HTMLElement>(onOutside: () => void) {
  const ref = useRef<T>(null)
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onOutside()
    }
    function key(e: KeyboardEvent) {
      if (e.key === 'Escape') onOutside()
    }
    document.addEventListener('mousedown', handle)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('mousedown', handle)
      document.removeEventListener('keydown', key)
    }
  }, [onOutside])
  return ref
}
