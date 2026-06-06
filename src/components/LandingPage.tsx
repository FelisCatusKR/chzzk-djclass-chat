import Link from 'next/link'
import SiteBackground from '@/components/SiteBackground'

const FROSTED =
  'rounded-2xl border border-white/90 bg-white/70 shadow-lg backdrop-blur-md'

export default function LandingPage() {
  return (
    <SiteBackground>
      <main className="flex min-h-screen flex-col items-center justify-center px-4 py-8 sm:py-12">
        <div className="w-full max-w-3xl space-y-8 text-center">
          <div className="space-y-2">
            <h1 className="text-4xl font-bold text-gray-900">
              Chzzk DJ CLASS 채팅 위젯
            </h1>
            <p className="text-lg text-gray-600">
              V-ARCHIVE의 DJ CLASS를 채팅에 표시하는 OBS 위젯 서비스입니다.
            </p>
          </div>

          <div className="flex flex-col gap-5 md:flex-row">
            <Link
              href="/dashboard"
              className={`${FROSTED} flex-1 p-7 text-center transition-transform hover:-translate-y-1`}
            >
              <div className="mb-2 text-4xl">🎛️</div>
              <span className="mb-3 inline-block rounded-full bg-gray-900 px-3 py-1 text-xs font-bold tracking-wide text-yellow-400">
                STREAMER
              </span>
              <h2 className="mb-2 text-xl font-bold text-gray-900">
                스트리머이신가요?
              </h2>
              <p className="mb-5 min-h-[3rem] text-sm leading-relaxed text-gray-600">
                내 채팅에 시청자들의 DJ CLASS 뱃지를 표시하는 위젯을 OBS에
                추가하려면 이 쪽을 클릭해주세요.
              </p>
              <span className="block rounded-lg bg-gray-900 py-3 text-sm font-bold text-yellow-400">
                채팅 위젯 얻기 →
              </span>
            </Link>

            <Link
              href="/link"
              className={`${FROSTED} flex-1 p-7 text-center transition-transform hover:-translate-y-1`}
            >
              <div className="mb-2 text-4xl">🎧</div>
              <span className="mb-3 inline-block rounded-full bg-yellow-400 px-3 py-1 text-xs font-bold tracking-wide text-gray-900">
                VIEWER
              </span>
              <h2 className="mb-2 text-xl font-bold text-gray-900">
                시청자이신가요?
              </h2>
              <p className="mb-5 min-h-[3rem] text-sm leading-relaxed text-gray-600">
                스트리머의 채팅에서 DJ CLASS를 연동하려면 이 쪽을 클릭해주세요.
              </p>
              <span className="block rounded-lg bg-yellow-500 py-3 text-sm font-bold text-gray-900">
                DJ CLASS 연동하기 →
              </span>
            </Link>
          </div>

          <footer className="space-y-2 pt-8 text-sm text-gray-500">
            <div>
              Special Thanks to{' '}
              <a
                href="https://chzzk.naver.com/1906dd57f578c255feca54700bcccfc9"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-gray-700"
              >
                똘똘똘이 님
              </a>
            </div>
            <a
              href="https://github.com/FelisCatusKR/chzzk-djclass-chat"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-gray-700"
            >
              GitHub
            </a>
            <p className="pt-2 text-xs text-gray-400">
              본 프로젝트는 DJMAX RESPECT V와 공식적인 연관이 없는 비공식 팬
              프로젝트입니다.
            </p>
          </footer>
        </div>
      </main>
    </SiteBackground>
  )
}
