#!/usr/bin/env node

import { promises as fs } from 'fs';
import path from 'path';
import { rimraf } from 'rimraf';

// Parse command line arguments
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const VERBOSE = args.includes('--verbose');

// Configuration - use the same paths as in fetch-content.mts
const CONTENT_DIR = path.join(process.cwd(), 'content');
const PUBLIC_DIR = path.join(process.cwd(), 'public');
const LOCAL_BLOG_DIR = path.join(CONTENT_DIR, 'blogs');
const LOCAL_BLOG_IMAGES_DIR = path.join(PUBLIC_DIR, 'blog');

/**
 * Checks if a directory exists
 */
async function directoryExists(directory: string): Promise<boolean> {
  try {
    const stats = await fs.stat(directory);
    return stats.isDirectory();
  } catch (error) {
    return false;
  }
}

/**
 * Removes a directory and all its contents
 */
async function removeDirectory(directory: string): Promise<void> {
  if (DRY_RUN) {
    console.log(`[DRY RUN] Would remove directory: ${directory}`);
    return;
  }

  try {
    await rimraf(directory);
    console.log(`Removed directory: ${directory}`);
  } catch (error) {
    console.error(`Error removing directory ${directory}:`, error);
    throw error;
  }
}

/**
 * Cleans up the blog content and images
 */
async function cleanupContent(): Promise<void> {
  console.log('Starting content cleanup...');
  if (DRY_RUN) {
    console.log('*** DRY RUN MODE - No files will be deleted ***');
  }

  try {
    // Check and clean up blog directory
    if (await directoryExists(LOCAL_BLOG_DIR)) {
      console.log(`Found blog directory: ${LOCAL_BLOG_DIR}`);
      await removeDirectory(LOCAL_BLOG_DIR);
    } else if (VERBOSE) {
      console.log(`Blog directory does not exist: ${LOCAL_BLOG_DIR}`);
    }

    // Check and clean up blog images directory
    if (await directoryExists(LOCAL_BLOG_IMAGES_DIR)) {
      console.log(`Found blog images directory: ${LOCAL_BLOG_IMAGES_DIR}`);
      await removeDirectory(LOCAL_BLOG_IMAGES_DIR);
    } else if (VERBOSE) {
      console.log(`Blog images directory does not exist: ${LOCAL_BLOG_IMAGES_DIR}`);
    }

    console.log('Content cleanup completed successfully!');
  } catch (error) {
    console.error('Error during cleanup:', error);
    process.exit(1);
  }
}

// Run the script
cleanupContent();