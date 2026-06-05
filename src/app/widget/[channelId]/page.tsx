// src/app/widget/[channelId]/page.tsx
import WidgetPage from '@/components/WidgetPage'

interface PageProps {
  params: Promise<{ channelId: string }>
}

export default async function Widget({ params }: PageProps) {
  const { channelId } = await params
  return <WidgetPage channelId={channelId} />
}
