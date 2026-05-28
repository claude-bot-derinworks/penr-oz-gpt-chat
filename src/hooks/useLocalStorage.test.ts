// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useLocalStorage } from './useLocalStorage'

// ---------------------------------------------------------------------------
// localStorage mock
// ---------------------------------------------------------------------------

const store: Record<string, string> = {}

const localStorageMock = {
  getItem: vi.fn((key: string) => store[key] ?? null),
  setItem: vi.fn((key: string, value: string) => { store[key] = value }),
  removeItem: vi.fn((key: string) => { delete store[key] }),
  clear: vi.fn(() => { for (const k in store) delete store[k] }),
  get length() { return Object.keys(store).length },
  key: vi.fn((i: number) => Object.keys(store)[i] ?? null),
}

vi.stubGlobal('localStorage', localStorageMock)

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useLocalStorage', () => {
  beforeEach(() => {
    localStorageMock.clear()
    vi.clearAllMocks()
  })

  it('returns the initial value when nothing is stored', () => {
    const { result } = renderHook(() => useLocalStorage('key', 'default'))
    expect(result.current[0]).toBe('default')
  })

  it('restores a previously saved string value', () => {
    store['key'] = JSON.stringify('saved')
    const { result } = renderHook(() => useLocalStorage('key', 'default'))
    expect(result.current[0]).toBe('saved')
  })

  it('restores a previously saved number value', () => {
    store['num'] = JSON.stringify(42)
    const { result } = renderHook(() => useLocalStorage('num', 0))
    expect(result.current[0]).toBe(42)
  })

  it('updates state and persists the new value', () => {
    const { result } = renderHook(() => useLocalStorage('key', 'initial'))
    act(() => result.current[1]('updated'))
    expect(result.current[0]).toBe('updated')
    expect(store['key']).toBe(JSON.stringify('updated'))
  })

  it('falls back to initial value when stored JSON is corrupt', () => {
    store['bad'] = 'not-valid-json{'
    const { result } = renderHook(() => useLocalStorage('bad', 99))
    expect(result.current[0]).toBe(99)
  })

  it('does not throw when localStorage.setItem fails', () => {
    localStorageMock.setItem.mockImplementationOnce(() => { throw new Error('quota') })
    const { result } = renderHook(() => useLocalStorage('key', 'x'))
    expect(() => act(() => result.current[1]('y'))).not.toThrow()
    expect(result.current[0]).toBe('y')
  })

  it('supports functional updates based on previous value', () => {
    const { result } = renderHook(() => useLocalStorage('count', 1))
    act(() => result.current[1]((prev) => prev + 1))
    expect(result.current[0]).toBe(2)
    expect(store['count']).toBe(JSON.stringify(2))
  })
})
