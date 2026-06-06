import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { verifySessionCookie } from '@/lib/session'
import DashboardPage from '@/components/DashboardPage'

export default async function Dashboard() {
  const session = (await cookies()).get('session')?.value
  if (!session || !verifySessionCookie(session)) {
    redirect('/login?next=/dashboard')
  }
  return <DashboardPage />
}
