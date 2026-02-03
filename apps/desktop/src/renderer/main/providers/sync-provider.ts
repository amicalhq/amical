import * as Y from "yjs";
import { toast } from "sonner";

export interface SyncProviderConfig {
  noteId: number;
  onSaveError?: () => void;
}

export class NoteSyncProvider {
  private ydoc: Y.Doc;
  private text: Y.Text;
  private noteId: number;
  private onSaveError: (() => void) | undefined;
  private destroyed = false;
  private updateHandler:
    | ((update: Uint8Array, origin: unknown) => void)
    | null = null;

  constructor(config: SyncProviderConfig) {
    this.noteId = config.noteId;
    this.onSaveError = config.onSaveError;

    // Initialize Y.Doc and Y.Text
    this.ydoc = new Y.Doc();
    this.text = this.ydoc.getText("content");

    // Set up persistence listener for local storage
    this.setupPersistence();
  }

  private setupPersistence(): void {
    // Save YJS updates to backend via IPC
    this.updateHandler = async (update: Uint8Array, origin: unknown) => {
      if (this.destroyed) return;
      if (origin === "load") return;

      try {
        // Convert Uint8Array to ArrayBuffer for IPC
        const buffer = update.buffer.slice(
          update.byteOffset,
          update.byteOffset + update.byteLength,
        );

        await window.electronAPI.notes.saveYjsUpdate(
          this.noteId,
          buffer as ArrayBuffer,
        );
      } catch (error) {
        if (!this.destroyed) {
          console.error("Failed to save yjs update:", error);
          if (this.onSaveError) {
            this.onSaveError();
          } else {
            toast.error("Failed to save changes");
          }
        }
      }
    };

    this.ydoc.on("update", this.updateHandler);
  }

  async loadFromLocal(): Promise<void> {
    try {
      const updates = await window.electronAPI.notes.loadYjsUpdates(
        this.noteId,
      );

      if (updates.length > 0) {
        // Apply all updates to reconstruct the document
        updates.forEach((update: ArrayBuffer) => {
          Y.applyUpdate(this.ydoc, new Uint8Array(update), "load");
        });
      }
    } catch (error) {
      console.error("Failed to load yjs updates:", error);
      throw error;
    }
  }

  getDoc(): Y.Doc {
    return this.ydoc;
  }

  getText(): Y.Text {
    return this.text;
  }

  destroy(): void {
    this.destroyed = true;

    if (this.updateHandler) {
      this.ydoc.off("update", this.updateHandler);
      this.updateHandler = null;
    }

    this.ydoc.destroy();
  }
}
