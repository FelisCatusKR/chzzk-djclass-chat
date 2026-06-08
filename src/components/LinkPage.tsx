'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import SiteBackground from '@/components/SiteBackground'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import LinkClassBadge from '@/components/LinkClassBadge'

interface UserInfo {
  chzzkNickname: string
  varchiveLinked: boolean
  varchiveNickname: string | null
  djClass: string | null
  powerInteger: number | null
  preferredButton: number | null
  buttons: { button: number; djClass: string; powerInteger: number | null }[]
}

export default function LinkPage() {
  const [token, setToken] = useState('')
  const [status, setStatus] = useState<
    'idle' | 'loading' | 'success' | 'error'
  >('idle')
  const [syncStatus, setSyncStatus] = useState<
    'idle' | 'loading' | 'success' | 'error'
  >('idle')
  const [syncMessage, setSyncMessage] = useState('')
  const [message, setMessage] = useState('')
  const [user, setUser] = useState<UserInfo | null>(null)

  const loadUser = useCallback(async () => {
    try {
      const res = await fetch('/api/user/me')
      if (res.ok) {
        setUser(await res.json())
      } else if (res.status === 401) {
        // Session expired after the server gate passed; re-login.
        window.location.href = '/login?next=/link'
      }
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    loadUser()
  }, [loadUser])

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
        await loadUser()
      } else {
        setSyncStatus('error')
        setSyncMessage(data.error || '동기화에 실패했습니다.')
      }
    } catch {
      setSyncStatus('error')
      setSyncMessage('네트워크 오류가 발생했습니다.')
    }
  }

  const handlePreferredButton = async (value: string) => {
    const button = value === 'auto' ? null : Number(value)
    // Optimistic update
    setUser((prev) => (prev ? { ...prev, preferredButton: button } : prev))
    try {
      await fetch('/api/user/preferred-button', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ button }),
      })
    } catch {
      // ignore — next /api/user/me load reconciles
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
        await loadUser()
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
    <SiteBackground>
      <main className="flex min-h-screen flex-col items-center justify-center px-4 py-8 sm:py-12">
        <div className="w-full max-w-md space-y-6">
          <h1 className="text-center text-3xl font-bold text-gray-900">
            DJ CLASS 연동
          </h1>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Chzzk 계정</CardTitle>
              <CardDescription>
                {user?.chzzkNickname
                  ? `${user.chzzkNickname}님, 환영합니다!`
                  : '계정 정보를 불러오는 중...'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                className="w-full"
                variant="outline"
                onClick={handleLogout}
              >
                {user?.chzzkNickname
                  ? `${user.chzzkNickname}님 로그아웃`
                  : '로그아웃'}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">V-ARCHIVE 토큰 입력</CardTitle>
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
                    {syncStatus === 'loading'
                      ? '동기화 중...'
                      : 'DJ CLASS 동기화'}
                  </Button>
                  {syncStatus === 'success' && (
                    <Alert className="border-green-200 bg-green-50">
                      <AlertDescription className="text-green-800">
                        {syncMessage}
                      </AlertDescription>
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
                <Alert className="mt-4 border-green-200 bg-green-50">
                  <AlertDescription className="text-green-800">
                    {message}
                  </AlertDescription>
                </Alert>
              )}
              {status === 'error' && (
                <Alert variant="destructive" className="mt-4">
                  <AlertDescription>{message}</AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>

          {user?.varchiveLinked && (user?.buttons?.length ?? 0) >= 1 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">버튼 선택</CardTitle>
                <CardDescription>
                  위젯에 표시할 버튼을 선택하세요. 스트리머가 &lsquo;시청자 선택
                  우선&rsquo;을 켰을 때 적용됩니다.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <RadioGroup
                  value={
                    user.preferredButton == null
                      ? 'auto'
                      : String(user.preferredButton)
                  }
                  onValueChange={handlePreferredButton}
                  className="space-y-2"
                >
                  <Label
                    htmlFor="pref-auto"
                    className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg border p-3"
                  >
                    <span className="flex items-center gap-2">
                      <span className="text-sm font-medium">
                        자동 (최고 클래스)
                      </span>
                      <LinkClassBadge
                        djClass={user.djClass}
                        powerInteger={user.powerInteger}
                      />
                    </span>
                    <RadioGroupItem id="pref-auto" value="auto" />
                  </Label>
                  {user.buttons.map((b) => (
                    <Label
                      key={b.button}
                      htmlFor={`pref-${b.button}`}
                      className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg border p-3"
                    >
                      <span className="flex items-center gap-2">
                        <span className="text-sm font-medium">
                          {b.button}버튼
                        </span>
                        <LinkClassBadge
                          djClass={b.djClass}
                          powerInteger={b.powerInteger}
                        />
                      </span>
                      <RadioGroupItem
                        id={`pref-${b.button}`}
                        value={String(b.button)}
                      />
                    </Label>
                  ))}
                </RadioGroup>
              </CardContent>
            </Card>
          )}

          <Link
            href="/"
            className="block text-center text-gray-500 hover:text-gray-700"
          >
            ← 돌아가기
          </Link>
        </div>
      </main>
    </SiteBackground>
  )
}
