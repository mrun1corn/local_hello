import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.localchat.app',
  appName: 'LocalChat',
  webDir: 'out',
  server: {
    url: 'http://192.168.0.119:3000',
    cleartext: true
  }
};

export default config;
