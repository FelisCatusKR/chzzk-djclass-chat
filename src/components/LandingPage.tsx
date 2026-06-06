import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

export default function LandingPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-2xl space-y-8 text-center">
        <h1 className="text-4xl font-bold text-gray-900">
          Chzzk DJ CLASS 채팅 위젯
        </h1>
        <p className="text-lg text-gray-600">
          V-ARCHIVE의 DJ CLASS를 채팅에 표시하는 OBS 위젯 서비스입니다.
        </p>

        <Card className="border-0 bg-transparent shadow-none">
          <CardContent className="space-y-4 pt-8">
            <Link href="/link" className="block w-full">
              <Button size="lg" className="w-full py-6 text-lg">
                시청자이신가요? - DJ CLASS 연동하기
              </Button>
            </Link>
            <Link href="/dashboard" className="block w-full">
              <Button
                size="lg"
                variant="secondary"
                className="w-full py-6 text-lg"
              >
                스트리머이신가요? - 채팅 위젯 얻기
              </Button>
            </Link>
          </CardContent>
        </Card>

        <footer className="space-y-2 pt-12 text-sm text-gray-400">
          <div>
            Special Thanks to{' '}
            <a
              href="https://chzzk.naver.com/1906dd57f578c255feca54700bcccfc9"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-gray-600"
            >
              똘똘똘이 님
            </a>
          </div>
          <a
            href="https://github.com/yourusername/chzzk-djclass-overlay"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-gray-600"
          >
            GitHub
          </a>
        </footer>
      </div>
    </main>
  )
}
