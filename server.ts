import express from 'express';
import { createServer as createViteServer } from 'vite';
import puppeteer from 'puppeteer';
import path from 'path';
import { fileURLToPath } from 'url';
import bodyParser from 'body-parser';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Increase payload limit for large HTML presentations
  app.use(bodyParser.json({ limit: '50mb' }));

  // API Route: Render PDF using Puppeteer
  app.post('/api/render-pdf', async (req, res) => {
    const { html, width = 1920, height = 1080, delay = 4000 } = req.body;

    if (!html) {
      return res.status(400).json({ error: 'No HTML content provided' });
    }

    let browser;
    try {
      console.log('Launching Puppeteer...');
      browser = await puppeteer.launch({
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
        headless: true
      });

      const page = await browser.newPage();
      
      // Set viewport to the requested presentation aspect ratio
      await page.setViewport({ width, height });

      // Load the HTML content
      console.log('Setting page content...');
      await page.setContent(html, { waitUntil: 'networkidle0' });

      // Step D: The Delay - Wait for animations to finish
      console.log(`Waiting ${delay}ms for animations...`);
      await new Promise(resolve => setTimeout(resolve, delay));

      // Step E: Print to PDF
      console.log('Generating PDF...');
      const pdfBuffer = await page.pdf({
        printBackground: true,
        width: `${width}px`,
        height: `${height}px`,
        pageRanges: '1', // We assume one long page or it handles pagination
        preferCSSPageSize: true
      });

      res.contentType('application/pdf');
      res.send(pdfBuffer);
      console.log('PDF sent successfully.');
    } catch (error: any) {
      console.error('Puppeteer Error:', error);
      res.status(500).json({ error: error.message || 'Failed to generate PDF' });
    } finally {
      if (browser) await browser.close();
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    // Serve static files in production
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
