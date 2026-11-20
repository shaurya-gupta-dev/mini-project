/**
 * Builds the AWS Lambda CommonJS bundle and self-contained CloudShell deploy archive
 * at dist-aws/aegis-aws-deploy.zip.
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

const INFRA_DIR = path.resolve('infra');
const LAMBDA_DIR = path.join(INFRA_DIR, 'lambda');
const DIST_AWS_DIR = path.resolve('dist-aws');
const STAGING_DIR = path.join(DIST_AWS_DIR, 'staging');
const ZIP_OUTPUT = path.join(DIST_AWS_DIR, 'aegis-aws-deploy.zip');

function ensureCleanDir(dirPath) {
  if (fs.existsSync(dirPath)) {
    fs.rmSync(dirPath, { recursive: true, force: true });
  }
  fs.mkdirSync(dirPath, { recursive: true });
}

function buildAwsBundle() {
  fs.mkdirSync(LAMBDA_DIR, { recursive: true });
  ensureCleanDir(STAGING_DIR);

  const lambdaOutFile = path.join(LAMBDA_DIR, 'telemetry_handler.js');

  console.log('[AWS Build] Compiling AWS Lambda handler to CommonJS...');
  execSync(
    `npx esbuild src/aws/telemetry_handler.ts --bundle --format=cjs --platform=node --target=node20 --external:@aws-sdk/client-dynamodb --outfile="${lambdaOutFile}"`,
    { stdio: 'inherit' }
  );

  // Prepare staging tree for CloudShell zip
  fs.mkdirSync(path.join(STAGING_DIR, 'lambda'), { recursive: true });
  fs.mkdirSync(path.join(STAGING_DIR, 'rule_packs'), { recursive: true });

  // Normalize CRLF -> LF on deploy.sh so bash inside AWS CloudShell executes cleanly
  const deployShSrc = fs.readFileSync(path.join(INFRA_DIR, 'deploy.sh'), 'utf8');
  fs.writeFileSync(path.join(STAGING_DIR, 'deploy.sh'), deployShSrc.replace(/\r\n/g, '\n'), 'utf8');

  fs.copyFileSync(
    path.join(INFRA_DIR, 'template.yaml'),
    path.join(STAGING_DIR, 'template.yaml')
  );
  fs.copyFileSync(
    lambdaOutFile,
    path.join(STAGING_DIR, 'lambda', 'telemetry_handler.js')
  );
  fs.copyFileSync(
    path.resolve('rule_packs/rules.v1.json'),
    path.join(STAGING_DIR, 'rule_packs', 'rules.v1.json')
  );
  fs.copyFileSync(
    path.resolve('rule_packs/rules.v1.json.sig'),
    path.join(STAGING_DIR, 'rule_packs', 'rules.v1.json.sig')
  );

  if (fs.existsSync(ZIP_OUTPUT)) {
    fs.unlinkSync(ZIP_OUTPUT);
  }

  console.log('[AWS Build] Packaging CloudShell deployment archive...');
  if (process.platform === 'win32') {
    execSync(
      `powershell -Command "Compress-Archive -Path '${STAGING_DIR}\\*' -DestinationPath '${ZIP_OUTPUT}' -Force"`,
      { stdio: 'inherit' }
    );
  } else {
    execSync(`cd "${STAGING_DIR}" && zip -r "${ZIP_OUTPUT}" ./*`, { stdio: 'inherit' });
  }

  const stats = fs.statSync(ZIP_OUTPUT);
  console.log(`[AWS Build] Ready: ${ZIP_OUTPUT} (${(stats.size / 1024).toFixed(1)} KB)`);
}

buildAwsBundle();

