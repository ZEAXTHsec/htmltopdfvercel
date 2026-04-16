const chromium = require('@sparticuz/chromium');
const puppeteer = require('puppeteer-core');
const busboy = require('busboy');

// Disable Vercel's default body parser so we can handle multipart
export const config = {
  api: {
    bodyParser: false,
  },
};

// Parse multipart form data and extract the HTML file buffer
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
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });

    // Load HTML directly from string — no file system needed
    await page.setContent(htmlContent, { waitUntil: 'networkidle0' });

    // Force exact color reproduction and zero margins
    await page.addStyleTag({
      content: `
        * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        @page { margin: 0; }
      `
    });

    // Measure full rendered height for single-page PDF
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
