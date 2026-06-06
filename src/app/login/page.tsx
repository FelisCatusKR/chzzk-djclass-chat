import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import SiteBackground from '@/components/SiteBackground'
import { verifySessionCookie } from '@/lib/session'
import { safeNextPath } from '@/lib/safe-redirect'

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const { next } = await searchParams
  const target = safeNextPath(next ?? null)

  const session = (await cookies()).get('session')?.value
  if (session && verifySessionCookie(session)) {
    redirect(target)
  }

  const context =
    target === '/dashboard'
      ? '위젯 설정을 위해'
      : target === '/link'
        ? 'DJ CLASS 연동을 위해'
        : null

  return (
    <SiteBackground>
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-sm rounded-2xl border border-white/90 bg-white/70 p-8 text-center shadow-lg backdrop-blur-md">
          <div className="mb-4 text-4xl">🔒</div>
          <h1 className="mb-2 text-xl font-bold text-gray-900">
            로그인이 필요해요
          </h1>
          <p className="mb-6 text-sm leading-relaxed text-gray-600">
            {context ? (
              <>
                <b className="text-gray-900">{context}</b>
                <br />
              </>
            ) : null}
            Chzzk 계정으로 로그인해주세요.
          </p>
          <a
            href={`/api/auth/chzzk?next=${encodeURIComponent(target)}`}
            className="block rounded-lg bg-gray-900 py-3 text-sm font-bold text-yellow-400"
          >
            Chzzk로 로그인
          </a>
          <Link
            href="/"
            className="mt-4 block text-xs text-gray-500 hover:text-gray-700"
          >
            ← 메인으로 돌아가기
          </Link>
        </div>
      </main>
    </SiteBackground>
  )
}
