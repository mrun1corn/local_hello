export default function manifest() {
  return {
    name: 'LocalHello Chat',
    short_name: 'LocalHello',
    description: 'Privacy-focused local-first chat application',
    start_url: '/',
    display: 'standalone',
    background_color: '#111827',
    theme_color: '#2563eb',
    icons: [
      {
        src: '/globe.svg',
        sizes: 'any',
        type: 'image/svg+xml',
      },
      {
        src: '/window.svg',
        sizes: '192x192',
        type: 'image/png',
      },
    ],
  }
}
