#!/usr/bin/env node
// Run: node generate_icons.mjs
// Creates placeholder gold SVG icons for PWA

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, 'public', 'icons');
fs.mkdirSync(outDir, { recursive: true });

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="120" fill="#0f0f11"/>
  <text x="256" y="195" font-family="Georgia,serif" font-size="160"
        font-style="italic" fill="#e8c547" text-anchor="middle">S</text>
  <text x="256" y="340" font-family="Georgia,serif" font-size="90"
        fill="#7a7880" text-anchor="middle" letter-spacing="8">EKRA</text>
</svg>`;

fs.writeFileSync(path.join(outDir, 'icon.svg'), svg);
console.log('✅ public/icons/icon.svg written');
console.log('For PNG icons, install cairosvg (Python) and run the original generate_icons.py,');
console.log('or use any SVG→PNG converter. The SVG is at public/icons/icon.svg');
