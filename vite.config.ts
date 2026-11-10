// vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { execSync } from 'node:child_process';

function getBuildSha(): string {
  if (process.env.NODE_ENV !== 'production') return 'dev';
  const ciSha =
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.COMMIT_REF ||
    process.env.CF_PAGES_COMMIT_SHA;
  if (ciSha) return ciSha.slice(0, 7);
  try {
    return execSync('git rev-parse --short=7 HEAD').toString().trim();
  } catch {
    return 'dev';
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __LUMON_BUILD__: JSON.stringify(getBuildSha()),
  },
});