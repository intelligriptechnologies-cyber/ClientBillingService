import type { MetadataRoute } from 'next';

// Mirrors --accent and --canvas in globals.css. e2e/pwa.spec.ts fails if they drift.
const THEME_COLOR = '#11756c';
const BACKGROUND_COLOR = '#f4f7f6';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Ledgerly | Tenant Billing',
    short_name: 'Ledgerly',
    description: 'A multi-tenant billing workspace for customers, contracts, and invoices.',
    start_url: '/',
    display: 'standalone',
    theme_color: THEME_COLOR,
    background_color: BACKGROUND_COLOR,
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
