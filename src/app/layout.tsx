import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Chzzk DJ CLASS 채팅 위젯',
  description: 'V-ARCHIVE의 DJ CLASS를 채팅에 표시하는 OBS 위젯 서비스',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  )
}
