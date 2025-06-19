import {
  defineConfig,
  defineCollections,
  defineDocs,
  frontmatterSchema,
  metaSchema,
} from 'fumadocs-mdx/config';
import { z } from 'zod';

// You can customise Zod schemas for frontmatter and `meta.json` here
// see https://fumadocs.vercel.app/docs/mdx/collections#define-docs
export const { docs, meta } = defineDocs({
  dir: 'content/docs',
  docs: {
    schema: frontmatterSchema,
  },
  meta: {
    schema: metaSchema,
  },
});


export const blog = defineCollections({
  type: 'doc',
  dir: 'content/blogs',
  async: true,
  schema: frontmatterSchema.extend({
    author: z.string(),
    image: z.string(),
    date: z.string().date().or(z.date()).optional(),
    priority: z.number().default(0),
  }),
});

export default defineConfig({
  mdxOptions: {
    // MDX options
  },
});
