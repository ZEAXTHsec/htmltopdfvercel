const chromium = require('@sparticuz/chromium-min');
const puppeteer = require('puppeteer-core');
const busboy = require('busboy');

// Remote chromium binary built for Vercel's Lambda environment
const CHROMIUM_REMOTE_URL =
  'https://github.com/Sparticuz/chromium/releases/download/v123.0.0/chromium-v123.0.0-pack.tar';

export const config = {
  api: {
    bodyParser: false,
  },
};

function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const bb = busboy({ headers: req.headers });
    let htmlContent = null;
    let originalName = 'output.pdf';

    bb.on('file', (fieldname, file, info) => {
      const { filename } = info;
      originalName = filename.replace(/\.html?$/i, '.pdf');
      const chunks = [];
      file.on('data', chunk => chunks.push(chunk));
      file.on('end', () => {
        htmlContent = Buffer.concat(chunks).toString('utf-8');
      });
    });

    bb.on('finish', () => {
      if (!htmlContent) return reject(new Error('No HTML file found in request'));
      resolve({ htmlContent, originalName });
    });

    bb.on('error', reject);
    req.pipe(bb);
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let htmlContent, originalName;

  try {
    ({ htmlContent, originalName } = await parseMultipart(req));
  } catch (err) {
    return res.status(400).json({ error: 'Failed to parse upload: ' + err.message });
  }

  let browser = null;

  try {
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: { width: 1280, height: 900 },
      executablePath: await chromium.executablePath(CHROMIUM_REMOTE_URL),
      headless: chromium.headless,
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });

    await page.setContent(htmlContent, { waitUntil: 'networkidle0' });

    await page.addStyleTag({
      content: `
        * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        @page { margin: 0; }
      `
    });

    const bodyHeight = await page.evaluate(() => document.body.scrollHeight);

    const pdfBuffer = await page.pdf({
      width: '1280px',
      height: `${bodyHeight}px`,
      printBackground: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
    });

    await browser.close();
    browser = null;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${originalName}"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    return res.status(200).send(pdfBuffer);

  } catch (err) {
    if (browser) await browser.close();
    return res.status(500).json({ error: err.message });
  }
};
