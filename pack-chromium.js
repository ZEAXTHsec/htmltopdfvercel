/**
 * postinstall script — runs at Vercel build time.
 * Packages the Chromium brotli files from @sparticuz/chromium
 * into public/chromium-pack.tar so the serverless function
 * can load it from a relative URL instead of downloading from GitHub.
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const chromiumDir = path.dirname(require.resolve('@sparticuz/chromium'));
const binDir = path.join(chromiumDir, 'bin');
const publicDir = path.join(__dirname, '..', 'public');
const outTar = path.join(publicDir, 'chromium-pack.tar');

if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}

if (fs.existsSync(outTar)) {
  console.log('chromium-pack.tar already exists, skipping.');
  process.exit(0);
}

if (!fs.existsSync(binDir)) {
  console.error('Could not find @sparticuz/chromium bin dir at', binDir);
  process.exit(1);
}

console.log('Packing Chromium brotli files into public/chromium-pack.tar ...');
execSync(`tar -cf "${outTar}" -C "${binDir}" .`, { stdio: 'inherit' });
console.log('Done. chromium-pack.tar created at', outTar);
