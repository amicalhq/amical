import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDatabase, type TestDatabase } from "../helpers/test-db";
import {
  seedDatabase,
  fixtures,
  sampleTranscriptions,
} from "../helpers/fixtures";
import { initializeTestServices } from "../helpers/test-app";
import { setTestDatabase } from "../setup";

describe("Transcriptions Service", () => {
  let testDb: TestDatabase;
  let serviceManager: any;
  let trpcCaller: any;
  let cleanup: () => Promise<void>;

  afterEach(async () => {
    if (cleanup) {
      await cleanup();
    }
    if (testDb) {
      await testDb.close();
    }
  });

  describe("Get Transcriptions", () => {
    beforeEach(async () => {
      testDb = await createTestDatabase({ name: "get-transcriptions-test" });
      setTestDatabase(testDb.db);
      await seedDatabase(testDb, "withTranscriptions");
      const result = await initializeTestServices(testDb);
      serviceManager = result.serviceManager;
      trpcCaller = result.trpcCaller;
      cleanup = result.cleanup;
    });

    it("should return all transcriptions", async () => {
      const transcriptions = await trpcCaller.transcriptions.getTranscriptions({
        limit: 10,
        offset: 0,
      });

      expect(transcriptions).toHaveLength(sampleTranscriptions.length);
      expect(transcriptions[0]).toHaveProperty("id");
      expect(transcriptions[0]).toHaveProperty("text");
      expect(transcriptions[0]).toHaveProperty("language");
    });

    it("should respect limit parameter", async () => {
      const transcriptions = await trpcCaller.transcriptions.getTranscriptions({
        limit: 2,
        offset: 0,
      });

      expect(transcriptions).toHaveLength(2);
    });

    it("should respect offset parameter", async () => {
      const allTranscriptions =
        await trpcCaller.transcriptions.getTranscriptions({
          limit: 10,
          offset: 0,
        });

      const offsetTranscriptions =
        await trpcCaller.transcriptions.getTranscriptions({
          limit: 10,
          offset: 1,
        });

      expect(offsetTranscriptions).toHaveLength(allTranscriptions.length - 1);
      expect(offsetTranscriptions[0].id).not.toBe(allTranscriptions[0].id);
    });
  });

  describe("Get Transcription by ID", () => {
    beforeEach(async () => {
      testDb = await createTestDatabase({ name: "get-by-id-test" });
      setTestDatabase(testDb.db);
      await seedDatabase(testDb, "withTranscriptions");
      const result = await initializeTestServices(testDb);
      serviceManager = result.serviceManager;
      trpcCaller = result.trpcCaller;
      cleanup = result.cleanup;
    });

    it("should return transcription by id", async () => {
      const transcriptions = await trpcCaller.transcriptions.getTranscriptions({
        limit: 1,
        offset: 0,
      });

      const transcription =
        await trpcCaller.transcriptions.getTranscriptionById({
          id: transcriptions[0].id,
        });

      expect(transcription).toBeDefined();
      expect(transcription.id).toBe(transcriptions[0].id);
      expect(transcription.text).toBe(transcriptions[0].text);
    });

    it("should return null for non-existent id", async () => {
      const result = await trpcCaller.transcriptions.getTranscriptionById({
        id: 99999,
      });
      expect(result).toBeNull();
    });
  });

  describe("Delete Transcription", () => {
    beforeEach(async () => {
      testDb = await createTestDatabase({ name: "delete-test" });
      setTestDatabase(testDb.db);
      await seedDatabase(testDb, "withTranscriptions");
      const result = await initializeTestServices(testDb);
      serviceManager = result.serviceManager;
      trpcCaller = result.trpcCaller;
      cleanup = result.cleanup;
    });

    it("should delete transcription by id", async () => {
      const transcriptions = await trpcCaller.transcriptions.getTranscriptions({
        limit: 10,
        offset: 0,
      });

      const initialCount = transcriptions.length;
      const idToDelete = transcriptions[0].id;

      await trpcCaller.transcriptions.deleteTranscription({ id: idToDelete });

      const afterDelete = await trpcCaller.transcriptions.getTranscriptions({
        limit: 10,
        offset: 0,
      });

      expect(afterDelete).toHaveLength(initialCount - 1);
      expect(afterDelete.find((t: any) => t.id === idToDelete)).toBeUndefined();
    });
  });

  describe("Search Transcriptions", () => {
    beforeEach(async () => {
      testDb = await createTestDatabase({ name: "search-test" });
      setTestDatabase(testDb.db);
      await seedDatabase(testDb, "withTranscriptions");
      const result = await initializeTestServices(testDb);
      serviceManager = result.serviceManager;
      trpcCaller = result.trpcCaller;
      cleanup = result.cleanup;
    });

    it("should search transcriptions by text", async () => {
      const results = await trpcCaller.transcriptions.searchTranscriptions({
        searchTerm: "test",
        limit: 10,
      });

      expect(results.length).toBeGreaterThan(0);
      results.forEach((result: any) => {
        expect(result.text.toLowerCase()).toContain("test");
      });
    });

    it("should return empty array for no matches", async () => {
      const results = await trpcCaller.transcriptions.searchTranscriptions({
        searchTerm: "nonexistentquerystring",
        limit: 10,
      });

      expect(results).toHaveLength(0);
    });
  });

  describe("Empty Database", () => {
    beforeEach(async () => {
      testDb = await createTestDatabase({ name: "empty-test" });
      setTestDatabase(testDb.db);
      await seedDatabase(testDb, "empty");
      const result = await initializeTestServices(testDb);
      serviceManager = result.serviceManager;
      trpcCaller = result.trpcCaller;
      cleanup = result.cleanup;
    });

    it("should return empty array for empty database", async () => {
      const transcriptions = await trpcCaller.transcriptions.getTranscriptions({
        limit: 10,
        offset: 0,
      });

      expect(transcriptions).toHaveLength(0);
    });

    it("should handle search on empty database", async () => {
      const results = await trpcCaller.transcriptions.searchTranscriptions({
        searchTerm: "test",
        limit: 10,
      });

      expect(results).toHaveLength(0);
    });
  });

  describe("Get Count", () => {
    beforeEach(async () => {
      testDb = await createTestDatabase({ name: "count-test" });
      setTestDatabase(testDb.db);
      await seedDatabase(testDb, "withTranscriptions");
      const result = await initializeTestServices(testDb);
      serviceManager = result.serviceManager;
      trpcCaller = result.trpcCaller;
      cleanup = result.cleanup;
    });

    it("should return total transcription count", async () => {
      const count = await trpcCaller.transcriptions.getTranscriptionsCount({});

      expect(count).toBe(sampleTranscriptions.length);
      expect(count).toBeGreaterThan(0);
    });
  });
});
