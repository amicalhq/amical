import React, { useState } from "react";
import type { Transcription } from "@/db/schema";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { api } from "@/trpc/react";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Copy,
  Play,
  Trash2,
  Download,
  FileText,
  Search,
  MoreHorizontal,
  FileAudio,
} from "lucide-react";
import { format } from "date-fns";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export const TranscriptionsList: React.FC = () => {
  const [searchTerm, setSearchTerm] = useState("");
  const [openDropdownId, setOpenDropdownId] = useState<number | null>(null);

  // tRPC React Query hooks
  const transcriptionsQuery = api.transcriptions.getTranscriptions.useQuery(
    {
      limit: 50,
      offset: 0,
      sortBy: "timestamp",
      sortOrder: "desc",
      search: searchTerm || undefined,
    },
    {
      refetchInterval: 2000, // Poll every 2 seconds, auto-pauses when out of focus
    },
  );

  const transcriptionsCountQuery =
    api.transcriptions.getTranscriptionsCount.useQuery(
      {
        search: searchTerm || undefined,
      },
      {
        refetchInterval: 2000, // Poll every 2 seconds, auto-pauses when out of focus
      },
    );

  const utils = api.useUtils();

  const deleteTranscriptionMutation =
    api.transcriptions.deleteTranscription.useMutation({
      onSuccess: () => {
        // Invalidate and refetch transcriptions data
        utils.transcriptions.getTranscriptions.invalidate();
        utils.transcriptions.getTranscriptionsCount.invalidate();
      },
      onError: (error) => {
        console.error("Error deleting transcription:", error);
      },
    });

  const downloadAudioMutation =
    api.transcriptions.downloadAudioFile.useMutation({
      onError: (error) => {
        console.error("Error downloading audio:", error);
      },
    });

  const transcriptions = transcriptionsQuery.data || [];
  const totalCount = transcriptionsCountQuery.data || 0;
  const loading =
    transcriptionsQuery.isLoading || transcriptionsCountQuery.isLoading;

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      console.log("Copied to clipboard");
    } catch (err) {
      console.error("Failed to copy text: ", err);
    }
  };

  const handleDelete = async (id: number) => {
    deleteTranscriptionMutation.mutate({ id });
  };

  const handlePlayAudio = (audioFile: string) => {
    // Implement audio playback functionality
    console.log("Playing audio:", audioFile);
  };

  const handleDownloadAudio = async (transcriptionId: number) => {
    console.log("Downloading audio:", transcriptionId);
    // Close dropdown first
    setOpenDropdownId(null);

    // Small delay to ensure dropdown closes before system dialog opens
    setTimeout(async () => {
      try {
        await downloadAudioMutation.mutateAsync({ transcriptionId });
      } catch (error) {
        console.error("Failed to download audio:", error);
      }
    }, 0);
  };

  const getTitle = (text: string) => {
    if (!text || text.trim() === "") {
      return `no words detected`;
    }
    const firstSentence = text.split(".")[0];
    return firstSentence.length > 50
      ? firstSentence.substring(0, 50) + "..."
      : firstSentence;
  };

  const getWordCount = (text: string) => {
    const trimmedText = text.trim();
    if (!trimmedText) return 0;
    return trimmedText.split(/\s+/).length;
  };

  const renderLoadingState = () => (
    <Card>
      <CardContent className="py-12">
        <div className="flex flex-col items-center space-y-2 text-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-300 border-t-blue-600"></div>
          <p className="text-sm text-muted-foreground">
            Loading transcriptions...
          </p>
        </div>
      </CardContent>
    </Card>
  );

  const renderEmptyState = () => (
    <Card>
      <CardContent className="py-12">
        <div className="flex flex-col items-center space-y-2 text-center">
          <FileText className="h-12 w-12 text-muted-foreground/50" />
          <h3 className="text-lg font-medium">No transcriptions found</h3>
          <p className="text-sm text-muted-foreground max-w-sm">
            {searchTerm
              ? "Try adjusting your search terms."
              : "Start recording to see your transcriptions here."}
          </p>
          {!searchTerm && <Button className="mt-4">Start Recording</Button>}
        </div>
      </CardContent>
    </Card>
  );

  const renderTranscriptionCard = (transcription: Transcription) => (
    <Card
      key={transcription.id}
      className="hover:shadow-md transition-shadow overflow-hidden"
    >
      <CardContent className="p-4">
        <div className="flex items-center gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3">
              <h3
                className={`font-medium truncate ${!transcription.text.trim() ? "font-mono text-muted-foreground" : ""}`}
              >
                {getTitle(transcription.text)}
              </h3>
            </div>
          </div>

          <div className="flex items-center gap-1 flex-shrink-0">
            <div className="flex items-center gap-2 text-sm text-muted-foreground flex-shrink-0">
              <Badge variant="secondary" className="text-xs">
                {getWordCount(transcription.text)} words
              </Badge>
              <span className="hidden sm:inline">
                {format(new Date(transcription.timestamp), "MMM d")}
              </span>
              <span>{format(new Date(transcription.timestamp), "h:mm a")}</span>
              <Badge variant="outline" className="text-xs">
                {transcription.language?.toUpperCase() || "EN"}
              </Badge>
            </div>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0"
                    onClick={() => copyToClipboard(transcription.text)}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Copy transcription</TooltipContent>
              </Tooltip>
            </TooltipProvider>

            {transcription.audioFile && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0"
                      onClick={() => handlePlayAudio(transcription.audioFile!)}
                    >
                      <Play className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Play audio</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}

            <DropdownMenu
              open={openDropdownId === transcription.id}
              onOpenChange={(open) =>
                setOpenDropdownId(open ? transcription.id : null)
              }
            >
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Actions</DropdownMenuLabel>
                {transcription.audioFile && (
                  <>
                    <DropdownMenuItem
                      onClick={() => handleDownloadAudio(transcription.id)}
                      disabled={downloadAudioMutation.isPending}
                    >
                      <FileAudio className="h-4 w-4 mr-2" />
                      Download Audio
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                <DropdownMenuItem
                  onClick={() => handleDelete(transcription.id)}
                  className="text-destructive"
                  disabled={deleteTranscriptionMutation.isPending}
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </CardContent>
    </Card>
  );

  const renderTranscriptionsList = () => (
    <div className="grid gap-3">
      {transcriptions.map(renderTranscriptionCard)}
    </div>
  );

  const renderFooter = () => {
    if (loading || transcriptions.length === 0) return null;

    return (
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          Showing {transcriptions.length} of {totalCount} transcription
          {totalCount !== 1 ? "s" : ""}
        </span>
        <span>
          Total:{" "}
          {transcriptions.reduce((acc, t) => acc + getWordCount(t.text), 0)}{" "}
          words
        </span>
      </div>
    );
  };

  const renderContent = () => {
    if (loading) return renderLoadingState();
    if (transcriptions.length === 0) return renderEmptyState();
    return renderTranscriptionsList();
  };

  return (
    <div className="space-y-6">
      {/* Search and Filter Bar */}
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

      {/* Transcriptions Content */}
      {renderContent()}

      {/* Footer Stats */}
      {renderFooter()}
    </div>
  );
};
