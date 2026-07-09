import { recordOsState } from "./os-state";

export default function globalSetup(): void {
  recordOsState();
}
