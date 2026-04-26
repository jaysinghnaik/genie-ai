import express from 'express';
import { chromium } from 'playwright';
import bodyParser from 'body-parser';

const app = express();
const PORT = process.env.PORT || 7860; // HF Spaces default port

app.use(bodyParser.json({ limit: '100mb' }));

app.post('/render-pdf', async (req, res) => {
  const { html, width = 1920, height = 1080, delay = 2000 } = req.body;

  if (!html) return res.status(400).send('HTML required');

  let browser;
  try {
    browser = await chromium.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const context = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: 2
    });

    const page = await context.newPage();
    await page.setContent(html, { waitUntil: 'networkidle' });
    await page.emulateMedia({ media: 'screen' });

    if (delay > 0) await page.waitForTimeout(delay);

    const pdfBuffer = await page.pdf({
      printBackground: true,
      width: `${width}px`,
      height: `${height}px`,
      margin: { top: 0, right: 0, bottom: 0, left: 0 }
    });

    res.contentType('application/pdf');
    res.send(pdfBuffer);
  } catch (e) {
    console.error(e);
    res.status(500).send(e.message);
  } finally {
    if (browser) await browser.close();
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Worker listening on port ${PORT}`);
});
