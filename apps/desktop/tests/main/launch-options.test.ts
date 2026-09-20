import { afterEach, expect, it } from "vitest";
import { getRelaunchArgs, isSilentStart } from "../../src/main/launch-options";

const originalArgv = process.argv;
afterEach(() => {
  process.argv = originalArgv;
});

it("requires the exact silent-start flag", () => {
  expect(isSilentStart(["Amical", "--silent-start"])).toBe(true);
  expect(isSilentStart(["Amical", "--silent-start=false"])).toBe(false);
  expect(isSilentStart(["Amical"])).toBe(false);
});

it("drops silent-start on explicit restart and preserves other arguments", () => {
  process.argv = [
    "electron",
    "main.js",
    "--silent-start",
    "--inspect=9229",
    "--silent-start",
  ];
  expect(getRelaunchArgs()).toEqual(["main.js", "--inspect=9229"]);
  expect(process.argv).toContain("--silent-start");
});
