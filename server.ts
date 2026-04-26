import express from 'express';
import { createServer as createViteServer } from 'vite';
import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';
import bodyParser from 'body-parser';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Increase payload limit for large HTML presentations
  app.use(bodyParser.json({ limit: '100mb' }));

  // API Route: Render PDF using Playwright (High Fidelity)
  app.post('/api/render-pdf', async (req, res) => {
    const { html, width = 1920, height = 1080, delay = 4000, theme = 'dark' } = req.body;

    if (!html) {
      return res.status(400).json({ error: 'No HTML content provided' });
    }

    let browser;
    try {
      console.log('Launching Playwright Chromium...');
      browser = await chromium.launch({
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });

      const context = await browser.newContext({
        viewport: { width, height },
        deviceScaleFactor: 2, // High DPI for crisp text/icons
        colorScheme: theme === 'dark' ? 'dark' : 'light'
      });

      const page = await context.newPage();
      
      // Load the HTML content with networkidle to ensure CDNs are loaded
      console.log('Setting page content and waiting for stability...');
      await page.setContent(html, { waitUntil: 'networkidle' });

      // Emulate media to ensure colors are preserved as they appear on screen
      await page.emulateMedia({ media: 'screen' });

      // Artificial delay for specific motion-based animations if requested
      if (delay > 0) {
        console.log(`Waiting ${delay}ms for specific animations...`);
        await page.waitForTimeout(delay);
      }

      console.log('Generating High-Fidelity PDF...');
      const pdfBuffer = await page.pdf({
        printBackground: true,
        width: `${width}px`,
        height: `${height}px`,
        margin: { top: 0, right: 0, bottom: 0, left: 0 },
        scale: 1,
        preferCSSPageSize: true
      });

      res.contentType('application/pdf');
      res.send(pdfBuffer);
      console.log('PDF generated successfully.');
    } catch (error: any) {
      console.error('Playwright Error:', error);
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
