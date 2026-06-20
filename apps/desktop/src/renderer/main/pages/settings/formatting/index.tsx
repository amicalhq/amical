import * as React from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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

  const createMutation = api.skills.create.useMutation({
    onSuccess: (skill) => {
      utils.skills.list.invalidate();
      setExpandedId(skill.id);
      toast.success("Skill added");
    },
    onError: (error) => toast.error(`Failed to add skill: ${error.message}`),
  });

  const updateMutation = api.skills.update.useMutation({
    onSuccess: () => {
      utils.skills.list.invalidate();
      setExpandedId(null);
      toast.success("Skill saved");
    },
    onError: (error) => toast.error(`Failed to save skill: ${error.message}`),
  });

  const deleteMutation = api.skills.delete.useMutation({
    onSuccess: () => {
      utils.skills.list.invalidate();
      setExpandedId(null);
      toast.success("Skill deleted");
    },
    onError: (error) => toast.error(`Failed to delete skill: ${error.message}`),
  });

  const skills = (skillsQuery.data ?? []) as SkillSnapshot[];
  const defaultSkills = skills.filter((s) => s.isBuiltIn);
  const customSkills = skills.filter((s) => !s.isBuiltIn);

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

  const handleDelete = (id: string) => {
    deleteMutation.mutate({ id });
  };

  const handleReset = (id: string, field: "apps" | "sites") => {
    updateMutation.mutate({
      id,
      data:
        field === "apps"
          ? { includedApps: null }
          : { includedSites: null },
    });
  };

  const handleAddNew = () => {
    createMutation.mutate({
      name: "New skill",
      mode: "preset",
      preset: "default",
      prompt: null,
      tone: "casual",
      includedApps: [],
      includedSites: [],
    });
  };

  const savingId =
    updateMutation.isPending && updateMutation.variables?.id
      ? updateMutation.variables.id
      : deleteMutation.isPending && deleteMutation.variables?.id
        ? deleteMutation.variables.id
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
          based on the active app; add custom skills to override.
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
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold">Custom</h2>
              <Button
                variant="ghost"
                size="sm"
                className="gap-1 text-xs"
                onClick={handleAddNew}
                disabled={createMutation.isPending}
              >
                <Plus className="h-3.5 w-3.5" />{" "}
                {createMutation.isPending ? "Adding..." : "Add new"}
              </Button>
            </div>
            <Card className="p-0 overflow-clip">
              <CardContent className="p-0">
                {customSkills.length === 0 ? (
                  <div className="px-6 py-10 text-center">
                    <p className="text-sm text-muted-foreground">
                      Nothing custom yet. Add one to personalize dictation in
                      specific apps.
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-4 gap-1"
                      onClick={handleAddNew}
                      disabled={createMutation.isPending}
                    >
                      <Plus className="h-3.5 w-3.5" /> Add custom
                    </Button>
                  </div>
                ) : (
                  <div className="divide-y divide-border">
                    {customSkills.map((skill) => (
                      <SkillRow
                        key={skill.id}
                        skill={skill}
                        expanded={expandedId === skill.id}
                        saving={savingId === skill.id}
                        onToggle={() => toggle(skill.id)}
                        onSave={handleSave}
                        onDelete={() => handleDelete(skill.id)}
                        onReset={(field) => handleReset(skill.id, field)}
                      />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </section>
        </>
      )}
    </div>
  );
}
