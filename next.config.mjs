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
  allowedDevOrigins: localIPs,
  serverActions: {
    allowedOrigins: ['localhost:3000', ...localIPs.map(ip => `${ip}:3000`)],
  },
};

export default nextConfig;
