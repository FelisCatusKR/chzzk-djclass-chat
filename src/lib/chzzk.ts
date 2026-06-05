const CHZZK_AUTH_URL = 'https://chzzk.naver.com/auth/oauth2/authorize'
const CHZZK_TOKEN_URL = 'https://openapi.chzzk.naver.com/auth/v1/token'
const CHZZK_API_URL = 'https://openapi.chzzk.naver.com/open/v1'

export function getOAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.CHZZK_CLIENT_ID!,
    redirect_uri: `${process.env.NEXT_PUBLIC_BASE_URL}/api/auth/chzzk/callback`,
    response_type: 'code',
    state,
  })
  return `${CHZZK_AUTH_URL}?${params.toString()}`
}

export async function exchangeCodeForToken(code: string): Promise<{
  accessToken: string
  refreshToken: string
}> {
  const response = await fetch(CHZZK_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      client_id: process.env.CHZZK_CLIENT_ID,
      client_secret: process.env.CHZZK_CLIENT_SECRET,
      code,
      redirect_uri: `${process.env.NEXT_PUBLIC_BASE_URL}/api/auth/chzzk/callback`,
    }),
  })

  if (!response.ok) {
    throw new Error(`Token exchange failed: ${response.status}`)
  }

  const data = await response.json()
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
  }
}

export async function getUserInfo(accessToken: string): Promise<{
  userId: string
  nickname: string
}> {
  const response = await fetch(`${CHZZK_API_URL}/users`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  })

  if (!response.ok) {
    throw new Error(`User info fetch failed: ${response.status}`)
  }

  const data = await response.json()
  return {
    userId: data.content?.userId,
    nickname: data.content?.nickname,
  }
}
