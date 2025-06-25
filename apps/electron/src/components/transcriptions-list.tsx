import React, { useState, useEffect } from 'react';
import type { Transcription } from '@/db/schema';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Copy, Play, Trash2, Download, FileText, Search, Filter, MoreHorizontal } from 'lucide-react';
import { format } from 'date-fns';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

// Using database Transcription type from schema

export const TranscriptionsList: React.FC = () => {
  const [transcriptions, setTranscriptions] = useState<Transcription[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [totalCount, setTotalCount] = useState(0);

  // Load transcriptions from database
  const loadTranscriptions = async (search?: string) => {
    setLoading(true);
    try {
      const options = {
        limit: 50,
        offset: 0,
        sortBy: 'timestamp' as const,
        sortOrder: 'desc' as const,
        search: search || undefined,
      };
      
      const [transcriptionsData, count] = await Promise.all([
        window.electronAPI.getTranscriptions(options),
        window.electronAPI.getTranscriptionsCount(search),
      ]);
      
      setTranscriptions(transcriptionsData);
      setTotalCount(count);
    } catch (error) {
      console.error('Error loading transcriptions:', error);
      // Fallback to empty array on error
      setTranscriptions([]);
      setTotalCount(0);
    } finally {
      setLoading(false);
    }
  };

  // Load transcriptions on component mount and when search term changes
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      loadTranscriptions(searchTerm);
    }, searchTerm ? 300 : 0); // Debounce search

    return () => clearTimeout(timeoutId);
  }, [searchTerm]);


  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      // You could add a toast notification here
      console.log('Copied to clipboard');
    } catch (err) {
      console.error('Failed to copy text: ', err);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await window.electronAPI.deleteTranscription(id);
      // Reload transcriptions after deletion
      await loadTranscriptions(searchTerm);
    } catch (error) {
      console.error('Error deleting transcription:', error);
    }
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

  // Since we're already filtering on the backend, use all transcriptions
  const filteredTranscriptions = transcriptions;

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
        <div></div>
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
      {loading ? (
        <Card>
          <CardContent className="py-12">
            <div className="flex flex-col items-center space-y-2 text-center">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-300 border-t-blue-600"></div>
              <p className="text-sm text-muted-foreground">Loading transcriptions...</p>
            </div>
          </CardContent>
        </Card>
      ) : filteredTranscriptions.length === 0 ? (
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
                        <span>{format(new Date(transcription.timestamp), 'MMM d')}</span>
                        <span>{format(new Date(transcription.timestamp), 'h:mm a')}</span>
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

      {!loading && filteredTranscriptions.length > 0 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Showing {filteredTranscriptions.length} of {totalCount} transcription{totalCount !== 1 ? 's' : ''}
          </span>
          <span>
            Total: {transcriptions.reduce((acc, t) => acc + getWordCount(t.text), 0)} words
          </span>
        </div>
      )}
    </div>
  );
}; 