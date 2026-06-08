import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getHighestDjClass, getAllDjClasses } from '../src/lib/varchive'

// Mock global fetch
global.fetch = vi.fn()

function mockButton(djClass: string, djPowerConversion: number): Response {
  return {
    ok: true,
    json: async () => ({
      success: true,
      djClass,
      djPowerSum: djPowerConversion,
      djPowerConversion,
      maxDjPower: djPowerConversion,
    }),
  } as Response
}

describe('getHighestDjClass', () => {
  beforeEach(() => {
    vi.mocked(fetch).mockClear()
  })

  it('picks the highest CLASS, breaking an exact rank+level tie by 8 > 5 > 6 > 4', async () => {
    const mockFetch = vi.mocked(fetch)
    mockFetch.mockResolvedValueOnce(mockButton('HIGH CLASS I', 5500)) // 4B
    mockFetch.mockResolvedValueOnce(mockButton('HIGH CLASS II', 8385.9)) // 5B (highest POWER)
    mockFetch.mockRejectedValueOnce(new Error('Not found')) // 6B
    mockFetch.mockResolvedValueOnce(mockButton('HIGH CLASS I', 6000)) // 8B

    // 4B and 8B are both HIGH CLASS I (top level here); 8B wins the button tie.
    // The 5B HIGH CLASS II has the highest POWER but a lower level, so it loses.
    const result = await getHighestDjClass('testuser')
    expect(result?.djClass).toBe('HIGH CLASS I')
    expect(result?.button).toBe(8)
    expect(result?.djPowerConversion).toBe(6000)
    expect(mockFetch).toHaveBeenCalledTimes(4)
  })

  it('prefers a higher rank even when a lower rank has more POWER and a higher button', async () => {
    const mockFetch = vi.mocked(fetch)
    mockFetch.mockResolvedValueOnce(mockButton('SHOWSTOPPER IV', 9705)) // 4B
    mockFetch.mockRejectedValueOnce(new Error('Not found')) // 5B
    mockFetch.mockRejectedValueOnce(new Error('Not found')) // 6B
    mockFetch.mockResolvedValueOnce(mockButton('HEADLINER I', 9999)) // 8B

    const result = await getHighestDjClass('testuser')
    expect(result?.djClass).toBe('SHOWSTOPPER IV')
    expect(result?.button).toBe(4)
  })

  it('prefers Theory (LoD at >=10000) over plain LoD even on a lower button', async () => {
    const mockFetch = vi.mocked(fetch)
    mockFetch.mockResolvedValueOnce(mockButton('THE LORD OF DJMAX', 10000)) // 4B theory
    mockFetch.mockResolvedValueOnce(mockButton('THE LORD OF DJMAX', 9990)) // 5B plain
    mockFetch.mockRejectedValueOnce(new Error('Not found')) // 6B
    mockFetch.mockRejectedValueOnce(new Error('Not found')) // 8B

    const result = await getHighestDjClass('testuser')
    expect(result?.button).toBe(4)
    expect(result?.djPowerConversion).toBe(10000)
  })

  it('falls back to button order when all buttons are Theory', async () => {
    const mockFetch = vi.mocked(fetch)
    mockFetch.mockResolvedValueOnce(mockButton('THE LORD OF DJMAX', 10000)) // 4B
    mockFetch.mockResolvedValueOnce(mockButton('THE LORD OF DJMAX', 10000)) // 5B
    mockFetch.mockResolvedValueOnce(mockButton('THE LORD OF DJMAX', 10000)) // 6B
    mockFetch.mockResolvedValueOnce(mockButton('THE LORD OF DJMAX', 10000)) // 8B

    const result = await getHighestDjClass('testuser')
    expect(result?.button).toBe(8)
  })

  it('returns null if all buttons fail', async () => {
    const mockFetch = vi.mocked(fetch)
    mockFetch.mockRejectedValue(new Error('Not found'))

    const result = await getHighestDjClass('testuser')
    expect(result).toBeNull()
    expect(mockFetch).toHaveBeenCalledTimes(4)
  })
})

describe('getAllDjClasses', () => {
  beforeEach(() => {
    vi.mocked(fetch).mockClear()
  })

  it('returns one entry per button that has a record', async () => {
    const mockFetch = vi.mocked(fetch)
    mockFetch.mockResolvedValueOnce(mockButton('SHOWSTOPPER II', 9800)) // 4B
    mockFetch.mockResolvedValueOnce(mockButton('HIGH CLASS I', 8400)) // 5B
    mockFetch.mockRejectedValueOnce(new Error('Not found')) // 6B
    mockFetch.mockResolvedValueOnce(mockButton('HEADLINER IV', 9400)) // 8B

    const result = await getAllDjClasses('testuser')
    expect(result.map((r) => r.button).sort((a, b) => a - b)).toEqual([4, 5, 8])
    expect(mockFetch).toHaveBeenCalledTimes(4)
  })

  it('returns an empty array when all buttons fail', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('Not found'))
    const result = await getAllDjClasses('testuser')
    expect(result).toEqual([])
  })
})
