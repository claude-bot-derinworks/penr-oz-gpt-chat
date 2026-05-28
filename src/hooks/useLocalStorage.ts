import { useState } from 'react'

/**
 * Persists state to localStorage so the value survives page reloads.
 *
 * On first render the hook reads the stored JSON value for `key`; if none
 * exists (or the stored value cannot be parsed) it falls back to
 * `initialValue`.  Every time the returned setter is called the new value is
 * also written to localStorage so subsequent visits restore it automatically.
 */
export function useLocalStorage<T>(key: string, initialValue: T): [T, (value: T | ((val: T) => T)) => void] {
  const [storedValue, setStoredValue] = useState<T>(() => {
    try {
      const item = localStorage.getItem(key)
      return item !== null ? (JSON.parse(item) as T) : initialValue
    } catch {
      return initialValue
    }
  })

  const setValue = (value: T | ((val: T) => T)) => {
    const valueToStore = value instanceof Function ? value(storedValue) : value
    setStoredValue(valueToStore)
    try {
      localStorage.setItem(key, JSON.stringify(valueToStore))
    } catch {
      // Silently ignore write failures (e.g. private-browsing storage quota).
    }
  }

  return [storedValue, setValue]
}
