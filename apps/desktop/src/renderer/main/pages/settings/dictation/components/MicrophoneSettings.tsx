import { Label } from "@/components/ui/label";
import { api } from "@/trpc/react";
import { useAudioDevices } from "@/hooks/useAudioDevices";
import { toast } from "sonner";
import { GripVertical, Mic } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useState, useEffect, useCallback } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";

interface SortableDeviceItemProps {
  id: string;
  label: string;
  isConnected: boolean;
  rank: number;
}

function SortableDeviceItem({
  id,
  label,
  isConnected,
  rank,
}: SortableDeviceItemProps) {
  const { t } = useTranslation();
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm ${
        isDragging
          ? "border-primary bg-primary/5 shadow-md z-10"
          : isConnected
            ? "border-border bg-background"
            : "border-border/50 bg-muted/30 text-muted-foreground"
      }`}
    >
      <button
        className="cursor-grab active:cursor-grabbing touch-none"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4 text-muted-foreground" />
      </button>
      <span className="text-xs text-muted-foreground w-5">{rank}</span>
      <Mic className="h-4 w-4 flex-shrink-0" />
      <span className="flex-1 truncate">{label}</span>
      {isConnected ? (
        <span className="text-xs text-green-500">
          {t("settings.dictation.microphone.connected")}
        </span>
      ) : (
        <span className="text-xs text-muted-foreground">
          {t("settings.dictation.microphone.disconnected")}
        </span>
      )}
    </div>
  );
}

export function MicrophoneSettings() {
  const { t } = useTranslation();
  const { data: settings, refetch: refetchSettings } =
    api.settings.getSettings.useQuery();
  const setMicrophonePriorityList =
    api.settings.setMicrophonePriorityList.useMutation();
  const { devices: audioDevices } = useAudioDevices();

  // Priority list from settings (device names)
  const savedPriorityList =
    settings?.recording?.microphonePriorityList ?? [];

  // Local state for the sortable list
  const [priorityList, setPriorityList] = useState<string[]>([]);

  // Connected device names (excluding "default" entry)
  const connectedDeviceNames = audioDevices
    .filter((d) => !d.isDefault)
    .map((d) => d.label);

  // Sync priority list when settings or devices change
  useEffect(() => {
    // Start with saved priority list
    const list = [...savedPriorityList];

    // Add newly connected devices not yet in the list
    for (const name of connectedDeviceNames) {
      if (!list.includes(name)) {
        list.push(name);
      }
    }

    setPriorityList(list);
  }, [
    // Use JSON string to avoid reference equality issues with arrays
    JSON.stringify(savedPriorityList),
    JSON.stringify(connectedDeviceNames),
  ]);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const savePriorityList = useCallback(
    async (newList: string[]) => {
      try {
        await setMicrophonePriorityList.mutateAsync({
          deviceNames: newList,
        });
        await refetchSettings();
        toast.success(t("settings.dictation.microphone.toast.priorityUpdated"));
      } catch (error) {
        console.error("Failed to save microphone priority list:", error);
        toast.error(t("settings.dictation.microphone.toast.changeFailed"));
      }
    },
    [setMicrophonePriorityList, refetchSettings, t],
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = priorityList.indexOf(active.id as string);
    const newIndex = priorityList.indexOf(over.id as string);
    const newList = arrayMove(priorityList, oldIndex, newIndex);

    setPriorityList(newList);
    savePriorityList(newList);
  };

  return (
    <div>
      <div className="mb-2">
        <Label className="text-base font-semibold text-foreground">
          {t("settings.dictation.microphone.label")}
        </Label>
        <p className="text-xs text-muted-foreground mb-2">
          {t("settings.dictation.microphone.priorityDescription")}
        </p>
      </div>

      {priorityList.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("settings.dictation.microphone.noDevices")}
        </p>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToVerticalAxis]}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={priorityList}
            strategy={verticalListSortingStrategy}
          >
            <div className="space-y-1">
              {priorityList.map((deviceName, index) => (
                <SortableDeviceItem
                  key={deviceName}
                  id={deviceName}
                  label={deviceName}
                  isConnected={connectedDeviceNames.includes(deviceName)}
                  rank={index + 1}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {/* System default fallback indicator */}
      <div className="mt-2 flex items-center gap-2 rounded-md border border-dashed border-border px-3 py-2 text-sm text-muted-foreground">
        <span className="w-5" />
        <Mic className="h-4 w-4 flex-shrink-0" />
        <span className="flex-1">
          {t("settings.dictation.microphone.systemDefaultFallback")}
        </span>
      </div>
    </div>
  );
}
