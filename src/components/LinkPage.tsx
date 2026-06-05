'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'

export default function LinkPage() {
  const [token, setToken] = useState('')
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [message, setMessage] = useState('')

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
            <CardDescription>Chzzk 계정으로 로그인해주세요.</CardDescription>
          </CardHeader>
          <CardContent>
            <a href="/api/auth/chzzk" className="block w-full">
              <Button className="w-full">Chzzk 로그인</Button>
            </a>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">2. V-ARCHIVE 토큰 입력</CardTitle>
            <CardDescription>
              토큰은{' '}
              <a
                href="https://v-archive.net/mypage"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:underline"
              >
                V-ARCHIVE 마이페이지
              </a>
              에서 발급받을 수 있습니다.
            </CardDescription>
          </CardHeader>
          <CardContent>
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
