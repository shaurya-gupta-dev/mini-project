/**
 * AegisLLM Extension Packager
 * Bundles the production dist/ artifacts into a distributable zip file:
 * dist/aegis-llm-v1.0.0.zip
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

const DIST_DIR = path.resolve('dist');
const ZIP_OUTPUT = path.join(DIST_DIR, 'aegis-llm-v1.0.0.zip');

function packExtension() {
  if (!fs.existsSync(DIST_DIR)) {
    throw new Error('dist directory does not exist. Run "npm run build" first.');
  }

  // Remove existing zip if present
  if (fs.existsSync(ZIP_OUTPUT)) {
    fs.unlinkSync(ZIP_OUTPUT);
  }

  console.log('[Packager] Compressing dist/ into aegis-llm-v1.0.0.zip...');

  // Use PowerShell Compress-Archive on Windows or zip on Unix
  if (process.platform === 'win32') {
    // Exclude any temporary files or existing archives
    const psCmd = `powershell -Command "Compress-Archive -Path '${DIST_DIR}\\*' -DestinationPath '${ZIP_OUTPUT}' -Force"`;
    execSync(psCmd, { stdio: 'inherit' });
  } else {
    execSync(`cd "${DIST_DIR}" && zip -r "${ZIP_OUTPUT}" ./*`, { stdio: 'inherit' });
  }

  if (fs.existsSync(ZIP_OUTPUT)) {
    const stats = fs.statSync(ZIP_OUTPUT);
    console.log(`[Packager] Successfully generated ${ZIP_OUTPUT} (${(stats.size / 1024).toFixed(1)} KB)`);
  } else {
    throw new Error('Failed to create extension zip package.');
  }
}

packExtension();

