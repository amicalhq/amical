import { cleanupOsState } from "./os-state";

export default function globalTeardown(): void {
  cleanupOsState();
}
