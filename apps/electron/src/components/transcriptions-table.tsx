import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from '@/components/ui/table';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Copy, Play, Trash2, Download, FileText } from 'lucide-react';
import { formatDistanceToNow, format } from 'date-fns';

interface Transcription {
  id: string;
  text: string;
  timestamp: Date;
  language?: string;
  audioFile?: string;
}

// Mock data - this would come from your actual data source
const mockTranscriptions: Transcription[] = [
  {
    id: '1',
    text: 'This is a sample transcription of a recording that was made earlier today. It contains multiple sentences and demonstrates how the truncation and tooltip functionality works in the table.',
    timestamp: new Date('2024-01-15T10:30:00'),
    language: 'en',
    audioFile: 'recording-1.wav'
  },
  {
    id: '2', 
    text: 'Short transcription.',
    timestamp: new Date('2024-01-15T09:15:00'),
    language: 'en',
    audioFile: 'recording-2.wav'
  },
  {
    id: '3',
    text: 'Another longer transcription that demonstrates the table functionality with multiple rows of data and shows how the system handles various lengths of transcribed text content.',
    timestamp: new Date('2024-01-14T16:45:00'),
    language: 'en',
    audioFile: 'recording-3.wav'
  },
];

export const TranscriptionsTable: React.FC = () => {
  const [transcriptions, setTranscriptions] = useState<Transcription[]>(mockTranscriptions);

  const truncateText = (text: string, maxLength: number = 100) => {
    return text.length > maxLength ? `${text.substring(0, maxLength)}...` : text;
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      // You could add a toast notification here
      console.log('Copied to clipboard');
    } catch (err) {
      console.error('Failed to copy text: ', err);
    }
  };

  const handleDelete = (id: string) => {
    setTranscriptions(prev => prev.filter(t => t.id !== id));
  };

  const handlePlayAudio = (audioFile: string) => {
    // Implement audio playback functionality
    console.log('Playing audio:', audioFile);
  };

  const handleDownload = (transcription: Transcription) => {
    // Create and download a text file with the transcription
    const element = document.createElement('a');
    const file = new Blob([transcription.text], { type: 'text/plain' });
    element.href = URL.createObjectURL(file);
    element.download = `transcription-${transcription.id}.txt`;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Transcriptions</h2>
          <p className="text-muted-foreground mt-1">
            View and manage your voice recording transcriptions
          </p>
        </div>
      </div>

      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-[50%] font-semibold">Transcription</TableHead>
              <TableHead className="w-[200px] font-semibold">Date</TableHead>
              <TableHead className="w-[120px] font-semibold">Language</TableHead>
              <TableHead className="w-[100px] text-right font-semibold">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {transcriptions.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center py-12 text-muted-foreground">
                  <div className="flex flex-col items-center space-y-2">
                    <FileText className="h-8 w-8 text-muted-foreground/50" />
                    <p className="text-sm">No transcriptions found.</p>
                    <p className="text-xs">Start recording to see your transcriptions here.</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              transcriptions.map((transcription) => (
                <TableRow key={transcription.id} className="hover:bg-muted/50">
                  <TableCell className="max-w-0 py-4">
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="truncate font-medium">
                            {truncateText(transcription.text)}
                          </div>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-md">
                          <p className="whitespace-pre-wrap">{transcription.text}</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </TableCell>
                  <TableCell className="py-4">
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="text-sm text-muted-foreground">
                            {formatDistanceToNow(transcription.timestamp, { addSuffix: true })}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>{format(transcription.timestamp, 'PPpp')}</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </TableCell>
                  <TableCell className="py-4">
                    <span className="uppercase text-xs bg-secondary px-2 py-1 rounded">
                      {transcription.language || 'N/A'}
                    </span>
                  </TableCell>
                  <TableCell className="py-4">
                    <div className="flex justify-end space-x-1">
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
                              <span className="sr-only">Copy transcription</span>
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>Copy transcription</p>
                          </TooltipContent>
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
                                <span className="sr-only">Play audio</span>
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>Play audio</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      )}

                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 p-0"
                              onClick={() => handleDownload(transcription)}
                            >
                              <Download className="h-4 w-4" />
                              <span className="sr-only">Download transcription</span>
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>Download transcription</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>

                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                              onClick={() => handleDelete(transcription.id)}
                            >
                              <Trash2 className="h-4 w-4" />
                              <span className="sr-only">Delete transcription</span>
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>Delete transcription</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {transcriptions.length > 0 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Showing {transcriptions.length} of {transcriptions.length} transcription{transcriptions.length !== 1 ? 's' : ''}
          </span>
          <span>
            Total: {transcriptions.length} transcription{transcriptions.length !== 1 ? 's' : ''}
          </span>
        </div>
      )}
    </div>
  );
}; 