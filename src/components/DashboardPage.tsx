'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Alert, AlertDescription } from '@/components/ui/alert'

interface ChannelData {
  channelId: string
  widgetUrl: string
}

export default function DashboardPage() {
  const [data, setData] = useState<ChannelData | null>(null)
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

  const copyUrl = () => {
    if (data?.widgetUrl) {
      navigator.clipboard.writeText(data.widgetUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  if (error) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <Alert variant="destructive" className="max-w-md">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </main>
    )
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-gray-50 px-4">
      <div className="max-w-lg w-full space-y-6">
        <h1 className="text-3xl font-bold text-gray-900 text-center">
          채팅 위젯 설정
        </h1>

        {!data ? (
          <p className="text-center text-gray-500">로딩 중...</p>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>위젯 URL</CardTitle>
              <CardDescription>OBS Browser Source에 이 URL을 사용하세요.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2">
                <Input
                  type="text"
                  value={data.widgetUrl}
                  readOnly
                  className="flex-1 bg-gray-100"
                />
                <Button onClick={copyUrl}>
                  {copied ? '복사됨!' : 'URL 복사'}
                </Button>
              </div>

              <div className="space-y-2 pt-4">
                <h2 className="font-medium">OBS 설정 방법</h2>
                <ol className="list-decimal list-inside space-y-1 text-sm text-gray-600">
                  <li>OBS에서 소스 추가 → 브라우저 선택</li>
                  <li>위 URL을 입력하세요</li>
                  <li>너비: 400, 높이: 600 권장</li>
                  <li>투명도: 사용자 지정 CSS로 배경 투명 설정</li>
                </ol>
              </div>
            </CardContent>
          </Card>
        )}

        <Link href="/" className="block text-center text-gray-500 hover:text-gray-700">
          ← 돌아가기
        </Link>
      </div>
    </main>
  )
}
