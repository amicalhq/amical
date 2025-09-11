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
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { api } from "@/trpc/react";
import { useAudioPlayer } from "@/hooks/useAudioPlayer";
import { format } from "date-fns";

// Helper to get formatted title
function getTitle(text: string) {
  if (!text || text.trim() === "") {
    return `no words detected`;
  }
  return text;
}

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
  hovered: number | null;
  setHovered: (id: number | null) => void;
  currentPlayingId: number | null;
  isPlaying: boolean;
}

function HistoryTableCard({
  items,
  onCopy,
  onPlay,
  onDownload,
  onDelete,
  setHovered,
  currentPlayingId,
  isPlaying,
}: HistoryTableCardProps) {
  const [selectedText, setSelectedText] = useState<string | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const handleReadMore = (text: string) => {
    setSelectedText(text);
    setIsDialogOpen(true);
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
                        className={`line-clamp-3 whitespace-pre-line ${!item.text.trim() ? "font-mono text-muted-foreground" : ""}`}
                      >
                        {getTitle(item.text)}
                      </div>
                      {item.text.split("\n").length > 3 ||
                      item.text.length > 200 ? (
                        <Button
                          variant="link"
                          size="sm"
                          className="p-0 h-auto text-xs text-muted-foreground hover:text-foreground mt-1"
                          onClick={() => handleReadMore(item.text)}
                        >
                          Read more
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
                            <p>Copy</p>
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
                                  ? "Pause audio"
                                  : "Play audio"}
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
                              <p>Download Audio</p>
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
                            <p>Delete</p>
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
            <DialogTitle>Transcription Details</DialogTitle>
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
        toast.success("Transcription deleted");
      },
      onError: (error) => {
        console.error("Error deleting transcription:", error);
        toast.error("Failed to delete transcription");
      },
    });

  const downloadAudioMutation =
    api.transcriptions.downloadAudioFile.useMutation({
      onSuccess: () => {
        toast.success("Audio file downloaded");
      },
      onError: (error) => {
        console.error("Error downloading audio:", error);
        toast.error("Failed to download audio file");
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
      toast.error("Failed to load audio file");
    },
  });

  const transcriptions = transcriptionsQuery.data || [];

  function handleCopy(text: string) {
    navigator.clipboard.writeText(text);
    toast.success("Copied to clipboard");
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

  function handleDelete(id: number) {
    deleteTranscriptionMutation.mutate({ id });
  }

  const groupedHistory = groupHistoryByDate(transcriptions);

  return (
    <div className="container mx-auto p-6 max-w-5xl">
      {/* Header Section */}
      <div className="mb-8">
        <h1 className="text-xl font-bold">History</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Your recent transcription history
        </p>
      </div>

      <div className="space-y-6">
        {/* Search Bar */}
        <div className="flex items-center space-x-4">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
            <Input
              placeholder="Search transcriptions..."
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
                    ? "No transcriptions found"
                    : "No transcription history yet"}
                </div>
                <div className="text-xs">
                  {searchTerm
                    ? "Try adjusting your search terms."
                    : "Your recent transcriptions will appear here."}
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
                  Today
                </div>
                <HistoryTableCard
                  items={groupedHistory.today}
                  onCopy={handleCopy}
                  onPlay={handlePlayAudio}
                  onDownload={handleDownload}
                  onDelete={handleDelete}
                  hovered={hovered}
                  setHovered={setHovered}
                  currentPlayingId={audioPlayer.currentPlayingId}
                  isPlaying={audioPlayer.isPlaying}
                />
              </>
            )}

            {/* Yesterday's Entries */}
            {groupedHistory.yesterday.length > 0 && (
              <>
                <div className="text-sm font-medium text-muted-foreground">
                  Yesterday
                </div>
                <HistoryTableCard
                  items={groupedHistory.yesterday}
                  onCopy={handleCopy}
                  onPlay={handlePlayAudio}
                  onDownload={handleDownload}
                  onDelete={handleDelete}
                  hovered={hovered}
                  setHovered={setHovered}
                  currentPlayingId={audioPlayer.currentPlayingId}
                  isPlaying={audioPlayer.isPlaying}
                />
              </>
            )}

            {/* Earlier Entries */}
            {groupedHistory.earlier.length > 0 && (
              <>
                <div className="text-sm font-medium text-muted-foreground">
                  Earlier
                </div>
                <HistoryTableCard
                  items={groupedHistory.earlier}
                  onCopy={handleCopy}
                  onPlay={handlePlayAudio}
                  onDownload={handleDownload}
                  onDelete={handleDelete}
                  hovered={hovered}
                  setHovered={setHovered}
                  currentPlayingId={audioPlayer.currentPlayingId}
                  isPlaying={audioPlayer.isPlaying}
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
                        No transcriptions found
                      </div>
                      <div className="text-sm">
                        Try adjusting your search terms.
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
