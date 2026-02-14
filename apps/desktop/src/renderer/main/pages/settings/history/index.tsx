import { useState } from "react";
import type { Transcription } from "@/db/schema";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableRow, TableCell } from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Copy,
  Play,
  Pause,
  Download,
  Trash2,
  MicOff,
  Search,
  RotateCcw,
  Loader2,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { api } from "@/trpc/react";
import { useAudioPlayer } from "@/hooks/useAudioPlayer";
import { format } from "date-fns";
import { useTranslation } from "react-i18next";

function formatDate(timestamp: Date) {
  return format(timestamp, "MMM d, h:mm a");
}

function getDateGroup(timestamp: Date) {
  const today = new Date();
  const itemDate = new Date(timestamp);

  // Reset time to compare only dates
  const todayDate = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );
  const itemDateOnly = new Date(
    itemDate.getFullYear(),
    itemDate.getMonth(),
    itemDate.getDate(),
  );

  const diffTime = todayDate.getTime() - itemDateOnly.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "today";
  if (diffDays === 1) return "yesterday";
  return "earlier";
}

function groupHistoryByDate(history: Transcription[]) {
  const grouped = {
    today: [] as Transcription[],
    yesterday: [] as Transcription[],
    earlier: [] as Transcription[],
  };

  history.forEach((item) => {
    const group = getDateGroup(item.timestamp);
    grouped[group as keyof typeof grouped].push(item);
  });

  return grouped;
}

interface HistoryTableCardProps {
  items: Transcription[];
  onCopy: (text: string) => void;
  onPlay: (transcriptionId: number) => void;
  onDownload: (transcriptionId: number) => void;
  onDelete: (id: number) => void;
  onRetry: (id: number) => void;
  hovered: number | null;
  setHovered: (id: number | null) => void;
  currentPlayingId: number | null;
  isPlaying: boolean;
  retryingId: number | null;
}

function HistoryTableCard({
  items,
  onCopy,
  onPlay,
  onDownload,
  onDelete,
  onRetry,
  setHovered,
  currentPlayingId,
  isPlaying,
  retryingId,
}: HistoryTableCardProps) {
  const { t } = useTranslation();
  const [selectedText, setSelectedText] = useState<string | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const handleReadMore = (text: string) => {
    setSelectedText(text);
    setIsDialogOpen(true);
  };

  const getTitle = (text: string, meta?: { status?: string }) => {
    if (!text || text.trim() === "") {
      if (meta?.status === "failed") {
        return t("settings.history.item.failed");
      }
      return t("settings.history.item.noWords");
    }
    return text;
  };

  return (
    <>
      <Card className="p-0">
        <CardContent className="p-0">
          <Table>
            <TableBody>
              {items.map((item) => (
                <TableRow
                  key={item.id}
                  onMouseEnter={() => setHovered(item.id)}
                  onMouseLeave={() => setHovered(null)}
                  className="group hover:bg-muted/40 transition px-4"
                >
                  <TableCell className="align-top text-xs text-muted-foreground pt-4.5 px-4">
                    {formatDate(item.timestamp)}
                  </TableCell>
                  <TableCell className="align-top py-4 px-4">
                    <div className="text-foreground max-w-[500px]">
                      <div
                        className={`line-clamp-3 whitespace-pre-line ${
                          !item.text.trim()
                            ? (item.meta as { status?: string })?.status ===
                              "failed"
                              ? "font-mono text-destructive"
                              : "font-mono text-muted-foreground"
                            : ""
                        }`}
                      >
                        {getTitle(item.text, item.meta as { status?: string })}
                      </div>
                      {item.text.split("\n").length > 3 ||
                      item.text.length > 200 ? (
                        <Button
                          variant="link"
                          size="sm"
                          className="p-0 h-auto text-xs text-muted-foreground hover:text-foreground mt-1"
                          onClick={() => handleReadMore(item.text)}
                        >
                          {t("settings.history.readMore")}
                        </Button>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="w-32 align-top text-right">
                    <div className="flex gap-2 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => onCopy(item.text)}
                            >
                              <Copy className="w-4 h-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>{t("settings.history.actions.copy")}</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                      {item.audioFile && (
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => onPlay(item.id)}
                              >
                                {currentPlayingId === item.id && isPlaying ? (
                                  <Pause className="w-4 h-4" />
                                ) : (
                                  <Play className="w-4 h-4" />
                                )}
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>
                                {currentPlayingId === item.id && isPlaying
                                  ? t("settings.history.actions.pauseAudio")
                                  : t("settings.history.actions.playAudio")}
                              </p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      )}
                      {item.audioFile && (
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => onDownload(item.id)}
                              >
                                <Download className="w-4 h-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>
                                {t("settings.history.actions.downloadAudio")}
                              </p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      )}
                      {item.audioFile && (
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                size="icon"
                                variant="ghost"
                                disabled={retryingId === item.id}
                                onClick={() => onRetry(item.id)}
                              >
                                {retryingId === item.id ? (
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                  <RotateCcw className="w-4 h-4" />
                                )}
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>{t("settings.history.actions.retry")}</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      )}
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => onDelete(item.id)}
                            >
                              <Trash2 className="w-4 h-4 text-destructive" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>{t("settings.history.actions.delete")}</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto bg-secondary">
          <DialogHeader>
            <DialogTitle>{t("settings.history.dialog.title")}</DialogTitle>
          </DialogHeader>
          <div className="whitespace-pre-line text-sm leading-relaxed">
            {selectedText}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default function HistorySettingsPage() {
  const { t } = useTranslation();
  const [searchTerm, setSearchTerm] = useState("");
  const [hovered, setHovered] = useState<number | null>(null);
  const audioPlayer = useAudioPlayer();

  // tRPC React Query hooks
  const transcriptionsQuery = api.transcriptions.getTranscriptions.useQuery(
    {
      limit: 100, // Get more records for history view
      offset: 0,
      sortBy: "timestamp",
      sortOrder: "desc",
      search: searchTerm || undefined,
    },
    {
      refetchInterval: 5000, // Poll every 5 seconds for updates
    },
  );

  const utils = api.useUtils();

  const deleteTranscriptionMutation =
    api.transcriptions.deleteTranscription.useMutation({
      onSuccess: () => {
        // Invalidate and refetch transcriptions data
        utils.transcriptions.getTranscriptions.invalidate();
        toast.success(t("settings.history.toast.deleted"));
      },
      onError: (error) => {
        console.error("Error deleting transcription:", error);
        toast.error(t("settings.history.toast.deleteFailed"));
      },
    });

  const [retryingId, setRetryingId] = useState<number | null>(null);

  const retryTranscriptionMutation =
    api.transcriptions.retryTranscription.useMutation({
      onSuccess: () => {
        utils.transcriptions.getTranscriptions.invalidate();
        toast.success(t("settings.history.toast.retrySuccess"));
        setRetryingId(null);
      },
      onError: (error) => {
        console.error("Error retrying transcription:", error);
        toast.error(t("settings.history.toast.retryFailed"));
        setRetryingId(null);
      },
    });

  const downloadAudioMutation =
    api.transcriptions.downloadAudioFile.useMutation({
      onSuccess: () => {
        toast.success(t("settings.history.toast.downloaded"));
      },
      onError: (error) => {
        console.error("Error downloading audio:", error);
        toast.error(t("settings.history.toast.downloadFailed"));
      },
    });

  // Using mutation for fetching audio data instead of query to:
  // - Prevent caching of large binary audio files in memory
  // - Avoid automatic refetching behaviors (window focus, network reconnect)
  // - Clearly indicate this is a user-triggered action (play button click)
  // - Track loading state per transcription ID efficiently
  const getAudioFileMutation = api.transcriptions.getAudioFile.useMutation({
    onSuccess: (data, variables) => {
      if (data?.data) {
        // Decode base64 to ArrayBuffer
        const base64 = data.data;
        const binaryString = atob(base64);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        // Pass the MIME type from the server response
        audioPlayer.toggle(
          bytes.buffer,
          variables.transcriptionId,
          data.mimeType,
        );
      }
    },
    onError: (error) => {
      console.error("Error fetching audio file:", error);
      toast.error(t("settings.history.toast.loadAudioFailed"));
    },
  });

  const transcriptions = transcriptionsQuery.data || [];

  function handleCopy(text: string) {
    navigator.clipboard.writeText(text);
    toast.success(t("settings.history.toast.copied"));
  }

  const handlePlayAudio = (transcriptionId: number) => {
    if (
      audioPlayer.currentPlayingId === transcriptionId &&
      audioPlayer.isPlaying
    ) {
      audioPlayer.stop();
    } else {
      getAudioFileMutation.mutate({ transcriptionId });
    }
  };

  function handleDownload(transcriptionId: number) {
    downloadAudioMutation.mutate({ transcriptionId });
  }

  function handleRetry(id: number) {
    setRetryingId(id);
    retryTranscriptionMutation.mutate({ id });
  }

  function handleDelete(id: number) {
    deleteTranscriptionMutation.mutate({ id });
  }

  const groupedHistory = groupHistoryByDate(transcriptions);

  return (
    <div>
      {/* Header Section */}
      <div className="mb-8">
        <h1 className="text-xl font-bold">{t("settings.history.title")}</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {t("settings.history.description")}
        </p>
      </div>

      <div className="space-y-6">
        {/* Search Bar */}
        <div className="flex items-center space-x-4">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
            <Input
              placeholder={t("settings.history.search.placeholder")}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
        </div>

        {transcriptions.length === 0 ? (
          <Card className="p-0">
            <CardContent className="p-0">
              <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground gap-2">
                <MicOff className="w-10 h-10 mb-2" />
                <div className="text-base font-semibold">
                  {searchTerm
                    ? t("settings.history.empty.searchTitle")
                    : t("settings.history.empty.defaultTitle")}
                </div>
                <div className="text-xs">
                  {searchTerm
                    ? t("settings.history.empty.searchDescription")
                    : t("settings.history.empty.defaultDescription")}
                </div>
              </div>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Today's Entries */}
            {groupedHistory.today.length > 0 && (
              <>
                <div className="text-sm font-medium text-muted-foreground">
                  {t("settings.history.group.today")}
                </div>
                <HistoryTableCard
                  items={groupedHistory.today}
                  onCopy={handleCopy}
                  onPlay={handlePlayAudio}
                  onDownload={handleDownload}
                  onDelete={handleDelete}
                  onRetry={handleRetry}
                  hovered={hovered}
                  setHovered={setHovered}
                  currentPlayingId={audioPlayer.currentPlayingId}
                  isPlaying={audioPlayer.isPlaying}
                  retryingId={retryingId}
                />
              </>
            )}

            {/* Yesterday's Entries */}
            {groupedHistory.yesterday.length > 0 && (
              <>
                <div className="text-sm font-medium text-muted-foreground">
                  {t("settings.history.group.yesterday")}
                </div>
                <HistoryTableCard
                  items={groupedHistory.yesterday}
                  onCopy={handleCopy}
                  onPlay={handlePlayAudio}
                  onDownload={handleDownload}
                  onDelete={handleDelete}
                  onRetry={handleRetry}
                  hovered={hovered}
                  setHovered={setHovered}
                  currentPlayingId={audioPlayer.currentPlayingId}
                  isPlaying={audioPlayer.isPlaying}
                  retryingId={retryingId}
                />
              </>
            )}

            {/* Earlier Entries */}
            {groupedHistory.earlier.length > 0 && (
              <>
                <div className="text-sm font-medium text-muted-foreground">
                  {t("settings.history.group.earlier")}
                </div>
                <HistoryTableCard
                  items={groupedHistory.earlier}
                  onCopy={handleCopy}
                  onPlay={handlePlayAudio}
                  onDownload={handleDownload}
                  onDelete={handleDelete}
                  onRetry={handleRetry}
                  hovered={hovered}
                  setHovered={setHovered}
                  currentPlayingId={audioPlayer.currentPlayingId}
                  isPlaying={audioPlayer.isPlaying}
                  retryingId={retryingId}
                />
              </>
            )}

            {/* Show message when no entries in any group after filtering */}
            {groupedHistory.today.length === 0 &&
              groupedHistory.yesterday.length === 0 &&
              groupedHistory.earlier.length === 0 && (
                <Card className="p-0">
                  <CardContent className="p-0">
                    <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground gap-2">
                      <MicOff className="w-10 h-10 mb-2" />
                      <div className="text-lg font-semibold">
                        {t("settings.history.empty.searchTitle")}
                      </div>
                      <div className="text-sm">
                        {t("settings.history.empty.searchDescription")}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}
          </>
        )}
      </div>
    </div>
  );
}
