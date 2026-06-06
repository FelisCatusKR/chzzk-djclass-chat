// src/app/link/page.tsx
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { verifySessionCookie } from '@/lib/session'
import LinkPage from '@/components/LinkPage'

export default async function Link() {
  const session = (await cookies()).get('session')?.value
  if (!session || !verifySessionCookie(session)) {
    redirect('/login?next=/link')
  }
  return <LinkPage />
}
