#!/usr/bin/env node

// Load environment variables from .env files
import * as dotenv from "dotenv";
import path from "path";
import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { createWriteStream, promises as fs } from "fs";
import { pipeline } from "stream/promises";

// Configure dotenv to load environment variables
dotenv.config();

// Parse command line arguments
const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const SKIP_ERRORS = args.includes("--skip-errors");

// Log environment variables for debugging
console.log("AWS Credentials:", {
  accessKeyId: process.env.AWS_ACCESS_KEY_ID ? "****" : undefined,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ? "****" : undefined,
});

// Configuration
const BUCKET_NAME = process.env.S3_BUCKET_NAME || "amical-www";
const ENDPOINT = process.env.S3_ENDPOINT || "https://s3.wasabisys.com";
const BLOG_PREFIX = process.env.BLOG_PREFIX || "blog/";
const BLOG_IMAGES_PREFIX = process.env.BLOG_IMAGES_PREFIX || "blog-images/";
const CONTENT_DIR = path.join(process.cwd(), "content");
const PUBLIC_DIR = path.join(process.cwd(), "public");
const LOCAL_BLOG_DIR = path.join(CONTENT_DIR, "blogs");
const LOCAL_BLOG_IMAGES_DIR = path.join(PUBLIC_DIR, "blog");

// Check if we have AWS credentials
const HAS_AWS_CREDENTIALS = !!(
  process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
);

// S3 client configuration
const s3ClientConfig: any = {
  endpoint: ENDPOINT,
  region: process.env.AWS_REGION || "us-east-1", // Required but may not matter for Wasabi
  forcePathStyle: true, // Required for Wasabi
};

// Add credentials if provided via environment variables
if (HAS_AWS_CREDENTIALS) {
  s3ClientConfig.credentials = {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  };
} else if (!DRY_RUN) {
  console.warn(
    "Warning: AWS credentials not found. S3 operations will be skipped.",
  );
  if (SKIP_ERRORS) {
    console.warn(
      "Running with --skip-errors flag. Will continue without fetching content.",
    );
  } else {
    console.error(
      "AWS credentials are required for content fetch. Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY environment variables.",
    );
  }
}

// Initialize S3 client only if we have credentials or in dry run mode
const s3Client =
  HAS_AWS_CREDENTIALS || DRY_RUN ? new S3Client(s3ClientConfig) : null;

/**
 * Ensures that a directory exists, creating it and all parent directories if necessary
 */
async function ensureDirectoryExists(directory: string): Promise<void> {
  try {
    await fs.access(directory);
    console.log(`Directory exists: ${directory}`);
  } catch (error) {
    try {
      await fs.mkdir(directory, { recursive: true });
      console.log(`Created directory: ${directory}`);
    } catch (mkdirError) {
      console.error(`Error creating directory ${directory}:`, mkdirError);
      throw mkdirError;
    }
  }
}

async function listObjects(prefix: string): Promise<string[]> {
  if (DRY_RUN) {
    console.log(`[DRY RUN] Would list objects with prefix: ${prefix}`);
    // Return mock data for dry run
    if (prefix === BLOG_PREFIX) {
      return [
        `${BLOG_PREFIX}getting-started.mdx`,
        `${BLOG_PREFIX}advanced-features.mdx`,
        `${BLOG_PREFIX}best-practices.mdx`,
      ];
    } else if (prefix === BLOG_IMAGES_PREFIX) {
      return [
        `${BLOG_IMAGES_PREFIX}header.png`,
        `${BLOG_IMAGES_PREFIX}screenshot1.png`,
        `${BLOG_IMAGES_PREFIX}diagram.png`,
      ];
    }
    return [];
  }

  // Skip S3 operations if we don't have credentials
  if (!s3Client) {
    console.log(
      `Skipping S3 operations for prefix: ${prefix} (no credentials)`,
    );
    return [];
  }

  const objects: string[] = [];
  let continuationToken: string | undefined;

  try {
    do {
      const command = new ListObjectsV2Command({
        Bucket: BUCKET_NAME,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      });

      const response = await s3Client.send(command);

      if (response.Contents) {
        for (const object of response.Contents) {
          if (object.Key) {
            objects.push(object.Key);
          }
        }
      }

      continuationToken = response.NextContinuationToken;
    } while (continuationToken);

    return objects;
  } catch (error) {
    console.error(`Error listing objects with prefix ${prefix}:`, error);
    throw error;
  }
}

async function downloadFile(
  key: string,
  destinationPath: string,
): Promise<void> {
  if (DRY_RUN) {
    console.log(`[DRY RUN] Would download: ${key} to ${destinationPath}`);
    return;
  }

  // Skip S3 operations if we don't have credentials
  if (!s3Client) {
    console.log(`Skipping download of: ${key} (no credentials)`);
    return;
  }

  try {
    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    });

    const response = await s3Client.send(command);

    if (!response.Body) {
      throw new Error(`Failed to get object body for ${key}`);
    }

    const writeStream = createWriteStream(destinationPath);

    // @ts-ignore - TypeScript doesn't recognize Body as a stream, but it is
    await pipeline(response.Body, writeStream);

    console.log(`Downloaded: ${key} to ${destinationPath}`);
  } catch (error) {
    console.error(`Error downloading file ${key}:`, error);
    throw error;
  }
}

async function fetchBlogContent(): Promise<void> {
  console.log("Starting content fetch from S3...");
  if (DRY_RUN) {
    console.log("*** DRY RUN MODE - No files will be downloaded ***");
  } else if (!HAS_AWS_CREDENTIALS) {
    console.log("*** NO CREDENTIALS MODE - S3 operations will be skipped ***");
  }
  console.log(`Bucket: ${BUCKET_NAME}`);
  console.log(`Endpoint: ${ENDPOINT}`);

  try {
    // Ensure parent directories exist first
    await ensureDirectoryExists(CONTENT_DIR);
    await ensureDirectoryExists(PUBLIC_DIR);

    // Then ensure the specific directories for blogs and images
    await ensureDirectoryExists(LOCAL_BLOG_DIR);
    await ensureDirectoryExists(LOCAL_BLOG_IMAGES_DIR);

    // Skip S3 operations if we don't have credentials
    if (!HAS_AWS_CREDENTIALS && !DRY_RUN) {
      console.log("Skipping S3 operations due to missing credentials.");
      if (SKIP_ERRORS) {
        console.log(
          "Build process will continue without fetching content due to --skip-errors flag.",
        );
        return;
      } else {
        throw new Error(
          "AWS credentials are required for content fetch. Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY environment variables.",
        );
      }
    }

    // Fetch blog MDX files
    console.log(`\nFetching blog MDX files from ${BLOG_PREFIX}...`);
    const blogFiles = await listObjects(BLOG_PREFIX);

    if (blogFiles.length === 0) {
      console.log("No blog files found.");
    } else {
      console.log(`Found ${blogFiles.length} blog files.`);

      let downloadedCount = 0;
      for (const key of blogFiles) {
        // Skip the prefix directory itself
        if (key === BLOG_PREFIX) continue;

        const fileName = path.basename(key);
        const destinationPath = path.join(LOCAL_BLOG_DIR, fileName);

        try {
          await downloadFile(key, destinationPath);
          downloadedCount++;
        } catch (error) {
          console.error(
            `Failed to download ${key}. Continuing with next file.`,
          );
        }
      }

      console.log(
        `Successfully downloaded ${downloadedCount} of ${blogFiles.length} blog files.`,
      );
    }

    // Fetch blog images
    console.log(`\nFetching blog images from ${BLOG_IMAGES_PREFIX}...`);
    const imageFiles = await listObjects(BLOG_IMAGES_PREFIX);

    if (imageFiles.length === 0) {
      console.log("No image files found.");
    } else {
      console.log(`Found ${imageFiles.length} image files.`);

      let downloadedCount = 0;
      for (const key of imageFiles) {
        // Skip the prefix directory itself
        if (key === BLOG_IMAGES_PREFIX) continue;

        const fileName = path.basename(key);
        const destinationPath = path.join(LOCAL_BLOG_IMAGES_DIR, fileName);

        try {
          await downloadFile(key, destinationPath);
          downloadedCount++;
        } catch (error) {
          console.error(
            `Failed to download ${key}. Continuing with next file.`,
          );
        }
      }

      console.log(
        `Successfully downloaded ${downloadedCount} of ${imageFiles.length} image files.`,
      );
    }

    console.log("\nContent fetch completed successfully!");
  } catch (error) {
    console.error("Error fetching content:", error);
    if (SKIP_ERRORS) {
      console.warn(
        "Continuing build process despite errors due to --skip-errors flag.",
      );
    } else {
      process.exit(1);
    }
  }
}

// Run the script
fetchBlogContent();
