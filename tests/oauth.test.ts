import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  getOAuthUrl,
  exchangeCodeForToken,
  refreshAccessToken,
  getUserInfo,
} from '../src/lib/chzzk'

// Mock global fetch
global.fetch = vi.fn()

describe('Chzzk OAuth', () => {
  beforeEach(() => {
    vi.mocked(fetch).mockClear()
    process.env.CHZZK_CLIENT_ID = 'test-client-id'
    process.env.CHZZK_CLIENT_SECRET = 'test-client-secret'
    process.env.NEXT_PUBLIC_BASE_URL = 'https://test.example.com'
  })

  it('should generate OAuth URL with required parameters', () => {
    const url = getOAuthUrl('test-state-123')
    expect(url).toContain('https://chzzk.naver.com/account-interlock')
    expect(url).toContain('clientId=test-client-id')
    expect(url).toContain('redirectUri=' + encodeURIComponent('https://test.example.com/api/auth/chzzk/callback'))
    expect(url).toContain('state=test-state-123')
  })

  it('should exchange code for token with wrapped response', async () => {
    const mockFetch = vi.mocked(fetch)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        code: 200,
        message: 'success',
        content: {
          accessToken: 'acc_123',
          refreshToken: 'ref_456',
          expiresIn: '3600',
        },
      }),
    } as Response)

    const result = await exchangeCodeForToken('auth-code', 'test-state')
    expect(result.accessToken).toBe('acc_123')
    expect(result.refreshToken).toBe('ref_456')
    expect(result.expiresIn).toBe(3600)

    const callArgs = mockFetch.mock.calls[0]
    expect(callArgs[0]).toBe('https://openapi.chzzk.naver.com/auth/v1/token')
    const body = JSON.parse(callArgs[1]!.body as string)
    expect(body.grantType).toBe('authorization_code')
    expect(body.code).toBe('auth-code')
  })

  it('should exchange code for token with unwrapped response', async () => {
    const mockFetch = vi.mocked(fetch)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        accessToken: 'direct_acc',
        refreshToken: 'direct_ref',
        expiresIn: '7200',
      }),
    } as Response)

    const result = await exchangeCodeForToken('auth-code', 'test-state')
    expect(result.accessToken).toBe('direct_acc')
    expect(result.expiresIn).toBe(7200)
  })

  it('should throw on token exchange failure', async () => {
    const mockFetch = vi.mocked(fetch)
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => 'Invalid code',
    } as Response)

    await expect(exchangeCodeForToken('bad-code', 'state')).rejects.toThrow('Token exchange failed')
  })

  it('should refresh access token', async () => {
    const mockFetch = vi.mocked(fetch)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: {
          accessToken: 'new_acc',
          refreshToken: 'new_ref',
          expiresIn: '3600',
        },
      }),
    } as Response)

    const result = await refreshAccessToken('old-refresh-token')
    expect(result.accessToken).toBe('new_acc')
    expect(result.refreshToken).toBe('new_ref')

    const body = JSON.parse(mockFetch.mock.calls[0][1]!.body as string)
    expect(body.grantType).toBe('refresh_token')
    expect(body.refreshToken).toBe('old-refresh-token')
  })

  it('should throw on refresh failure', async () => {
    const mockFetch = vi.mocked(fetch)
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => 'Invalid refresh token',
    } as Response)

    await expect(refreshAccessToken('bad-token')).rejects.toThrow('Token refresh failed')
  })

  it('should fetch user info with wrapped response', async () => {
    const mockFetch = vi.mocked(fetch)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        code: 200,
        content: {
          channelId: 'test-channel-id',
          channelName: 'TestStreamer',
        },
      }),
    } as Response)

    const result = await getUserInfo('test-access-token')
    expect(result.userId).toBe('test-channel-id')
    expect(result.nickname).toBe('TestStreamer')

    const callArgs = mockFetch.mock.calls[0]
    expect(callArgs[1]?.headers).toEqual({ Authorization: 'Bearer test-access-token' })
  })

  it('should fetch user info with unwrapped response', async () => {
    const mockFetch = vi.mocked(fetch)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        channelId: 'direct-id',
        channelName: 'DirectName',
      }),
    } as Response)

    const result = await getUserInfo('token')
    expect(result.userId).toBe('direct-id')
    expect(result.nickname).toBe('DirectName')
  })

  it('should throw on user info fetch failure', async () => {
    const mockFetch = vi.mocked(fetch)
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      text: async () => 'Forbidden',
    } as Response)

    await expect(getUserInfo('bad-token')).rejects.toThrow('User info fetch failed')
  })
})
