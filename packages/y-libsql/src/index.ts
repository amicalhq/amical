import * as Y from "yjs";
import { Client, createClient } from "@libsql/client";

export interface LibSQLPersistenceOptions {
  url?: string;
  authToken?: string;
  client?: Client;
}

export class LibSQLPersistence {
  private doc: Y.Doc;
  private docName: string;
  private client: Client;
  private _synced: boolean = false;
  private _destroyed: boolean = false;
  private whenSynced: Promise<void>;
  private _resolveSynced!: () => void;
  private _storeUpdateHandler: (update: Uint8Array, origin: any) => void;
  private meta: Map<string, any> = new Map();

  constructor(
    docName: string,
    ydoc: Y.Doc,
    options: LibSQLPersistenceOptions = {},
  ) {
    this.doc = ydoc;
    this.docName = docName;

    // Initialize client
    if (options.client) {
      this.client = options.client;
    } else if (options.url) {
      this.client = createClient({
        url: options.url,
        authToken: options.authToken,
      });
    } else {
      // Default to local file
      this.client = createClient({
        url: "file:local.db",
      });
    }

    // Create promise for sync status
    this.whenSynced = new Promise((resolve) => {
      this._resolveSynced = resolve;
    });

    // Bind the update handler
    this._storeUpdateHandler = this._storeUpdate.bind(this);

    // Initialize the database and load existing data
    this._initialize();
  }

  private async _initialize() {
    try {
      // Create tables if they don't exist
      await this._createTables();

      // Load existing updates
      await this._loadUpdates();

      // Listen for document updates
      this.doc.on("update", this._storeUpdateHandler);

      // Mark as synced
      this._synced = true;
      this._resolveSynced();
    } catch (error) {
      console.error("Failed to initialize LibSQLPersistence:", error);
      throw error;
    }
  }

  private async _createTables() {
    // Create updates table
    await this.client.execute(`
      CREATE TABLE IF NOT EXISTS yjs_updates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        doc_name TEXT NOT NULL,
        update_data BLOB NOT NULL,
        created_at INTEGER DEFAULT (unixepoch()),
        INDEX idx_doc_name (doc_name)
      )
    `);

    // Create metadata table
    await this.client.execute(`
      CREATE TABLE IF NOT EXISTS yjs_metadata (
        doc_name TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT,
        PRIMARY KEY (doc_name, key)
      )
    `);
  }

  private async _loadUpdates() {
    // Fetch all updates for this document
    const result = await this.client.execute({
      sql: "SELECT update_data FROM yjs_updates WHERE doc_name = ? ORDER BY id",
      args: [this.docName],
    });

    if (result.rows.length > 0) {
      // Apply updates to the document
      Y.transact(
        this.doc,
        () => {
          for (const row of result.rows) {
            const updateData = row.update_data;
            if (updateData instanceof ArrayBuffer) {
              Y.applyUpdate(this.doc, new Uint8Array(updateData), this);
            } else if (typeof updateData === "string") {
              // Handle base64 encoded data
              const binaryString = atob(updateData);
              const bytes = new Uint8Array(binaryString.length);
              for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
              }
              Y.applyUpdate(this.doc, bytes, this);
            }
          }
        },
        this,
      );
    }

    // Load metadata
    const metaResult = await this.client.execute({
      sql: "SELECT key, value FROM yjs_metadata WHERE doc_name = ?",
      args: [this.docName],
    });

    for (const row of metaResult.rows) {
      const key = row.key as string;
      const value = row.value as string;
      try {
        this.meta.set(key, JSON.parse(value));
      } catch {
        this.meta.set(key, value);
      }
    }
  }

  private async _storeUpdate(update: Uint8Array, origin: any) {
    // Don't store updates that originated from this provider
    if (origin === this || this._destroyed) {
      return;
    }

    try {
      // Convert Uint8Array to base64 for storage
      const base64Update = btoa(String.fromCharCode(...update));

      await this.client.execute({
        sql: "INSERT INTO yjs_updates (doc_name, update_data) VALUES (?, ?)",
        args: [this.docName, base64Update],
      });
    } catch (error) {
      console.error("Failed to store update:", error);
    }
  }

  async set(key: string, value: any): Promise<void> {
    this.meta.set(key, value);
    const jsonValue = JSON.stringify(value);

    await this.client.execute({
      sql: `
        INSERT INTO yjs_metadata (doc_name, key, value) 
        VALUES (?, ?, ?)
        ON CONFLICT(doc_name, key) 
        DO UPDATE SET value = excluded.value
      `,
      args: [this.docName, key, jsonValue],
    });
  }

  get(key: string): any {
    return this.meta.get(key);
  }

  async del(key: string): Promise<void> {
    this.meta.delete(key);

    await this.client.execute({
      sql: "DELETE FROM yjs_metadata WHERE doc_name = ? AND key = ?",
      args: [this.docName, key],
    });
  }

  async clearData(): Promise<void> {
    // Clear all data for this document
    await this.client.execute({
      sql: "DELETE FROM yjs_updates WHERE doc_name = ?",
      args: [this.docName],
    });

    await this.client.execute({
      sql: "DELETE FROM yjs_metadata WHERE doc_name = ?",
      args: [this.docName],
    });

    this.meta.clear();
  }

  async compactUpdates(): Promise<void> {
    // Get the current state as a single update
    const stateUpdate = Y.encodeStateAsUpdate(this.doc);

    // Clear old updates
    await this.client.execute({
      sql: "DELETE FROM yjs_updates WHERE doc_name = ?",
      args: [this.docName],
    });

    // Store the compacted update
    const base64Update = btoa(String.fromCharCode(...stateUpdate));
    await this.client.execute({
      sql: "INSERT INTO yjs_updates (doc_name, update_data) VALUES (?, ?)",
      args: [this.docName, base64Update],
    });
  }

  destroy(): void {
    if (this._destroyed) return;

    this._destroyed = true;
    this.doc.off("update", this._storeUpdateHandler);
  }

  get synced(): boolean {
    return this._synced;
  }
}

// Export for convenience
export { Y };
