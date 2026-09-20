export const SILENT_START_ARG = "--silent-start";

export function isSilentStart(args: string[] = process.argv): boolean {
  return args.includes(SILENT_START_ARG);
}

// User-requested restarts should open normally, even after a login launch.
export function getRelaunchArgs(): string[] {
  return process.argv.slice(1).filter((arg) => arg !== SILENT_START_ARG);
}
