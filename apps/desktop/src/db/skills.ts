import { asc, eq } from "drizzle-orm";
import { db } from ".";
import { skills, type Skill, type NewSkill } from "./schema";
import { logger } from "../main/logger";

// Default included_apps / included_sites for each seeded skill. Kept in
// JS (not baked into the DB row) so we can ship updates with each app
// release. A seeded row with NULL includedApps/includedSites uses these
// at read time; once the user edits the list, the row goes non-null
// and future default-list changes here stop propagating to that row.
// A Reset-to-defaults action writes null back to re-enable inheritance.
export const SEED_APP_DEFAULTS: Record<string, string[]> = {
  default: [],
  personal: ["imessage", "whatsapp", "discord"],
  work: ["slack", "linear", "notion"],
  email: ["apple-mail", "outlook", "spark", "superhuman"],
};

export const SEED_SITE_DEFAULTS: Record<string, string[]> = {
  default: [],
  personal: ["web.whatsapp.com", "discord.com"],
  work: ["app.slack.com", "linear.app", "www.notion.so"],
  email: ["mail.google.com", "outlook.live.com", "outlook.office.com"],
};

// Seeded rows. Field values for everything except the two list columns
// are baked in here; lists default to null so they inherit from the
// JS-side SEED_*_DEFAULTS maps above.
const SEED_SKILLS: NewSkill[] = [
  {
    id: "personal",
    name: "Personal messages",
    mode: "preset",
    preset: "personal_messages",
    prompt: null,
    tone: "casual",
    includedApps: null,
    includedSites: null,
    isBuiltIn: true,
    sortOrder: 1,
  },
  {
    id: "work",
    name: "Work messages",
    mode: "preset",
    preset: "work_messages",
    prompt: null,
    tone: "casual",
    includedApps: null,
    includedSites: null,
    isBuiltIn: true,
    sortOrder: 2,
  },
  {
    id: "email",
    name: "Email",
    mode: "preset",
    preset: "email",
    prompt: null,
    tone: "formal",
    includedApps: null,
    includedSites: null,
    isBuiltIn: true,
    sortOrder: 3,
  },
  // Catch-all fallback — applies when no other skill matches the foreground
  // app. Rendered last and labelled "Others". Keeps id "default" (referenced
  // as the fallback preset and by SEED_APP_DEFAULTS).
  {
    id: "default",
    name: "Others",
    mode: "preset",
    preset: "default",
    prompt: null,
    tone: "casual",
    includedApps: null,
    includedSites: null,
    isDefault: true,
    isBuiltIn: true,
    sortOrder: 4,
  },
];

// Shape returned to consumers — the raw row + flattened defaults + two
// flags indicating whether the user has customized each list (i.e. the
// column is non-null in the DB).
export type ResolvedSkill = Omit<Skill, "includedApps" | "includedSites"> & {
  includedApps: string[];
  includedSites: string[];
  isUsingDefaultApps: boolean;
  isUsingDefaultSites: boolean;
};

const resolveSkill = (row: Skill): ResolvedSkill => ({
  ...row,
  includedApps: row.includedApps ?? SEED_APP_DEFAULTS[row.id] ?? [],
  includedSites: row.includedSites ?? SEED_SITE_DEFAULTS[row.id] ?? [],
  isUsingDefaultApps: row.includedApps === null,
  isUsingDefaultSites: row.includedSites === null,
});

export async function listSkills(): Promise<ResolvedSkill[]> {
  const rows = await db
    .select()
    .from(skills)
    .orderBy(asc(skills.sortOrder), asc(skills.createdAt));
  return rows.map(resolveSkill);
}

export async function getSkillById(
  id: string,
): Promise<ResolvedSkill | null> {
  const result = await db.select().from(skills).where(eq(skills.id, id));
  return result[0] ? resolveSkill(result[0]) : null;
}

const newSkillId = () =>
  `skill_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-4)}`;

export async function createSkill(
  data: Omit<
    NewSkill,
    "id" | "createdAt" | "updatedAt" | "isBuiltIn" | "isDefault" | "sortOrder"
  > & {
    sortOrder?: number;
  },
): Promise<ResolvedSkill> {
  const now = new Date();
  const row: NewSkill = {
    id: newSkillId(),
    sortOrder: data.sortOrder ?? Date.now(),
    ...data,
    isBuiltIn: false,
    isDefault: false,
    createdAt: now,
    updatedAt: now,
  };
  const result = await db.insert(skills).values(row).returning();
  return resolveSkill(result[0]!);
}

export async function updateSkill(
  id: string,
  data: Partial<Omit<NewSkill, "id" | "createdAt" | "isBuiltIn" | "isDefault">>,
): Promise<ResolvedSkill | null> {
  const result = await db
    .update(skills)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(skills.id, id))
    .returning();
  return result[0] ? resolveSkill(result[0]) : null;
}

export async function deleteSkill(id: string): Promise<Skill | null> {
  // Hard-block deletion of built-in rows at the db helper layer too —
  // the router enforces it, this is defense in depth.
  const existing = await getSkillById(id);
  if (!existing) return null;
  if (existing.isBuiltIn) {
    throw new Error("Cannot delete a built-in skill");
  }
  const result = await db
    .delete(skills)
    .where(eq(skills.id, id))
    .returning();
  return result[0] ?? null;
}

// Idempotent: ensures the seeded baseline rows exist. Runs on every db
// init. Existing rows are untouched (so user edits are preserved); new
// seeded ids added in future releases get planted on next launch.
export async function ensureSeededSkills(): Promise<void> {
  const now = new Date();
  await db
    .insert(skills)
    .values(
      SEED_SKILLS.map((skill) => ({
        ...skill,
        createdAt: now,
        updatedAt: now,
      })),
    )
    .onConflictDoNothing();
  logger.db.debug("Skills: ensured seeded baseline rows");
}
