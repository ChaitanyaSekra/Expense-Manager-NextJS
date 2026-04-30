/** @type {import('next').NextConfig} */

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: ['192.168.0.167'],
  allowedDevOrigins: ['192.168.1.23'],
  allowedDevOrigins: ['192.168.0.167']
};

// ── Inject deploy version into sw.js at build time ───────────────────────────
// Vercel sets VERCEL_GIT_COMMIT_SHA on every deploy.
// Locally it falls back to a timestamp so you still get cache-busting in dev.
const version =
  process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 8) ||
  Date.now().toString(36);

const swPath = resolve(process.cwd(), 'public', 'sw.js');

try {
  const original = readFileSync(swPath, 'utf8');
  // Replace the placeholder — also handles the case where a previous build
  // already baked in a real SHA (pattern: sekra-[a-z0-9]+)
  const updated = original.replace(
    /sekra-(?:__SEKRA_VERSION__|[a-z0-9]+)/g,
    `sekra-${version}`
  );
  writeFileSync(swPath, updated, 'utf8');
  console.log(`[next.config] SW cache version → sekra-${version}`);
} catch (e) {
  console.warn('[next.config] Could not patch sw.js:', e.message);
}

export default nextConfig;
