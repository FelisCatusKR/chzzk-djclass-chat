const VARCHIVE_BASE_URL = 'https://v-archive.net'
const FETCH_TIMEOUT_MS = 8000

export interface VarchiveUser {
  success: boolean
  userNo: number
  nickname: string
}

export interface VarchiveDjClass {
  success: boolean
  djPowerSum: number
  djPowerConversion: number
  maxDjPower: number
  djClass: string
}

export async function lookupUser(token: string): Promise<VarchiveUser> {
  const response = await fetch(`${VARCHIVE_BASE_URL}/api/v2/open-token/user`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('Invalid token')
    }
    throw new Error(`V-ARCHIVE API error: ${response.status}`)
  }

  return response.json()
}

export async function getDjClass(
  nickname: string,
  button: number
): Promise<VarchiveDjClass> {
  const encodedNickname = encodeURIComponent(nickname)
  const response = await fetch(
    `${VARCHIVE_BASE_URL}/api/v2/archive/${encodedNickname}/djClass/${button}`,
    {
      headers: {
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    }
  )

  if (!response.ok) {
    throw new Error(`V-ARCHIVE DJ CLASS API error: ${response.status}`)
  }

  return response.json()
}

export async function getHighestDjClass(
  nickname: string
): Promise<(VarchiveDjClass & { button: number }) | null> {
  const buttons = [4, 5, 6, 8]

  const settled = await Promise.all(
    buttons.map(async (button) => {
      try {
        const result = await getDjClass(nickname, button)
        if (result.success && result.djClass) {
          return { ...result, button }
        }
      } catch {
        // Skip failed buttons
      }
      return null
    })
  )

  const results = settled.filter(
    (r): r is VarchiveDjClass & { button: number } => r !== null
  )
  if (results.length === 0) return null

  return results.reduce((best, current) =>
    current.djPowerConversion > best.djPowerConversion ? current : best
  )
}
