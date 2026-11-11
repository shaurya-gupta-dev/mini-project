import * as fs from 'fs';
import * as path from 'path';

const distManifestPath = path.resolve('dist/manifest.json');
const rootManifestPath = path.resolve('manifest.json');

if (fs.existsSync(distManifestPath)) {
  const manifest = JSON.parse(fs.readFileSync(distManifestPath, 'utf8'));
  manifest.icons['16'] = 'dist/icons/icon-16.png';
  manifest.icons['48'] = 'dist/icons/icon-48.png';
  manifest.icons['128'] = 'dist/icons/icon-128.png';
  manifest.action.default_popup = 'dist/popup/popup.html';
  manifest.action.default_icon['16'] = 'dist/icons/icon-16.png';
  manifest.action.default_icon['48'] = 'dist/icons/icon-48.png';
  manifest.action.default_icon['128'] = 'dist/icons/icon-128.png';
  manifest.background.service_worker = 'dist/background.js';
  if (manifest.options_page) {
    manifest.options_page = 'dist/dashboard/dashboard.html';
  }
  
  if (Array.isArray(manifest.content_scripts)) {
    for (const cs of manifest.content_scripts) {
      if (Array.isArray(cs.js)) {
        cs.js = cs.js.map((file) => 'dist/' + file);
      }
    }
  }

  if (Array.isArray(manifest.web_accessible_resources)) {
    for (const war of manifest.web_accessible_resources) {
      if (Array.isArray(war.resources)) {
        war.resources = war.resources.map((file) => 'dist/' + file);
      }
    }
  }

  fs.writeFileSync(rootManifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log('[AegisLLM] Synchronized root manifest.json successfully.');
}
