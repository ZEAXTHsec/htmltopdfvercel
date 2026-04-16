const chromium = require('@sparticuz/chromium-min');
const puppeteer = require('puppeteer-core');
const busboy = require('busboy');

// v131 matches puppeteer-core@22.x — verified to work on Vercel Lambda
const CHROMIUM_REMOTE_URL =
  'https://github.com/Sparticuz/chromium/releases/download/v131.0.1/chromium-v131.0.1-pack.tar';

// CommonJS config export — must NOT use ESM "export" syntax
module.exports.config = {
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
    const executablePath = await chromium.executablePath(CHROMIUM_REMOTE_URL);

    browser = await puppeteer.launch({
      args: [
        ...chromium.args,
        '--disable-dev-shm-usage',
        '--no-sandbox',
        '--disable-setuid-sandbox',
      ],
      defaultViewport: { width: 1280, height: 900 },
      executablePath,
      headless: 'new',
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });

    await page.setContent(htmlContent, { waitUntil: 'networkidle0', timeout: 30000 });

    await page.addStyleTag({
      content: `
        * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        @page { margin: 0; }
        body { margin: 0; padding: 0; }
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
    if (browser) {
      try { await browser.close(); } catch (_) {}
    }
    return res.status(500).json({ error: err.message });
  }
};
