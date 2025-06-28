# www

This is a Next.js application generated with
[Create Fumadocs](https://github.com/fuma-nama/fumadocs).

Run development server:

```bash
npm run dev
# or
pnpm dev
# or
yarn dev
```

Open http://localhost:3000 with your browser to see the result.

## Content Management

### Docs

Docs are written in MDX in the contents/docs folder.

### Fetching Blog Content

This project includes a script to fetch blog content and images from an S3-compatible storage (Wasabi):

```bash
# Set up environment variables (see .env.example)
pnpm fetch-content
```

The script will:

- Fetch MDX files from the `blog/` folder in the S3 bucket and save them to `content/blogs/`
- Fetch images from the `blog-images/` folder in the S3 bucket and save them to `public/blog/`

### Building the Application

The build process includes fetching content from S3:

```bash
pnpm build
```

The build will fail if the content fetch fails. This ensures that the site is always built with the latest content and that any issues with the content fetch process are immediately apparent.

To use this in CI/CD environments, make sure to configure the appropriate AWS credentials as environment variables.
