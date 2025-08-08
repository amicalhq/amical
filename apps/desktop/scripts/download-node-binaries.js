#!/usr/bin/env node

const https = require('https');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { createWriteStream, mkdirSync, chmodSync } = fs;

// Node.js version to download
const NODE_VERSION = '24.4.0';

// Platform configurations
const PLATFORMS = [
  {
    platform: 'darwin',
    arch: 'arm64',
    url: `https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-darwin-arm64.tar.gz`,
    binary: 'bin/node'
  },
  {
    platform: 'darwin',
    arch: 'x64',
    url: `https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-darwin-x64.tar.gz`,
    binary: 'bin/node'
  },
  {
    platform: 'win32',
    arch: 'x64',
    url: `https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-win-x64.zip`,
    binary: 'node.exe'
  },
  {
    platform: 'linux',
    arch: 'x64',
    url: `https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.gz`,
    binary: 'bin/node'
  }
];

// Base directory for binaries
const RESOURCES_DIR = path.join(__dirname, '..', 'node-binaries');

async function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(dest);
    
    https.get(url, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        // Handle redirect
        https.get(response.headers.location, (redirectResponse) => {
          redirectResponse.pipe(file);
          file.on('finish', () => {
            file.close(resolve);
          });
        }).on('error', reject);
      } else {
        response.pipe(file);
        file.on('finish', () => {
          file.close(resolve);
        });
      }
    }).on('error', reject);
  });
}

async function extractArchive(archivePath, platform) {
  const tempDir = path.join(path.dirname(archivePath), 'temp');
  mkdirSync(tempDir, { recursive: true });

  if (platform === 'win32') {
    // Use unzip command (available on macOS) to extract zip files
    execSync(`unzip -q "${archivePath}" -d "${tempDir}"`, { stdio: 'inherit' });
  } else {
    // Use tar for Unix-like systems
    execSync(`tar -xzf "${archivePath}" -C "${tempDir}"`, { stdio: 'inherit' });
  }

  return tempDir;
}

async function downloadNodeBinary(config) {
  const { platform, arch, url, binary } = config;
  const platformDir = path.join(RESOURCES_DIR, `${platform}-${arch}`);
  const binaryPath = path.join(platformDir, platform === 'win32' ? 'node.exe' : 'node');

  // Skip if already exists
  if (fs.existsSync(binaryPath)) {
    console.log(`✓ ${platform}-${arch} binary already exists`);
    return;
  }

  console.log(`Downloading Node.js for ${platform}-${arch}...`);
  
  // Create directory
  mkdirSync(platformDir, { recursive: true });

  // Download archive
  const archiveExt = platform === 'win32' ? '.zip' : '.tar.gz';
  const archivePath = path.join(platformDir, `node-v${NODE_VERSION}${archiveExt}`);
  
  try {
    await downloadFile(url, archivePath);
    console.log(`Downloaded archive for ${platform}-${arch}`);

    // Extract archive
    const tempDir = await extractArchive(archivePath, platform);
    
    // Find the node binary in extracted files
    // Windows uses different directory naming convention (win instead of win32)
    const extractedDirName = platform === 'win32' 
      ? `node-v${NODE_VERSION}-win-${arch}`
      : `node-v${NODE_VERSION}-${platform}-${arch}`;
    const extractedBinaryPath = path.join(tempDir, extractedDirName, binary);
    
    // Copy binary to final location
    fs.copyFileSync(extractedBinaryPath, binaryPath);
    
    // Make executable on Unix-like systems
    if (platform !== 'win32') {
      chmodSync(binaryPath, '755');
    }

    // Clean up
    fs.rmSync(tempDir, { recursive: true, force: true });
    fs.unlinkSync(archivePath);

    console.log(`✓ Successfully installed ${platform}-${arch} binary`);
  } catch (error) {
    console.error(`✗ Failed to download ${platform}-${arch}:`, error.message);
    // Clean up on failure
    if (fs.existsSync(archivePath)) {
      fs.unlinkSync(archivePath);
    }
  }
}

async function main() {
  console.log(`Downloading Node.js v${NODE_VERSION} binaries for all platforms...\n`);

  // Create base directory
  mkdirSync(RESOURCES_DIR, { recursive: true });

  // Download binaries for all platforms
  for (const platform of PLATFORMS) {
    await downloadNodeBinary(platform);
  }

  console.log('\nDone! Node.js binaries downloaded to:', RESOURCES_DIR);
}

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { downloadNodeBinary, PLATFORMS, NODE_VERSION };