import type { ReactNode } from 'react'

// Fixed, light-frosted cover-art background for the web pages.
// Not used by the OBS widget route, which must stay transparent.
export default function SiteBackground({ children }: { children: ReactNode }) {
  return (
    <div className="relative min-h-screen">
      <div
        aria-hidden
        className="fixed inset-0 -z-10 bg-cover bg-center"
        style={{
          backgroundImage: 'url(/cover.jpg)',
          filter: 'blur(2px) brightness(1.15)',
          transform: 'scale(1.05)',
        }}
      />
      <div
        aria-hidden
        className="fixed inset-0 -z-10"
        style={{ background: 'rgba(248, 248, 250, 0.82)' }}
      />
      {children}
    </div>
  )
}
