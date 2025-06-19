import React, { useState, useEffect } from 'react';
import { Button } from './ui/button';
import { Progress } from './ui/progress';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { RadioGroup, RadioGroupItem } from './ui/radio-group';
import { Label } from './ui/label';
import { Trash2, Download, Square, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { 
  AlertDialog, 
  AlertDialogContent, 
  AlertDialogDescription, 
  AlertDialogFooter, 
  AlertDialogHeader, 
  AlertDialogTitle, 
  AlertDialogTrigger,
  AlertDialogAction,
  AlertDialogCancel
} from './ui/alert-dialog';
import { Model, DownloadedModel, DownloadProgress } from '../constants/models';

export const ModelsView: React.FC = () => {
  const [availableModels, setAvailableModels] = useState<Model[]>([]);
  const [downloadedModels, setDownloadedModels] = useState<Record<string, DownloadedModel>>({});
  const [downloadProgress, setDownloadProgress] = useState<Record<string, DownloadProgress>>({});
  const [loading, setLoading] = useState(true);
  const [isLocalWhisperAvailable, setIsLocalWhisperAvailable] = useState(false);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [modelToDelete, setModelToDelete] = useState<string | null>(null);

  const loadData = async () => {
    try {
      setLoading(true);
      const [available, downloaded, activeDownloads, whisperAvailable, currentSelectedModel] = await Promise.all([
        window.electronAPI.getAvailableModels(),
        window.electronAPI.getDownloadedModels(),
        window.electronAPI.getActiveDownloads(),
        window.electronAPI.isLocalWhisperAvailable(),
        window.electronAPI.getSelectedModel(),
      ]);

      setAvailableModels(available);
      setDownloadedModels(downloaded);
      setIsLocalWhisperAvailable(whisperAvailable);
      setSelectedModel(currentSelectedModel);

      // Set up active downloads progress
      const progressMap: Record<string, DownloadProgress> = {};
      for (const modelId of activeDownloads) {
        const progress = await window.electronAPI.getDownloadProgress(modelId);
        if (progress) {
          progressMap[modelId] = progress;
        }
      }
      setDownloadProgress(progressMap);
    } catch (err) {
      console.error('Failed to load models data:', err);
      toast.error('Failed to load models data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();

    const handleDownloadProgress = (modelId: string, progress: DownloadProgress) => {
      setDownloadProgress(prev => ({
        ...prev,
        [modelId]: progress
      }));
    };

    const handleDownloadComplete = (modelId: string, downloadedModel: DownloadedModel) => {
      setDownloadedModels(prev => ({
        ...prev,
        [modelId]: downloadedModel
      }));
      setDownloadProgress(prev => {
        const updated = { ...prev };
        delete updated[modelId];
        return updated;
      });
    };

    const handleDownloadError = (modelId: string, errorMessage: string) => {
      setDownloadProgress(prev => ({
        ...prev,
        [modelId]: {
          ...prev[modelId],
          status: 'error',
          error: errorMessage
        }
      }));
    };

    const handleDownloadCancelled = (modelId: string) => {
      setDownloadProgress(prev => {
        const updated = { ...prev };
        delete updated[modelId];
        return updated;
      });
    };

    const handleModelDeleted = (modelId: string) => {
      setDownloadedModels(prev => {
        const updated = { ...prev };
        delete updated[modelId];
        return updated;
      });
    };

    // Listen to events from main process
    window.electronAPI.on('model-download-progress', handleDownloadProgress);
    window.electronAPI.on('model-download-complete', handleDownloadComplete);
    window.electronAPI.on('model-download-error', handleDownloadError);
    window.electronAPI.on('model-download-cancelled', handleDownloadCancelled);
    window.electronAPI.on('model-deleted', handleModelDeleted);

    return () => {
      // Cleanup event listeners
      window.electronAPI.off('model-download-progress', handleDownloadProgress);
      window.electronAPI.off('model-download-complete', handleDownloadComplete);
      window.electronAPI.off('model-download-error', handleDownloadError);
      window.electronAPI.off('model-download-cancelled', handleDownloadCancelled);
      window.electronAPI.off('model-deleted', handleModelDeleted);
    };
  }, []);

  const handleDownload = async (modelId: string, event?: React.MouseEvent) => {
    event?.preventDefault();
    event?.stopPropagation();
    
    console.log('Start download clicked for:', modelId);
    
    try {
      console.log('Downloading model:', modelId);
      await window.electronAPI.downloadModel(modelId);
      console.log('Start download successful for:', modelId);
    } catch (err) {
      console.error('Failed to start download:', err);
      
      // Don't show error for manual cancellations (AbortError)
      if (err instanceof Error && err.message.includes('AbortError')) {
        console.log('Download was manually aborted, not showing error');
        return;
      }
      
      toast.error('Failed to start download');
    }
  };

  const handleCancelDownload = async (modelId: string, event?: React.MouseEvent) => {
    event?.preventDefault();
    event?.stopPropagation();
    
    console.log('Cancel download clicked for:', modelId);
    
    try {
      await window.electronAPI.cancelDownload(modelId);
      console.log('Cancel download successful for:', modelId);
    } catch (err) {
      console.error('Failed to cancel download:', err);
      toast.error('Failed to cancel download');
    }
  };

  const handleDeleteClick = (modelId: string) => {
    setModelToDelete(modelId);
    setShowDeleteDialog(true);
  };

  const handleDeleteConfirm = async () => {
    if (!modelToDelete) return;

    try {
      await window.electronAPI.deleteModel(modelToDelete);
    } catch (err) {
      console.error('Failed to delete model:', err);
      toast.error('Failed to delete model');
    } finally {
      setShowDeleteDialog(false);
      setModelToDelete(null);
    }
  };

  const handleDeleteCancel = () => {
    setShowDeleteDialog(false);
    setModelToDelete(null);
  };


  const handleSelectModel = async (modelId: string) => {
    try {
      await window.electronAPI.setSelectedModel(modelId);
      setSelectedModel(modelId);
    } catch (err) {
      console.error('Failed to select model:', err);
      toast.error('Failed to select model');
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin" />
        <span className="ml-2">Loading models...</span>
      </div>
    );
  }

  return (
    <div className="h-full p-6">
      <Tabs defaultValue="speech-recognition" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="speech-recognition">Speech Recognition</TabsTrigger>
          <TabsTrigger value="formatting-llm">Formatting LLM</TabsTrigger>
        </TabsList>

        <TabsContent value="speech-recognition" className="space-y-6 mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Whisper Speech Models</CardTitle>
              <CardDescription>
                Select and manage Whisper models for speech recognition
              </CardDescription>
            </CardHeader>
            <CardContent>
              <RadioGroup
                value={selectedModel || ''}
                onValueChange={handleSelectModel}
                className="space-y-4"
              >
                {availableModels.map((model) => {
                  const isDownloaded = !!downloadedModels[model.id];
                  const progress = downloadProgress[model.id];
                  const isDownloading = progress?.status === 'downloading';

                  return (
                    <div key={model.id} className="flex items-center justify-between py-3 border-b last:border-b-0">
                      <div className="flex items-center space-x-3">
                        <RadioGroupItem
                          value={model.id}
                          id={model.id}
                          disabled={!isDownloaded || !isLocalWhisperAvailable}
                        />
                        <div className="flex-1">
                          <Label htmlFor={model.id} className="text-base font-medium cursor-pointer">
                            {model.name}
                          </Label>
                          <div className="text-sm text-muted-foreground mt-1">
                            {model.description}
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-col items-center space-y-1">
                        {!isDownloaded && !isDownloading && (
                          <button
                            onClick={(e) => handleDownload(model.id, e)}
                            className="w-10 h-10 rounded-full bg-primary hover:bg-primary/90 flex items-center justify-center text-primary-foreground transition-colors"
                            title="Click to download"
                          >
                            <Download className="w-5 h-5" />
                          </button>
                        )}

                        {!isDownloaded && isDownloading && (
                          <div className="relative">
                            <button
                              onClick={(e) => handleCancelDownload(model.id, e)}
                              className="w-10 h-10 rounded-full bg-orange-500 hover:bg-orange-600 flex items-center justify-center text-white transition-colors"
                              title="Click to cancel download"
                            >
                              <Square className="w-4 h-4" />
                            </button>
                            
                            {/* Circular Progress Ring */}
                            {progress && (
                              <svg
                                className="absolute inset-0 w-10 h-10 -rotate-90 pointer-events-none"
                                viewBox="0 0 36 36"
                              >
                                <circle
                                  cx="18"
                                  cy="18"
                                  r="15.9155"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="3"
                                  strokeDasharray="100 100"
                                  className="text-muted-foreground/30"
                                />
                                <circle
                                  cx="18"
                                  cy="18"
                                  r="15.9155"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="3"
                                  strokeDasharray={`${Math.max(0, Math.min(100, progress.progress))} 100`}
                                  strokeLinecap="round"
                                  className="text-white transition-all duration-300"
                                />
                              </svg>
                            )}
                          </div>
                        )}

                        {isDownloaded && (
                          <button
                            onClick={() => handleDeleteClick(model.id)}
                            className="w-10 h-10 rounded-full bg-red-500 hover:bg-red-600 flex items-center justify-center text-white transition-colors"
                            title="Click to delete model"
                          >
                            <Trash2 className="w-5 h-5" />
                          </button>
                        )}
                        
                        <div className="text-xs text-muted-foreground text-center">
                          {model.sizeFormatted}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </RadioGroup>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="formatting-llm" className="space-y-6 mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Formatting Model</CardTitle>
              <CardDescription>
                Configure your language model for post-processing transcriptions
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div>
                  <Label htmlFor="provider" className="text-sm font-medium">
                    Provider
                  </Label>
                  <select
                    id="provider"
                    className="w-full mt-1 px-3 py-2 border border-input bg-background rounded-md text-sm"
                    defaultValue="openai"
                  >
                    <option value="openai">OpenAI</option>
                  </select>
                </div>
                
                <div>
                  <Label htmlFor="api-key" className="text-sm font-medium">
                    API Key or local model name
                  </Label>
                  <input
                    type="text"
                    id="api-key"
                    placeholder="API Key or local model name"
                    className="w-full mt-1 px-3 py-2 border border-input bg-background rounded-md text-sm"
                  />
                </div>

                <Button className="w-full bg-primary text-primary-foreground">
                  Save
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Model</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this model? This action cannot be undone and you will need to download the model again if you want to use it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleDeleteCancel}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteConfirm} className="bg-red-500 hover:bg-red-600">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}; 