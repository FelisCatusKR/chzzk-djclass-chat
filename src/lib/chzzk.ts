const CHZZK_AUTH_URL = 'https://chzzk.naver.com/account-interlock'
const CHZZK_TOKEN_URL = 'https://openapi.chzzk.naver.com/auth/v1/token'
const CHZZK_API_URL = 'https://openapi.chzzk.naver.com/open/v1'

export function getOAuthUrl(state: string): string {
  const params = new URLSearchParams({
    clientId: process.env.CHZZK_CLIENT_ID!,
    redirectUri: `${process.env.NEXT_PUBLIC_BASE_URL}/api/auth/chzzk/callback`,
    state,
  })
  return `${CHZZK_AUTH_URL}?${params.toString()}`
}

export async function exchangeCodeForToken(
  code: string,
  state: string
): Promise<{
  accessToken: string
  refreshToken: string
  expiresIn: number
}> {
  const response = await fetch(CHZZK_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grantType: 'authorization_code',
      clientId: process.env.CHZZK_CLIENT_ID,
      clientSecret: process.env.CHZZK_CLIENT_SECRET,
      code,
      state,
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Token exchange failed: ${response.status} - ${errorText}`)
  }

  const data = await response.json()
  const content = data.content ?? data
  return {
    accessToken: content.accessToken,
    refreshToken: content.refreshToken,
    expiresIn: parseInt(content.expiresIn, 10) || 86400,
  }
}

export async function refreshAccessToken(refreshToken: string): Promise<{
  accessToken: string
  refreshToken: string
  expiresIn: number
}> {
  const response = await fetch(CHZZK_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grantType: 'refresh_token',
      clientId: process.env.CHZZK_CLIENT_ID,
      clientSecret: process.env.CHZZK_CLIENT_SECRET,
      refreshToken,
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Token refresh failed: ${response.status} - ${errorText}`)
  }

  const data = await response.json()
  const content = data.content ?? data
  return {
    accessToken: content.accessToken,
    refreshToken: content.refreshToken,
    expiresIn: parseInt(content.expiresIn, 10) || 86400,
  }
}

export async function getUserInfo(accessToken: string): Promise<{
  userId: string
  nickname: string
}> {
  const response = await fetch(`${CHZZK_API_URL}/users/me`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  })

  if (!response.ok) {
    const errorText = await response.text()
    console.log(`[Chzzk] User info ${response.status} response:`, errorText)
    throw new Error(`User info fetch failed: ${response.status} - ${errorText}`)
  }

  const data = await response.json()
  const content = data.content || data
  return {
    userId: content.channelId,
    nickname: content.channelName,
  }
}
