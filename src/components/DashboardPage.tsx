'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Alert, AlertDescription } from '@/components/ui/alert'

import type { BadgeMode } from '@/lib/types'

interface ChannelData {
  channelId: string
  widgetUrl: string
  isConnected: boolean
  hasTokens: boolean
}

const BADGE_MODE_LABELS: Record<BadgeMode, string> = {
  short: '짧은 이름 (4B SS II)',
  threshold: '근사 파워 (4B 9800+)',
  power: '정수 파워 (4B 9843)',
}

export default function DashboardPage() {
  const [data, setData] = useState<ChannelData | null>(null)
  const [badgeMode, setBadgeMode] = useState<BadgeMode>('short')
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/channel')
      .then(async (res) => {
        if (!res.ok) {
          if (res.status === 401) {
            window.location.href = '/api/auth/chzzk'
            return
          }
          throw new Error('Failed to fetch channel')
        }
        return res.json()
      })
      .then((data) => setData(data))
      .catch((err) => setError(err.message))
  }, [])

  const getWidgetUrl = (mode?: BadgeMode) => {
    if (!data?.widgetUrl) return ''
    const url = new URL(data.widgetUrl, window.location.origin)
    const m = mode || badgeMode
    url.searchParams.set('mode', m)
    return url.toString()
  }

  const copyUrl = () => {
    const url = getWidgetUrl()
    if (url) {
      navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' })
      window.location.href = '/'
    } catch {
      // ignore
    }
  }

  const handleSetBadgeMode = (mode: BadgeMode) => {
    setBadgeMode(mode)
  }

  if (error) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <Alert variant="destructive" className="max-w-md">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </main>
    )
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-lg space-y-6">
        <h1 className="text-center text-3xl font-bold text-gray-900">
          채팅 위젯 설정
        </h1>

        {!data ? (
          <p className="text-center text-gray-500">로딩 중...</p>
        ) : (
          <>
            <Card>
              <CardHeader>
                <CardTitle>위젯 URL</CardTitle>
                <CardDescription>
                  OBS Browser Source에 이 URL을 사용하세요.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex gap-2">
                  <Input
                    type="text"
                    value={getWidgetUrl()}
                    readOnly
                    className="flex-1 bg-gray-100"
                  />
                  <Button onClick={copyUrl}>
                    {copied ? '복사됨!' : 'URL 복사'}
                  </Button>
                </div>
                <p className="text-xs text-gray-500">
                  미리보기:{' '}
                  <a
                    href={getWidgetUrl()}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline hover:text-gray-700"
                  >
                    위젯 열기
                  </a>
                </p>

                <div className="space-y-2 pt-4">
                  <h2 className="font-medium">OBS 설정 방법</h2>
                  <ol className="list-inside list-decimal space-y-1 text-sm text-gray-600">
                    <li>OBS에서 소스 추가 → 브라우저 선택</li>
                    <li>위 URL을 입력하세요</li>
                    <li>너비: 400, 높이: 600 권장</li>
                    <li>투명도: 사용자 지정 CSS로 배경 투명 설정</li>
                  </ol>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>뱃지 모드</CardTitle>
                <CardDescription>
                  위젯에 표시할 DJ CLASS 뱃지 스타일을 선택하세요.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex gap-2">
                  {(Object.keys(BADGE_MODE_LABELS) as BadgeMode[]).map(
                    (mode) => (
                      <Button
                        key={mode}
                        variant={badgeMode === mode ? 'default' : 'outline'}
                        onClick={() => handleSetBadgeMode(mode)}
                        className="flex-1 text-xs"
                      >
                        {BADGE_MODE_LABELS[mode]}
                      </Button>
                    )
                  )}
                </div>
                <p className="mt-2 text-xs text-gray-500">
                  현재 선택:{' '}
                  <span className="font-semibold">
                    {BADGE_MODE_LABELS[badgeMode]}
                  </span>
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>연결 상태</CardTitle>
                <CardDescription>채팅 서버 연결 상태</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">Chzzk 로그인</span>
                  <span
                    className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      data.hasTokens
                        ? 'bg-green-100 text-green-800'
                        : 'bg-red-100 text-red-800'
                    }`}
                  >
                    {data.hasTokens ? '완료' : '미완료'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">채팅 서버 연결</span>
                  <span
                    className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      data.isConnected
                        ? 'bg-green-100 text-green-800'
                        : 'bg-gray-100 text-gray-800'
                    }`}
                  >
                    {data.isConnected ? '연결됨' : '대기 중'}
                  </span>
                </div>

                {!data.hasTokens && (
                  <Alert variant="destructive" className="mt-2">
                    <AlertDescription>
                      Chzzk 로그인이 필요합니다. 위젯을 사용하려면 Chzzk
                      계정으로 다시 로그인해주세요.
                    </AlertDescription>
                  </Alert>
                )}

                {data.hasTokens && !data.isConnected && (
                  <Alert className="mt-2 border-yellow-200 bg-yellow-50">
                    <AlertDescription className="text-yellow-800">
                      위젯이 아직 연결되지 않았습니다. OBS에서 위젯을 추가하면
                      자동으로 연결됩니다.
                    </AlertDescription>
                  </Alert>
                )}
              </CardContent>
            </Card>
          </>
        )}

        <div className="flex flex-col gap-3">
          <Button variant="outline" onClick={handleLogout} className="w-full">
            로그아웃
          </Button>
          <Link
            href="/"
            className="block text-center text-gray-500 hover:text-gray-700"
          >
            ← 돌아가기
          </Link>
        </div>
      </div>
    </main>
  )
}
