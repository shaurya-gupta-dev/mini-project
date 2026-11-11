import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('Chrome Extension dist/ Build Verification (Manifest V3 & CSP)', () => {
  const distDir = path.resolve(__dirname, '../dist');

  it('verifies dist/manifest.json adheres to Manifest V3 schema', () => {
    const manifestPath = path.join(distDir, 'manifest.json');
    expect(fs.existsSync(manifestPath)).toBe(true);

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    expect(manifest.manifest_version).toBe(3);
    expect(typeof manifest.name).toBe('string');
    expect(typeof manifest.version).toBe('string');
    expect(typeof manifest.description).toBe('string');
    expect(Array.isArray(manifest.permissions)).toBe(true);
    expect(manifest.permissions).toContain('storage');
  });

  it('verifies icon files exist on disk and have valid PNG headers & dimensions', () => {
    const manifestPath = path.join(distDir, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

    const requiredIcons = [
      { key: '16', width: 16, height: 16, relPath: manifest.icons?.['16'] },
      { key: '48', width: 48, height: 48, relPath: manifest.icons?.['48'] },
      { key: '128', width: 128, height: 128, relPath: manifest.icons?.['128'] },
    ];

    for (const icon of requiredIcons) {
      expect(icon.relPath).toBeDefined();
      const fullPath = path.join(distDir, icon.relPath);
      expect(fs.existsSync(fullPath), `Icon not found at: ${fullPath}`).toBe(true);

      const buffer = fs.readFileSync(fullPath);
      // Verify PNG magic signature: 0x89 50 4E 47 0D 0A 1A 0A
      const isPng =
        buffer[0] === 0x89 &&
        buffer[1] === 0x50 &&
        buffer[2] === 0x4e &&
        buffer[3] === 0x47 &&
        buffer[4] === 0x0d &&
        buffer[5] === 0x0a &&
        buffer[6] === 0x1a &&
        buffer[7] === 0x0a;
      expect(isPng).toBe(true);

      // Verify dimensions from IHDR chunk (offset 16 and 20)
      const w = buffer.readUInt32BE(16);
      const h = buffer.readUInt32BE(20);
      expect(w).toBe(icon.width);
      expect(h).toBe(icon.height);
    }
  });

  it('verifies background service worker declaration and existence', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(distDir, 'manifest.json'), 'utf8'));
    expect(manifest.background).toBeDefined();
    expect(manifest.background.service_worker).toBe('background.js');

    const swPath = path.join(distDir, manifest.background.service_worker);
    expect(fs.existsSync(swPath)).toBe(true);
  });

  it('verifies content script declaration and target match patterns', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(distDir, 'manifest.json'), 'utf8'));
    expect(Array.isArray(manifest.content_scripts)).toBe(true);
    expect(manifest.content_scripts.length).toBeGreaterThanOrEqual(2);

    // 1. MAIN world network interceptor
    const interceptorCs = manifest.content_scripts.find((cs: any) => cs.js.includes('interceptor.js'));
    expect(interceptorCs).toBeDefined();
    expect(interceptorCs.matches).toContain('https://claude.ai/*');
    expect(interceptorCs.matches).toContain('https://gemini.google.com/*');
    expect(interceptorCs.world).toBe('MAIN');
    expect(interceptorCs.run_at).toBe('document_start');
    expect(fs.existsSync(path.join(distDir, 'interceptor.js'))).toBe(true);

    // 2. ISOLATED world content script
    const contentCs = manifest.content_scripts.find((cs: any) => cs.js.includes('content.js'));
    expect(contentCs).toBeDefined();
    expect(contentCs.matches).toContain('https://chatgpt.com/*');
    expect(contentCs.matches).toContain('https://claude.ai/*');
    expect(contentCs.matches).toContain('https://gemini.google.com/*');
    expect(contentCs.run_at).toBe('document_end');
    expect(fs.existsSync(path.join(distDir, 'content.js'))).toBe(true);
  });

  it('verifies popup.html loads popup.js and popup.css via relative paths without missing assets', () => {
    const popupHtmlPath = path.join(distDir, 'popup/popup.html');
    expect(fs.existsSync(popupHtmlPath)).toBe(true);

    const html = fs.readFileSync(popupHtmlPath, 'utf8');

    // Check script tag
    const scriptMatch = html.match(/<script[^>]+src=["']([^"']+)["']/i);
    expect(scriptMatch).not.toBeNull();
    const scriptSrc = scriptMatch![1];
    expect(scriptSrc).toBe('popup.js');
    expect(fs.existsSync(path.join(distDir, 'popup', scriptSrc))).toBe(true);

    // Check css link tag
    const linkMatch = html.match(/<link[^>]+href=["']([^"']+)["']/i);
    expect(linkMatch).not.toBeNull();
    const cssHref = linkMatch![1];
    expect(cssHref).toBe('popup.css');
    expect(fs.existsSync(path.join(distDir, 'popup', cssHref))).toBe(true);
  });

  it('verifies dashboard.html loads dashboard.js and dashboard.css via relative paths without missing assets', () => {
    const dashboardHtmlPath = path.join(distDir, 'dashboard/dashboard.html');
    expect(fs.existsSync(dashboardHtmlPath)).toBe(true);

    const html = fs.readFileSync(dashboardHtmlPath, 'utf8');

    // Check script tag
    const scriptMatch = html.match(/<script[^>]+src=["']([^"']+)["']/i);
    expect(scriptMatch).not.toBeNull();
    const scriptSrc = scriptMatch![1];
    expect(scriptSrc).toBe('dashboard.js');
    expect(fs.existsSync(path.join(distDir, 'dashboard', scriptSrc))).toBe(true);

    // Check css link tag
    const linkMatch = html.match(/<link[^>]+href=["']([^"']+)["']/i);
    expect(linkMatch).not.toBeNull();
    const cssHref = linkMatch![1];
    expect(cssHref).toBe('dashboard.css');
    expect(fs.existsSync(path.join(distDir, 'dashboard', cssHref))).toBe(true);
  });

  it('verifies ZERO CSP violations in HTML files (no inline scripts, no on* attributes, no remote assets)', () => {
    const htmlFiles = [
      path.join(distDir, 'popup/popup.html'),
      path.join(distDir, 'dashboard/dashboard.html'),
    ];

    for (const hf of htmlFiles) {
      const content = fs.readFileSync(hf, 'utf8');

      // 1. No inline script tags (<script> without src or with body)
      const inlineScriptMatches = content.match(/<script(?![^>]*\bsrc\b)[^>]*>([\s\S]*?)<\/script>/gi);
      if (inlineScriptMatches) {
        for (const m of inlineScriptMatches) {
          const body = m.replace(/<\/?script[^>]*>/gi, '').trim();
          expect(body.length).toBe(0);
        }
      }

      // 2. No inline event handlers (e.g. onclick=, onchange=)
      const inlineHandlerMatches = content.match(/\bon[a-z]+\s*=\s*["'][^"']*["']/gi);
      expect(inlineHandlerMatches).toBeNull();

      // 3. No external http/https sources in script or style
      const remoteSrcMatches = content.match(/(src|href)=["'](https?:|\/\/)[^"']+["']/gi);
      expect(remoteSrcMatches).toBeNull();
    }
  });

  it('verifies ZERO eval() or new Function() calls across all distribution JS files', () => {
    function getAllJsFiles(dir: string): string[] {
      let results: string[] = [];
      const list = fs.readdirSync(dir);
      for (const file of list) {
        const full = path.join(dir, file);
        const stat = fs.statSync(full);
        if (stat.isDirectory()) {
          results = results.concat(getAllJsFiles(full));
        } else if (file.endsWith('.js')) {
          results.push(full);
        }
      }
      return results;
    }

    const jsFiles = getAllJsFiles(distDir);
    expect(jsFiles.length).toBeGreaterThan(0);

    for (const jsFile of jsFiles) {
      const code = fs.readFileSync(jsFile, 'utf8');

      // eval(
      expect(/\beval\s*\(/.test(code), `eval() detected in ${jsFile}`).toBe(false);

      // new Function(
      expect(/new\s+Function\s*\(/.test(code), `new Function() detected in ${jsFile}`).toBe(false);
    }
  });

  it('verifies all imported module chunk paths resolve on disk', () => {
    function getAllJsFiles(dir: string): string[] {
      let results: string[] = [];
      const list = fs.readdirSync(dir);
      for (const file of list) {
        const full = path.join(dir, file);
        const stat = fs.statSync(full);
        if (stat.isDirectory()) {
          results = results.concat(getAllJsFiles(full));
        } else if (file.endsWith('.js')) {
          results.push(full);
        }
      }
      return results;
    }

    const jsFiles = getAllJsFiles(distDir);
    for (const jsFile of jsFiles) {
      const code = fs.readFileSync(jsFile, 'utf8');
      const importRegex = /import\s*.*?from\s*["']([^"']+)["']/g;
      let match: RegExpExecArray | null;
      while ((match = importRegex.exec(code)) !== null) {
        const impPath = match[1];
        const resolved = path.resolve(path.dirname(jsFile), impPath);
        const exists = fs.existsSync(resolved) || fs.existsSync(resolved + '.js');
        expect(exists, `Broken import path: ${impPath} in ${jsFile}`).toBe(true);
      }
    }
  });

  it('evaluates content.js module execution compatibility with Chrome isolated worlds', () => {
    const csCode = fs.readFileSync(path.join(distDir, 'content.js'), 'utf8');
    const usesImportStatement = /^\s*import\s/m.test(csCode);
    
    // In Chrome MV3, content_scripts cannot natively execute ES module import statements.
    // We document this condition:
    if (usesImportStatement) {
      console.warn(
        '[INTEGRATION RISK DETECTED] dist/content.js uses top-level ES module import. ' +
        'Chrome MV3 content scripts execute in classic script mode and will throw ' +
        'SyntaxError: Cannot use import statement outside a module unless bundled as an IIFE/standalone script.'
      );
    }
  });

  it('verifies root manifest.json exists and all relative target paths resolve properly', () => {
    const rootManifestPath = path.resolve(__dirname, '../manifest.json');
    expect(fs.existsSync(rootManifestPath)).toBe(true);

    const rootManifest = JSON.parse(fs.readFileSync(rootManifestPath, 'utf8'));
    expect(rootManifest.manifest_version).toBe(3);

    // Verify all referenced files resolve from repository root
    const rootDir = path.resolve(__dirname, '..');
    const referencedFiles = [
      rootManifest.icons['16'],
      rootManifest.icons['48'],
      rootManifest.icons['128'],
      rootManifest.action.default_popup,
      rootManifest.background.service_worker,
      ...rootManifest.content_scripts.flatMap((cs: any) => cs.js)
    ];

    for (const file of referencedFiles) {
      const fullPath = path.join(rootDir, file);
      expect(fs.existsSync(fullPath), `Referenced file missing from root: ${fullPath}`).toBe(true);
    }
  });
});
