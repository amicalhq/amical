import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  snippets,
  syncCollectionState,
  syncOutbox,
  vocabulary,
} from "../../src/db/schema";
import {
  applyPullPages,
  beginUserSyncSession,
  pauseSyncSession,
  reconcileSyncScopes,
} from "../../src/db/sync";
import {
  createOrganizationSnippet,
  deleteSnippet,
  getAllSnippets,
  getSnippets,
  updateOrganizationSnippet,
  updateSnippet,
} from "../../src/db/snippets";
import {
  createOrganizationVocabularyWord,
  createVocabularyWord,
  deleteVocabulary,
  getAllVocabulary,
  getVocabulary,
  getVocabularyById,
  trackWordUsage,
  updateOrganizationVocabulary,
  updateVocabulary,
} from "../../src/db/vocabulary";
import { createTestDatabase, type TestDatabase } from "../helpers/test-db";
import { setTestDatabase } from "../setup";

type DesktopDatabase = typeof import("../../src/db").db;

const USER_SCOPE = {
  scopeType: "user" as const,
  scopeId: "user-1",
  role: null,
  canWrite: true,
  latestSyncVersion: 0,
};

const SHARED_VOCABULARY_SYNC_ID = "11111111-1111-4111-8111-111111111111";
const SHARED_SNIPPET_SYNC_ID = "22222222-2222-4222-8222-222222222222";

describe("scoped vocabulary and snippet storage", () => {
  let testDb: TestDatabase;
  let database: DesktopDatabase;

  beforeEach(async () => {
    pauseSyncSession();
    testDb = await createTestDatabase();
    database = testDb.db as unknown as DesktopDatabase;
    setTestDatabase(database);
  });

  afterEach(async () => {
    pauseSyncSession();
    await testDb.close();
  });

  it("allows the same key across personal and concrete organization scopes", async () => {
    database
      .insert(vocabulary)
      .values([
        { word: "Amical", scopeType: "user", scopeId: "" },
        { word: "Amical", scopeType: "org", scopeId: "org-1" },
        { word: "Amical", scopeType: "org", scopeId: "org-2" },
      ])
      .run();
    database
      .insert(snippets)
      .values([
        { trigger: "/support", content: "Personal", scopeId: "" },
        {
          trigger: "/support",
          content: "First organization",
          scopeType: "org",
          scopeId: "org-1",
        },
        {
          trigger: "/support",
          content: "Second organization",
          scopeType: "org",
          scopeId: "org-2",
        },
      ])
      .run();

    expect(database.select().from(vocabulary).all()).toHaveLength(3);
    expect(database.select().from(snippets).all()).toHaveLength(3);
    await expect(getVocabulary({ scope: "org" })).resolves.toEqual([]);
    await expect(getSnippets({ scope: "org" })).resolves.toEqual([]);
  });

  it("rejects a duplicate key within one concrete scope", () => {
    database
      .insert(vocabulary)
      .values({ word: "Amical", scopeType: "org", scopeId: "org-1" })
      .run();
    database
      .insert(snippets)
      .values({
        trigger: "/support",
        content: "First",
        scopeType: "org",
        scopeId: "org-1",
      })
      .run();

    expect(() =>
      database
        .insert(vocabulary)
        .values({ word: "Amical", scopeType: "org", scopeId: "org-1" })
        .run(),
    ).toThrow("UNIQUE constraint failed");
    expect(() =>
      database
        .insert(snippets)
        .values({
          trigger: "/support",
          content: "Second",
          scopeType: "org",
          scopeId: "org-1",
        })
        .run(),
    ).toThrow("UNIQUE constraint failed");
  });

  it("allows the same item UUID across personal and organization scopes", async () => {
    await beginUserSyncSession("user-1", database);
    await reconcileSyncScopes(
      "user-1",
      [
        USER_SCOPE,
        {
          scopeType: "org",
          scopeId: "org-1",
          role: "member",
          canWrite: false,
          latestSyncVersion: 0,
        },
      ],
      database,
    );
    database
      .insert(vocabulary)
      .values([
        {
          id: SHARED_VOCABULARY_SYNC_ID,
          word: "personal uuid",
          scopeType: "user",
          scopeId: "",
        },
        {
          id: SHARED_VOCABULARY_SYNC_ID,
          word: "organization uuid",
          scopeType: "org",
          scopeId: "org-1",
        },
        {
          id: SHARED_VOCABULARY_SYNC_ID,
          word: "other organization uuid",
          scopeType: "org",
          scopeId: "org-2",
        },
      ])
      .run();
    database
      .insert(snippets)
      .values([
        {
          id: SHARED_SNIPPET_SYNC_ID,
          trigger: "/personal-uuid",
          content: "Personal",
          scopeType: "user",
          scopeId: "",
        },
        {
          id: SHARED_SNIPPET_SYNC_ID,
          trigger: "/organization-uuid",
          content: "Organization",
          scopeType: "org",
          scopeId: "org-1",
        },
        {
          id: SHARED_SNIPPET_SYNC_ID,
          trigger: "/other-organization-uuid",
          content: "Other organization",
          scopeType: "org",
          scopeId: "org-2",
        },
      ])
      .run();

    expect(database.select().from(vocabulary).all()).toHaveLength(3);
    expect(database.select().from(snippets).all()).toHaveLength(3);
    await expect(getVocabularyById(SHARED_VOCABULARY_SYNC_ID)).resolves.toEqual(
      expect.objectContaining({ scopeType: "user", word: "personal uuid" }),
    );

    await trackWordUsage("personal uuid");
    const rows = database.select().from(vocabulary).all();
    expect(rows.find((row) => row.scopeType === "user")?.usageCount).toBe(1);
    expect(
      rows
        .filter((row) => row.scopeType === "org")
        .map((row) => row.usageCount),
    ).toEqual([0, 0]);
  });

  it("uses personal precedence in All and exposes raw scoped views", async () => {
    await beginUserSyncSession("user-1", database);
    await reconcileSyncScopes(
      "user-1",
      [
        USER_SCOPE,
        {
          scopeType: "org",
          scopeId: "org-1",
          role: "member",
          canWrite: false,
          latestSyncVersion: 0,
        },
      ],
      database,
    );
    const [organizationWord, personalWord] = database
      .insert(vocabulary)
      .values([
        {
          word: "amical",
          replacementWord: "Organization replacement",
          scopeType: "org",
          scopeId: "org-1",
        },
        {
          word: "amical",
          replacementWord: null,
          scopeType: "user",
          scopeId: "",
        },
      ])
      .returning()
      .all();
    const [organizationSnippet, personalSnippet] = database
      .insert(snippets)
      .values([
        {
          trigger: "/support",
          content: "Organization response",
          scopeType: "org",
          scopeId: "org-1",
        },
        {
          trigger: "/support",
          content: "Personal response",
          scopeType: "user",
          scopeId: "",
        },
      ])
      .returning()
      .all();

    expect(await getAllVocabulary()).toEqual([
      expect.objectContaining({ id: personalWord.id }),
    ]);
    expect(await getAllSnippets()).toEqual([
      expect.objectContaining({ id: personalSnippet.id }),
    ]);
    expect(await getVocabulary({ scope: "all" })).toEqual([
      expect.objectContaining({ id: personalWord.id }),
    ]);
    expect(await getVocabulary({ scope: "org" })).toEqual([
      expect.objectContaining({ id: organizationWord.id }),
    ]);
    expect(await getSnippets({ scope: "user" })).toEqual([
      expect.objectContaining({ id: personalSnippet.id }),
    ]);
    expect(await getSnippets({ scope: "org" })).toEqual([
      expect.objectContaining({ id: organizationSnippet.id }),
    ]);

    await trackWordUsage("amical");
    expect(database.select().from(vocabulary).all()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: organizationWord.id, usageCount: 0 }),
        expect.objectContaining({ id: personalWord.id, usageCount: 1 }),
      ]),
    );
  });

  it("guards personal CRUD and gates explicit organization CRUD", async () => {
    await beginUserSyncSession("user-1", database);
    await reconcileSyncScopes(
      "user-1",
      [
        USER_SCOPE,
        {
          scopeType: "org",
          scopeId: "org-1",
          role: "member",
          canWrite: false,
          latestSyncVersion: 0,
        },
      ],
      database,
    );
    const [organizationWord] = database
      .insert(vocabulary)
      .values({ word: "shared", scopeType: "org", scopeId: "org-1" })
      .returning()
      .all();
    const [organizationSnippet] = database
      .insert(snippets)
      .values({
        trigger: "/shared",
        content: "Shared",
        scopeType: "org",
        scopeId: "org-1",
      })
      .returning()
      .all();

    await expect(
      updateVocabulary(organizationWord.id, { word: "changed" }),
    ).resolves.toBeNull();
    await expect(deleteVocabulary(organizationWord.id)).resolves.toBeNull();
    await expect(
      updateSnippet(organizationSnippet.id, { content: "Changed" }),
    ).resolves.toBeNull();
    await expect(deleteSnippet(organizationSnippet.id)).resolves.toBeNull();
    await expect(
      createOrganizationVocabularyWord({ word: "blocked" }),
    ).rejects.toThrow("read-only");

    await reconcileSyncScopes(
      "user-1",
      [
        USER_SCOPE,
        {
          scopeType: "org",
          scopeId: "org-1",
          role: "admin",
          canWrite: true,
          latestSyncVersion: 0,
        },
      ],
      database,
    );
    const createdWord = await createOrganizationVocabularyWord({
      word: "publish",
    });
    const createdSnippet = await createOrganizationSnippet({
      trigger: "/publish",
      content: "Published",
    });
    await updateOrganizationVocabulary(createdWord.id, {
      replacementWord: "published",
    });
    await updateOrganizationSnippet(createdSnippet.id, {
      content: "Updated",
    });

    expect(database.select().from(syncOutbox).all()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          scopeType: "org",
          scopeId: "org-1",
          syncId: createdWord.id,
        }),
        expect.objectContaining({
          scopeType: "org",
          scopeId: "org-1",
          syncId: createdSnippet.id,
        }),
      ]),
    );
  });

  it("applies remote organization upserts and deletes without echo", async () => {
    await beginUserSyncSession("user-1", database);
    const reconciled = await reconcileSyncScopes(
      "user-1",
      [
        USER_SCOPE,
        {
          scopeType: "org",
          scopeId: "org-1",
          role: "member",
          canWrite: false,
          latestSyncVersion: 0,
        },
      ],
      database,
    );
    const organization = reconciled?.contexts.find(
      (context) => context.scopeType === "org",
    );
    expect(organization).toBeDefined();
    database
      .insert(vocabulary)
      .values({
        id: SHARED_VOCABULARY_SYNC_ID,
        word: "Personal",
        scopeType: "user",
        scopeId: "",
      })
      .run();
    database
      .insert(snippets)
      .values({
        id: SHARED_SNIPPET_SYNC_ID,
        trigger: "/personal",
        content: "Personal",
        scopeType: "user",
        scopeId: "",
      })
      .run();

    await applyPullPages(
      organization!,
      [
        {
          collection: "vocabulary",
          cursor: 1,
          items: [
            {
              collection: "vocabulary",
              syncId: SHARED_VOCABULARY_SYNC_ID,
              syncVersion: 1,
              payload: { word: "Shared", replacement: null },
            },
          ],
        },
        {
          collection: "snippet",
          cursor: 1,
          items: [
            {
              collection: "snippet",
              syncId: SHARED_SNIPPET_SYNC_ID,
              syncVersion: 1,
              payload: { trigger: "/shared", content: "Shared" },
            },
          ],
        },
      ],
      database,
    );
    expect(database.select().from(syncOutbox).all()).toEqual([]);
    expect(database.select().from(vocabulary).all()).toHaveLength(2);
    expect(database.select().from(snippets).all()).toHaveLength(2);
    expect(database.select().from(vocabulary).all()).toContainEqual(
      expect.objectContaining({
        id: SHARED_VOCABULARY_SYNC_ID,
        scopeType: "org",
        scopeId: "org-1",
      }),
    );
    expect(database.select().from(snippets).all()).toContainEqual(
      expect.objectContaining({
        id: SHARED_SNIPPET_SYNC_ID,
        scopeType: "org",
        scopeId: "org-1",
      }),
    );

    await applyPullPages(
      organization!,
      [
        {
          collection: "vocabulary",
          cursor: 2,
          items: [
            {
              collection: "vocabulary",
              syncId: SHARED_VOCABULARY_SYNC_ID,
              syncVersion: 2,
              payload: null,
            },
          ],
        },
        {
          collection: "snippet",
          cursor: 2,
          items: [
            {
              collection: "snippet",
              syncId: SHARED_SNIPPET_SYNC_ID,
              syncVersion: 2,
              payload: null,
            },
          ],
        },
      ],
      database,
    );
    expect(database.select().from(vocabulary).all()).toEqual([
      expect.objectContaining({ scopeType: "user", word: "Personal" }),
    ]);
    expect(database.select().from(snippets).all()).toEqual([
      expect.objectContaining({ scopeType: "user", trigger: "/personal" }),
    ]);
    expect(database.select().from(syncOutbox).all()).toEqual([]);
    expect(
      database
        .select()
        .from(syncCollectionState)
        .all()
        .filter((row) => row.scopeType === "org"),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ collection: "vocabulary", cursor: 2 }),
        expect.objectContaining({ collection: "snippet", cursor: 2 }),
      ]),
    );
  });

  it("keeps user and organization outboxes isolated and never retargets on switch", async () => {
    await beginUserSyncSession("user-1", database);
    const firstScopes = await reconcileSyncScopes(
      "user-1",
      [
        USER_SCOPE,
        {
          scopeType: "org",
          scopeId: "org-1",
          role: "admin",
          canWrite: true,
          latestSyncVersion: 0,
        },
      ],
      database,
    );
    const personalContext = firstScopes!.contexts.find(
      (context) => context.scopeType === "user",
    )!;
    const organizationContext = firstScopes!.contexts.find(
      (context) => context.scopeType === "org",
    )!;
    await applyPullPages(
      personalContext,
      [{ collection: "vocabulary", cursor: 3, items: [] }],
      database,
    );
    await applyPullPages(
      organizationContext,
      [{ collection: "vocabulary", cursor: 5, items: [] }],
      database,
    );
    const personal = await createVocabularyWord({ word: "Personal" });
    const organization = await createOrganizationVocabularyWord({
      word: "Organization",
    });

    expect(database.select().from(syncOutbox).all()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          scopeType: "user",
          scopeId: "user-1",
          syncId: personal.id,
        }),
        expect.objectContaining({
          scopeType: "org",
          scopeId: "org-1",
          syncId: organization.id,
        }),
      ]),
    );

    await reconcileSyncScopes(
      "user-1",
      [
        USER_SCOPE,
        {
          scopeType: "org",
          scopeId: "org-2",
          role: "admin",
          canWrite: true,
          latestSyncVersion: 0,
        },
      ],
      database,
    );

    expect(database.select().from(syncOutbox).all()).toEqual([
      expect.objectContaining({
        scopeType: "user",
        scopeId: "user-1",
        syncId: personal.id,
      }),
    ]);
    expect(database.select().from(vocabulary).all()).toEqual([
      expect.objectContaining({ id: personal.id, scopeType: "user" }),
    ]);
    expect(
      database
        .select()
        .from(syncCollectionState)
        .all()
        .filter((row) => row.collection === "vocabulary"),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          scopeType: "user",
          scopeId: "user-1",
          cursor: 3,
        }),
        expect.objectContaining({
          scopeType: "org",
          scopeId: "org-2",
          cursor: 0,
        }),
      ]),
    );
    expect(
      database
        .select()
        .from(syncCollectionState)
        .all()
        .some((row) => row.scopeType === "org" && row.scopeId === "org-1"),
    ).toBe(false);
  });
});

describe("scoped language asset migration", () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = await createTestDatabase({ skipMigrations: true });
  });

  afterEach(async () => {
    await testDb.close();
  });

  it("upgrades the exact shipped migration chain through 0008", () => {
    const migrationsDirectory = path.join(
      process.cwd(),
      "src",
      "db",
      "migrations",
    );
    const shippedMigrations = fs
      .readdirSync(migrationsDirectory)
      .filter((file) => /^000[0-8]_.*\.sql$/.test(file))
      .sort();
    expect(shippedMigrations).toHaveLength(9);
    for (const file of shippedMigrations) {
      testDb.db.$client.exec(
        fs
          .readFileSync(path.join(migrationsDirectory, file), "utf8")
          .replaceAll("--> statement-breakpoint", ""),
      );
    }

    testDb.db.$client.exec(`
      INSERT INTO vocabulary (id, word)
      VALUES ('11111111-1111-4111-8111-111111111111', 'Personal');
      INSERT INTO snippets (id, trigger, content)
      VALUES ('22222222-2222-4222-8222-222222222222', '/personal', 'Value');
    `);
    testDb.db.$client.exec(
      fs
        .readFileSync(
          path.join(migrationsDirectory, "0009_known_robbie_robertson.sql"),
          "utf8",
        )
        .replaceAll("--> statement-breakpoint", ""),
    );
    testDb.db.$client.exec(`
      INSERT INTO vocabulary (id, scope_type, scope_id, word)
      VALUES ('11111111-1111-4111-8111-111111111111', 'org', 'org-1', 'Organization');
      INSERT INTO snippets (id, scope_type, scope_id, trigger, content)
      VALUES ('22222222-2222-4222-8222-222222222222', 'org', 'org-1', '/organization', 'Value');
    `);

    expect(testDb.db.select().from(vocabulary).all()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: SHARED_VOCABULARY_SYNC_ID,
          word: "Personal",
          scopeType: "user",
          scopeId: "",
        }),
        expect.objectContaining({
          id: SHARED_VOCABULARY_SYNC_ID,
          word: "Organization",
          scopeType: "org",
          scopeId: "org-1",
        }),
      ]),
    );
    expect(testDb.db.select().from(vocabulary).all()).toHaveLength(2);
    expect(testDb.db.select().from(snippets).all()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: SHARED_SNIPPET_SYNC_ID,
          trigger: "/personal",
          scopeType: "user",
          scopeId: "",
        }),
        expect.objectContaining({
          id: SHARED_SNIPPET_SYNC_ID,
          trigger: "/organization",
          scopeType: "org",
          scopeId: "org-1",
        }),
      ]),
    );
    expect(testDb.db.select().from(snippets).all()).toHaveLength(2);
  });
});
