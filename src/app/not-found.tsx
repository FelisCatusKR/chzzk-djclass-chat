import SiteBackground from '@/components/SiteBackground'

export default function NotFound() {
  return (
    <SiteBackground>
      <div className="flex min-h-screen items-center justify-center px-4 py-8 sm:py-12">
        <div className="text-center">
          <h1 className="mb-4 text-4xl font-bold text-gray-900">404</h1>
          <p className="text-gray-600">페이지를 찾을 수 없습니다.</p>
        </div>
      </div>
    </SiteBackground>
  )
}
