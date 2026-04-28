import os from 'os';

function getLocalIPs() {
  const interfaces = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        ips.push(iface.address);
      }
    }
  }
  return ips;
}

const localIPs = getLocalIPs();

/** @type {import('next').NextConfig} */
const nextConfig = {
  // output: 'export', // Commented out to restore API routes for full feature testing
  images: {
    unoptimized: true,
  },
  allowedDevOrigins: localIPs,
  // Note: serverActions config varies by Next.js version
};

export default nextConfig;
