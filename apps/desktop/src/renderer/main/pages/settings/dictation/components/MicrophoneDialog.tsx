import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowUpDown, Check, GripVertical } from "lucide-react";
import { toast } from "sonner";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { motion } from "framer-motion";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { api } from "@/trpc/react";
import { useAudioDevices } from "@/hooks/useAudioDevices";
import {
  DEFAULT_DEVICE_ID,
  findConnectedMicrophone,
  mergeConnectedMicrophones,
  promoteAmongConnected,
  resolveActiveMicrophone,
  type MicrophonePriorityEntry,
} from "@/utils/audio-devices";
import { MicLevelMeter } from "./MicLevelMeter";

export function MicrophoneDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const { data: settings, refetch: refetchSettings } =
    api.settings.getSettings.useQuery();
  const setMicrophonePriority =
    api.settings.setMicrophonePriority.useMutation();
  const { devices: audioDevices } = useAudioDevices();

  const [order, setOrder] = useState<MicrophonePriorityEntry[]>([]);
  const [reorderMode, setReorderMode] = useState(false);

  const storedPriority = settings?.recording?.microphonePriority;
  const storedKey = JSON.stringify(storedPriority ?? null);

  // Seed the chain when the dialog opens (or once the stored chain loads):
  // use the stored priority, else migrate from the legacy single preference.
  useEffect(() => {
    if (!open) {
      setReorderMode(false);
      return;
    }
    // Seed from the stored chain, otherwise from the connected devices (the
    // merge fills in every connected device, so an empty base seeds the lot).
    const base = storedPriority?.length ? storedPriority : [];
    setOrder(mergeConnectedMicrophones(base, audioDevices));
    // Intentionally keyed only on open / stored chain: re-seeding on every
    // device-list ref change would clobber an in-progress local reorder.
  }, [open, storedKey]);

  // Fold in microphones plugged in while the dialog is open, preserving rank.
  useEffect(() => {
    if (!open) return;
    setOrder((prev) => mergeConnectedMicrophones(prev, audioDevices));
  }, [open, audioDevices]);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const persistPriority = async (next: MicrophonePriorityEntry[]) => {
    const previous = order;
    const prevActive = resolveActiveMicrophone(previous, audioDevices);
    setOrder(next);
    try {
      await setMicrophonePriority.mutateAsync({ priority: next });
      await refetchSettings();

      const nextActive = resolveActiveMicrophone(next, audioDevices);
      if (nextActive !== prevActive) {
        const label = audioDevices.find(
          (device) => device.deviceId === nextActive,
        )?.label;
        toast.success(
          nextActive === DEFAULT_DEVICE_ID || !label
            ? t("settings.dictation.microphone.toast.systemDefault")
            : t("settings.dictation.microphone.toast.changed", {
                deviceName: label,
              }),
        );
      }
    } catch (error) {
      console.error("Failed to update microphone priority:", error);
      toast.error(t("settings.dictation.microphone.toast.changeFailed"));
      setOrder(previous);
    }
  };

  const handlePromote = (entry: MicrophonePriorityEntry) => {
    persistPriority(promoteAmongConnected(order, entry, audioDevices));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = order.findIndex((e) => e.deviceId === active.id);
    const newIndex = order.findIndex((e) => e.deviceId === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    persistPriority(arrayMove(order, oldIndex, newIndex));
  };

  const canReorder = order.length > 1;

  // Resolve each entry's connected device once, then derive the active mic and
  // the visible rows from that single pass. The resting view shows only
  // connected mics; the full chain (incl. disconnected, kept for fallback)
  // appears only while reordering.
  const resolvedRows = order.map((entry) => ({
    entry,
    device: findConnectedMicrophone(entry, audioDevices),
  }));
  const activeRow = resolvedRows.find((row) => row.device);
  const activeDeviceId = activeRow?.device?.deviceId ?? DEFAULT_DEVICE_ID;
  const visibleRows = reorderMode
    ? resolvedRows
    : resolvedRows.filter((row) => row.device);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {t("settings.dictation.microphone.dialog.title")}
          </DialogTitle>
          <DialogDescription>
            {t("settings.dictation.microphone.dialog.description")}
          </DialogDescription>
        </DialogHeader>

        {audioDevices.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("settings.dictation.microphone.noDevicesHelp")}
          </p>
        ) : (
          <div className="min-w-0 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {t("settings.dictation.microphone.priorityOrder")}
              </span>
              {canReorder && (
                <Button
                  variant={reorderMode ? "secondary" : "ghost"}
                  size="sm"
                  className="-mr-2 h-7 text-xs"
                  onClick={() => setReorderMode((value) => !value)}
                >
                  {reorderMode ? (
                    t("settings.dictation.microphone.reorderDone")
                  ) : (
                    <>
                      <ArrowUpDown />
                      {t("settings.dictation.microphone.reorder")}
                    </>
                  )}
                </Button>
              )}
            </div>

            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              modifiers={[restrictToVerticalAxis]}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={visibleRows.map(({ entry }) => entry.deviceId)}
                strategy={verticalListSortingStrategy}
              >
                <div className="flex min-w-0 flex-col gap-2">
                  {visibleRows.map(({ entry, device }, index) => (
                    <SortableMicRow
                      key={entry.deviceId}
                      index={index}
                      entry={entry}
                      label={device?.label ?? entry.name}
                      isDefault={entry.deviceId === DEFAULT_DEVICE_ID}
                      isConnected={!!device}
                      isActive={entry.deviceId === activeRow?.entry.deviceId}
                      reorderMode={reorderMode}
                      dialogOpen={open}
                      meterDeviceId={activeDeviceId}
                      onPromote={handlePromote}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>

            {reorderMode && (
              <p className="px-1 text-xs text-muted-foreground">
                {t("settings.dictation.microphone.reorderHint")}
              </p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SortableMicRow({
  index,
  entry,
  label,
  isDefault,
  isConnected,
  isActive,
  reorderMode,
  dialogOpen,
  meterDeviceId,
  onPromote,
}: {
  index: number;
  entry: MicrophonePriorityEntry;
  label: string;
  isDefault: boolean;
  isConnected: boolean;
  isActive: boolean;
  reorderMode: boolean;
  dialogOpen: boolean;
  meterDeviceId: string;
  onPromote: (entry: MicrophonePriorityEntry) => void;
}) {
  const { t } = useTranslation();
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: entry.deviceId, disabled: !reorderMode });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const base =
    "flex min-h-[3.25rem] items-center gap-3 rounded-lg border px-3 py-2 transition-colors";

  const subtitle = isDefault
    ? t("settings.dictation.microphone.systemDefaultSubtitle")
    : !isConnected
      ? t("settings.dictation.microphone.disconnected")
      : null;

  const details = (
    <div className="min-w-0 flex-1 text-left">
      <p className="truncate text-sm font-medium text-foreground">{label}</p>
      {subtitle && (
        <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
      )}
    </div>
  );

  if (reorderMode) {
    return (
      <div
        ref={setNodeRef}
        style={style}
        className={cn(
          base,
          "border-border bg-background",
          isDragging && "opacity-90 shadow-md",
          !isConnected && "opacity-55",
        )}
      >
        <button
          type="button"
          className="flex h-5 w-4 shrink-0 cursor-grab touch-none items-center justify-center text-muted-foreground hover:text-foreground active:cursor-grabbing"
          aria-label={t("settings.dictation.microphone.reorderHandle")}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4" />
        </button>
        {details}
      </div>
    );
  }

  return (
    <motion.button
      type="button"
      ref={setNodeRef}
      // Animate the click-to-promote reorder (dnd-kit only animates drags).
      layout
      transition={{ type: "spring", stiffness: 600, damping: 45 }}
      onClick={() => isConnected && onPromote(entry)}
      disabled={!isConnected}
      aria-pressed={isActive}
      className={cn(
        base,
        "w-full",
        isActive
          ? "border-primary bg-primary/5"
          : "border-border hover:bg-accent",
        !isConnected && "cursor-default opacity-55 hover:bg-transparent",
      )}
    >
      <span className="w-4 shrink-0 text-center text-xs tabular-nums text-muted-foreground/70">
        {index + 1}
      </span>
      {details}
      {isActive && (
        <div className="flex shrink-0 items-center gap-2.5">
          <MicLevelMeter deviceId={meterDeviceId} active={dialogOpen} />
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <Check className="h-3.5 w-3.5" />
          </span>
        </div>
      )}
    </motion.button>
  );
}
