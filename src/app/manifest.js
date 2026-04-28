export default function manifest() {
  return {
    name: 'LocalHello Chat',
    short_name: 'LocalHello',
    description: 'Privacy-focused real-time chat application',
    start_url: '/',
    display: 'standalone',
    background_color: '#111827',
    theme_color: '#2563eb',
    icons: [
      {
        src: '/next.svg',
        sizes: '512x512',
        type: 'image/svg+xml',
        purpose: 'any maskable',
      },
    ],
  }
}