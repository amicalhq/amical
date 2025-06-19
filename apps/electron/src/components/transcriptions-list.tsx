import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
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
import { Copy, Play, Trash2, Download, FileText, Search, Filter, MoreHorizontal } from 'lucide-react';
import { formatDistanceToNow, format } from 'date-fns';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

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
    text: 'Team Sync 19 Jun 2025 - Discussion about the upcoming product launch, marketing strategies, and resource allocation for Q3. We covered the budget requirements, timeline milestones, and key stakeholder responsibilities.',
    timestamp: new Date('2025-06-19T10:42:00'),
    language: 'en',
    audioFile: 'team-sync-19-jun.wav'
  },
  {
    id: '2', 
    text: 'Investor Pitch Draft - Comprehensive overview of our business model, market opportunity, competitive landscape, and financial projections. Highlighted key metrics and growth trajectory for potential investors.',
    timestamp: new Date('2025-06-18T18:01:00'),
    language: 'en',
    audioFile: 'investor-pitch-draft.wav'
  },
  {
    id: '3',
    text: 'Client Meeting Notes - Detailed discussion with ABC Corp regarding their requirements for the new software integration. Covered technical specifications, timeline expectations, and budget considerations.',
    timestamp: new Date('2025-06-17T14:30:00'),
    language: 'en',
    audioFile: 'client-meeting-abc.wav'
  },
  {
    id: '4',
    text: 'Product Roadmap Review - Strategic planning session covering feature prioritization, development timelines, and resource allocation for the next quarter. Discussed user feedback and market demands.',
    timestamp: new Date('2025-06-16T09:15:00'),
    language: 'en',
    audioFile: 'product-roadmap.wav'
  },
  {
    id: '5',
    text: 'Weekly Standup - Quick update on current project status, blockers, and upcoming deliverables. Team coordination and sprint planning discussion.',
    timestamp: new Date('2025-06-15T11:00:00'),
    language: 'en',
    audioFile: 'weekly-standup.wav'
  },
];

export const TranscriptionsList: React.FC = () => {
  const [transcriptions, setTranscriptions] = useState<Transcription[]>(mockTranscriptions);
  const [searchTerm, setSearchTerm] = useState('');

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

  const filteredTranscriptions = transcriptions.filter(transcription =>
    transcription.text.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const getTitle = (text: string) => {
    const firstSentence = text.split('.')[0];
    return firstSentence.length > 50 ? firstSentence.substring(0, 50) + '...' : firstSentence;
  };

  const getWordCount = (text: string) => {
    return text.split(' ').length;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Transcriptions</h2>
          <p className="text-muted-foreground mt-1">
            View and manage your voice recording transcriptions
          </p>
        </div>
        <div className="flex items-center space-x-2">
          <Button variant="outline">Export All</Button>
          <Button>New Recording</Button>
        </div>
      </div>

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
        <Button variant="outline" size="sm">
          <Filter className="h-4 w-4 mr-2" />
          Filter
        </Button>
      </div>

      {/* Transcriptions Grid */}
      {filteredTranscriptions.length === 0 ? (
        <Card>
          <CardContent className="py-12">
            <div className="flex flex-col items-center space-y-2 text-center">
              <FileText className="h-12 w-12 text-muted-foreground/50" />
              <h3 className="text-lg font-medium">No transcriptions found</h3>
              <p className="text-sm text-muted-foreground max-w-sm">
                {searchTerm ? 'Try adjusting your search terms.' : 'Start recording to see your transcriptions here.'}
              </p>
              {!searchTerm && (
                <Button className="mt-4">Start Recording</Button>
              )}
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {filteredTranscriptions.map((transcription) => (
            <Card key={transcription.id} className="hover:shadow-md transition-shadow">
              <CardContent className="px-4 py-0">
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0 mr-4">
                    <div className="flex items-center space-x-3">
                      <h3 className="font-medium truncate flex-1">
                        {getTitle(transcription.text)}
                      </h3>
                      <div className="flex items-center space-x-2 text-sm text-muted-foreground shrink-0">
                        <Badge variant="secondary" className="text-xs">
                          {getWordCount(transcription.text)} words
                        </Badge>
                        <span>{format(transcription.timestamp, 'MMM d')}</span>
                        <span>{format(transcription.timestamp, 'h:mm a')}</span>
                        <Badge variant="outline" className="text-xs">
                          {transcription.language?.toUpperCase() || 'EN'}
                        </Badge>
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex items-center space-x-1">
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

                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuLabel>Actions</DropdownMenuLabel>
                        <DropdownMenuItem onClick={() => handleDownload(transcription)}>
                          <Download className="h-4 w-4 mr-2" />
                          Download
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem 
                          onClick={() => handleDelete(transcription.id)}
                          className="text-destructive"
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
          ))}
        </div>
      )}

      {filteredTranscriptions.length > 0 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Showing {filteredTranscriptions.length} of {transcriptions.length} transcription{transcriptions.length !== 1 ? 's' : ''}
          </span>
          <span>
            Total: {transcriptions.reduce((acc, t) => acc + getWordCount(t.text), 0)} words
          </span>
        </div>
      )}
    </div>
  );
}; 