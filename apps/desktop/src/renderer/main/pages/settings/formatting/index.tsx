import * as React from "react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { api } from "@/trpc/react";
import { SkillRow } from "./skill-row";
import { Badge } from "@/components/ui/badge";
import { useTranslation } from "react-i18next";
import type { SkillEdit, SkillSnapshot } from "./catalog";

export default function PersonalizationSettingsPage() {
  const { t } = useTranslation();
  const utils = api.useUtils();
  const skillsQuery = api.skills.list.useQuery();
  const [expandedId, setExpandedId] = React.useState<string | null>(null);

  const updateMutation = api.skills.update.useMutation({
    onSuccess: () => {
      utils.skills.list.invalidate();
      setExpandedId(null);
      toast.success("Skill saved");
    },
    onError: (error) => toast.error(`Failed to save skill: ${error.message}`),
  });

  const skills = (skillsQuery.data ?? []) as SkillSnapshot[];
  const defaultSkills = skills.filter((s) => s.isBuiltIn);

  const toggle = (id: string) =>
    setExpandedId((prev) => (prev === id ? null : id));

  const handleSave = (next: SkillEdit) => {
    updateMutation.mutate({
      id: next.id,
      data: {
        name: next.name,
        mode: next.mode,
        preset: next.preset,
        prompt: next.prompt,
        tone: next.tone,
        includedApps: next.includedApps,
        includedSites: next.includedSites,
      },
    });
  };

  const handleReset = (id: string, field: "apps" | "sites") => {
    updateMutation.mutate({
      id,
      data:
        field === "apps" ? { includedApps: null } : { includedSites: null },
    });
  };

  const savingId =
    updateMutation.isPending && updateMutation.variables?.id
      ? updateMutation.variables.id
      : null;

  return (
    <div>
      <div className="mb-8">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-bold">Personalization</h1>
          <Badge className="text-[10px] px-1.5 py-0 bg-orange-500/20 text-orange-500 hover:bg-orange-500/20">
            {t("settings.dictation.formatting.badge")}
          </Badge>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          How Amical personalizes your dictation. Defaults apply automatically
          based on the active app.
        </p>
      </div>

      {skillsQuery.isLoading ? (
        <Card className="p-0 overflow-clip">
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            Loading skills...
          </CardContent>
        </Card>
      ) : (
        <>
          <section className="mb-8">
            <h2 className="mb-3 text-sm font-semibold">Defaults</h2>
            <Card className="p-0 overflow-clip">
              <CardContent className="p-0">
                <div className="divide-y divide-border">
                  {defaultSkills.map((skill) => (
                    <SkillRow
                      key={skill.id}
                      skill={skill}
                      expanded={expandedId === skill.id}
                      saving={savingId === skill.id}
                      onToggle={() => toggle(skill.id)}
                      onSave={handleSave}
                      onReset={(field) => handleReset(skill.id, field)}
                    />
                  ))}
                </div>
              </CardContent>
            </Card>
          </section>

          <section>
            <div className="mb-3 flex items-center gap-2">
              <h2 className="text-sm font-semibold">Custom</h2>
              <Badge className="text-[10px] px-1.5 py-0 bg-muted text-muted-foreground hover:bg-muted">
                Coming soon
              </Badge>
            </div>
            <Card className="p-0 overflow-clip">
              <CardContent className="px-6 py-10 text-center">
                <p className="text-sm text-muted-foreground">
                  Custom skills are coming soon — you&apos;ll be able to add your
                  own to personalize dictation in specific apps.
                </p>
              </CardContent>
            </Card>
          </section>
        </>
      )}
    </div>
  );
}
