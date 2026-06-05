'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'

interface UserInfo {
  chzzkNickname: string
  varchiveLinked: boolean
  varchiveNickname: string | null
  djClass: string | null
  powerInteger: number | null
  isTheory: boolean
}

export default function LinkPage() {
  const [token, setToken] = useState('')
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [syncStatus, setSyncStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [syncMessage, setSyncMessage] = useState('')
  const [message, setMessage] = useState('')
  const [user, setUser] = useState<UserInfo | null>(null)
  const [loadingUser, setLoadingUser] = useState(true)

  useEffect(() => {
    fetch('/api/user/me')
      .then(async (res) => {
        if (res.ok) {
          const data = await res.json()
          setUser(data)
        }
      })
      .catch(() => {
        // ignore
      })
      .finally(() => setLoadingUser(false))
  }, [])

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' })
      window.location.reload()
    } catch {
      // ignore
    }
  }

  const handleSync = async () => {
    setSyncStatus('loading')
    try {
      const response = await fetch('/api/user/sync-djclass', { method: 'POST' })
      const data = await response.json()

      if (response.ok) {
        setSyncStatus('success')
        setSyncMessage(`DJ CLASS 동기화 완료: ${data.djClass}`)
        setUser((prev) => prev ? { 
          ...prev, 
          djClass: data.djClass, 
          powerInteger: data.djPowerConversion ? Math.floor(data.djPowerConversion) : null,
          isTheory: data.djPowerConversion >= 10000 
        } : null)
      } else {
        setSyncStatus('error')
        setSyncMessage(data.error || '동기화에 실패했습니다.')
      }
    } catch {
      setSyncStatus('error')
      setSyncMessage('네트워크 오류가 발생했습니다.')
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setStatus('loading')

    try {
      const response = await fetch('/api/user/link-varchive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })

      const data = await response.json()

      if (response.ok) {
        setStatus('success')
        setMessage(data.message)
        setUser((prev) => prev ? { ...prev, varchiveLinked: true, varchiveNickname: data.varchiveNickname || prev.varchiveNickname } : null)
      } else {
        setStatus('error')
        setMessage(data.error || '연동에 실패했습니다.')
      }
    } catch {
      setStatus('error')
      setMessage('네트워크 오류가 발생했습니다.')
    }
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-gray-50 px-4">
      <div className="max-w-md w-full space-y-6">
        <h1 className="text-3xl font-bold text-gray-900 text-center">
          DJ CLASS 연동
        </h1>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">1. Chzzk에 로그인</CardTitle>
            <CardDescription>
              {user?.chzzkNickname
                ? `${user.chzzkNickname}님, 환영합니다!`
                : 'Chzzk 계정으로 로그인해주세요.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {user?.chzzkNickname ? (
              <Button className="w-full" variant="outline" onClick={handleLogout}>
                {user.chzzkNickname}님 로그아웃
              </Button>
            ) : (
              <a href="/api/auth/chzzk" className="block w-full">
                <Button className="w-full">Chzzk 로그인</Button>
              </a>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">2. V-ARCHIVE 토큰 입력</CardTitle>
            <CardDescription>
              {user?.varchiveLinked
                ? `${user.varchiveNickname || 'V-ARCHIVE'}와 연동 완료`
                : '토큰은 '}
              {!user?.varchiveLinked && (
                <>
                  <a
                    href="https://v-archive.net/mypage"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:underline"
                  >
                    V-ARCHIVE 마이페이지
                  </a>
                  에서 발급받을 수 있습니다.
                </>
              )}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {user?.varchiveLinked ? (
              <div className="space-y-3">
                <Button className="w-full" disabled>
                  V-ARCHIVE 연동 완료
                </Button>
                <Button
                  className="w-full"
                  variant="secondary"
                  onClick={handleSync}
                  disabled={syncStatus === 'loading'}
                >
                  {syncStatus === 'loading' ? '동기화 중...' : 'DJ CLASS 동기화'}
                </Button>
                {user?.djClass && (
                  <div className="flex items-center justify-center gap-1 flex-wrap">
                    <span className="text-sm text-gray-600">현재 DJ CLASS:</span>
                    {(() => {
                      const rankMatch = user.djClass.match(/^\d+B\s+(.+?)\s+(I|II|III|IV|V|VI|VII|VIII|IX|X)$/)
                      const rankName = rankMatch ? rankMatch[1] : user.djClass.replace(/^\d+B\s+/, '')
                      const rankLevel = rankMatch ? rankMatch[2] : null
                      const shortNames: Record<string, string> = {
                        'THE LORD OF DJMAX': 'LoD',
                        'BEAT MAESTRO': 'BM',
                        'SHOWSTOPPER': 'SS',
                        'HEADLINER': 'HL',
                        'TREND SETTER': 'TS',
                        'PROFESSIONAL': 'PRO',
                        'HIGH CLASS': 'HC',
                        'PRO DJ': 'PD',
                        'MIDDLEMAN': 'MM',
                        'STREET DJ': 'SD',
                        'ROOKIE': 'RK',
                        'AMATEUR': 'AM',
                        'TRAINEE': 'TR',
                        'BEGINNER': 'BG',
                      }
                      const thresholds: Record<string, Record<string, number>> = {
                        'THE LORD OF DJMAX': { default: 9980 },
                        'BEAT MAESTRO': { 'IV': 9900, 'III': 9930, 'II': 9950, 'I': 9970 },
                        'SHOWSTOPPER': { 'IV': 9700, 'III': 9750, 'II': 9800, 'I': 9850 },
                        'HEADLINER': { 'IV': 9400, 'III': 9500, 'II': 9600, 'I': 9650 },
                        'TREND SETTER': { 'IV': 9000, 'III': 9100, 'II': 9200, 'I': 9300 },
                        'PROFESSIONAL': { 'IV': 8600, 'III': 8700, 'II': 8800, 'I': 8900 },
                        'HIGH CLASS': { 'IV': 7800, 'III': 8000, 'II': 8200, 'I': 8400 },
                        'PRO DJ': { 'IV': 7000, 'III': 7200, 'II': 7400, 'I': 7600 },
                        'MIDDLEMAN': { 'IV': 6200, 'III': 6400, 'II': 6600, 'I': 6800 },
                        'STREET DJ': { 'IV': 5200, 'III': 5500, 'II': 5800, 'I': 6000 },
                        'ROOKIE': { 'IV': 4000, 'III': 4300, 'II': 4600, 'I': 4900 },
                        'AMATEUR': { 'IV': 2400, 'III': 2800, 'II': 3200, 'I': 3600 },
                        'TRAINEE': { 'IV': 500, 'III': 1000, 'II': 1500, 'I': 2000 },
                        'BEGINNER': { default: 0 },
                      }
                      const shortName = shortNames[rankName] || rankName
                      const rankThresholds = thresholds[rankName]
                      const threshold = rankThresholds
                        ? (rankThresholds.default != null ? rankThresholds.default : (rankLevel && rankThresholds[rankLevel] != null ? rankThresholds[rankLevel] : null))
                        : null
                      return (
                        <>
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-bold bg-gray-200 text-gray-800">
                            {shortName}{rankLevel ? ` ${rankLevel}` : ''}
                          </span>
                          {threshold != null && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-bold bg-gray-700 text-white">
                              {threshold}+
                            </span>
                          )}
                          {user.powerInteger != null && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-bold bg-black text-white">
                              {user.powerInteger}
                            </span>
                          )}
                          {user.isTheory && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-bold bg-red-500 text-white">
                              이론치
                            </span>
                          )}
                        </>
                      )
                    })()}
                  </div>
                )}

                {syncStatus === 'success' && (
                  <Alert className="bg-green-50 border-green-200">
                    <AlertDescription className="text-green-800">{syncMessage}</AlertDescription>
                  </Alert>
                )}
                {syncStatus === 'error' && (
                  <Alert variant="destructive">
                    <AlertDescription>{syncMessage}</AlertDescription>
                  </Alert>
                )}
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="token">조회토큰</Label>
                  <Input
                    id="token"
                    type="text"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    placeholder="조회토큰을 입력하세요"
                    disabled={status === 'loading'}
                  />
                </div>
                <Button
                  type="submit"
                  disabled={status === 'loading' || !token.trim()}
                  className="w-full"
                >
                  {status === 'loading' ? '연동 중...' : '연동하기'}
                </Button>
              </form>
            )}

            {status === 'success' && (
              <Alert className="mt-4 bg-green-50 border-green-200">
                <AlertDescription className="text-green-800">{message}</AlertDescription>
              </Alert>
            )}
            {status === 'error' && (
              <Alert variant="destructive" className="mt-4">
                <AlertDescription>{message}</AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>

        <Link href="/" className="block text-center text-gray-500 hover:text-gray-700">
          ← 돌아가기
        </Link>
      </div>
    </main>
  )
}
