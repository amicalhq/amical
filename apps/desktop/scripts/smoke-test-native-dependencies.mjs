import Database from "better-sqlite3";
import * as onnxRuntime from "onnxruntime-node";

const database = new Database(":memory:");
try {
  database.exec("CREATE TABLE smoke_test (value INTEGER NOT NULL)");
  database.transaction(() => {
    database.prepare("INSERT INTO smoke_test VALUES (?)").run(1);
  })();

  const value = database.prepare("SELECT value FROM smoke_test").pluck().get();
  if (value !== 1) {
    throw new Error("better-sqlite3 transaction smoke test failed");
  }
} finally {
  database.close();
}

if (typeof onnxRuntime.InferenceSession?.create !== "function") {
  throw new Error("onnxruntime-node native binding failed to load");
}
