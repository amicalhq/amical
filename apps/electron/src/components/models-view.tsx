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
import { api } from '@/trpc/react';

export const ModelsView: React.FC = () => {
  const [downloadProgress, setDownloadProgress] = useState<Record<string, DownloadProgress>>({});
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [modelToDelete, setModelToDelete] = useState<string | null>(null);

  // tRPC queries
  const availableModelsQuery = api.models.getAvailableModels.useQuery();
  const downloadedModelsQuery = api.models.getDownloadedModels.useQuery();
  const activeDownloadsQuery = api.models.getActiveDownloads.useQuery();
  const isLocalWhisperAvailableQuery = api.models.isLocalWhisperAvailable.useQuery();
  const selectedModelQuery = api.models.getSelectedModel.useQuery();

  const utils = api.useUtils();

  // tRPC mutations
  const downloadModelMutation = api.models.downloadModel.useMutation({
    onSuccess: () => {
      utils.models.getDownloadedModels.invalidate();
      utils.models.getActiveDownloads.invalidate();
    },
    onError: (error) => {
      console.error('Failed to start download:', error);
      if (error instanceof Error && error.message.includes('AbortError')) {
        console.log('Download was manually aborted, not showing error');
        return;
      }
      toast.error('Failed to start download');
    }
  });

  const cancelDownloadMutation = api.models.cancelDownload.useMutation({
    onSuccess: () => {
      utils.models.getActiveDownloads.invalidate();
    },
    onError: (error) => {
      console.error('Failed to cancel download:', error);
      toast.error('Failed to cancel download');
    }
  });

  const deleteModelMutation = api.models.deleteModel.useMutation({
    onSuccess: () => {
      utils.models.getDownloadedModels.invalidate();
      setShowDeleteDialog(false);
      setModelToDelete(null);
    },
    onError: (error) => {
      console.error('Failed to delete model:', error);
      toast.error('Failed to delete model');
      setShowDeleteDialog(false);
      setModelToDelete(null);
    }
  });

  const setSelectedModelMutation = api.models.setSelectedModel.useMutation({
    onSuccess: () => {
      utils.models.getSelectedModel.invalidate();
    },
    onError: (error) => {
      console.error('Failed to select model:', error);
      toast.error('Failed to select model');
    }
  });

  // Initialize active downloads progress on load
  useEffect(() => {
    if (activeDownloadsQuery.data) {
      const progressMap: Record<string, DownloadProgress> = {};
      activeDownloadsQuery.data.forEach((download) => {
        progressMap[download.modelId] = download;
      });
      setDownloadProgress(progressMap);
    }
  }, [activeDownloadsQuery.data]);

  // Set up tRPC subscriptions for real-time download updates
  api.models.onDownloadProgress.useSubscription(undefined, {
    onData: ({ modelId, progress }) => {
      setDownloadProgress(prev => ({ ...prev, [modelId]: progress }));
    },
    onError: (error) => {
      console.error('Download progress subscription error:', error);
    }
  });

  api.models.onDownloadComplete.useSubscription(undefined, {
    onData: ({ modelId, downloadedModel }) => {
      setDownloadProgress(prev => {
        const newProgress = { ...prev };
        delete newProgress[modelId];
        return newProgress;
      });
      utils.models.getDownloadedModels.invalidate();
      utils.models.getActiveDownloads.invalidate();
    },
    onError: (error) => {
      console.error('Download complete subscription error:', error);
    }
  });

  api.models.onDownloadError.useSubscription(undefined, {
    onData: ({ modelId, error }) => {
      setDownloadProgress(prev => {
        const newProgress = { ...prev };
        delete newProgress[modelId];
        return newProgress;
      });
      toast.error(`Download failed: ${error}`);
      utils.models.getActiveDownloads.invalidate();
    },
    onError: (error) => {
      console.error('Download error subscription error:', error);
    }
  });

  api.models.onDownloadCancelled.useSubscription(undefined, {
    onData: ({ modelId }) => {
      setDownloadProgress(prev => {
        const newProgress = { ...prev };
        delete newProgress[modelId];
        return newProgress;
      });
      utils.models.getActiveDownloads.invalidate();
    },
    onError: (error) => {
      console.error('Download cancelled subscription error:', error);
    }
  });

  api.models.onModelDeleted.useSubscription(undefined, {
    onData: ({ modelId }) => {
      utils.models.getDownloadedModels.invalidate();
    },
    onError: (error) => {
      console.error('Model deleted subscription error:', error);
    }
  });

  const handleDownload = async (modelId: string, event?: React.MouseEvent) => {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }

    try {
      await downloadModelMutation.mutateAsync({ modelId });
      console.log('Download started for:', modelId);
    } catch (err) {
      console.error('Failed to start download:', err);
      // Error is already handled by the mutation's onError
    }
  };

  const handleCancelDownload = async (modelId: string, event?: React.MouseEvent) => {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }

    try {
      await cancelDownloadMutation.mutateAsync({ modelId });
      console.log('Cancel download successful for:', modelId);
    } catch (err) {
      console.error('Failed to cancel download:', err);
      // Error is already handled by the mutation's onError
    }
  };

  const handleDeleteClick = (modelId: string) => {
    setModelToDelete(modelId);
    setShowDeleteDialog(true);
  };

  const handleDeleteConfirm = async () => {
    if (!modelToDelete) return;

    try {
      await deleteModelMutation.mutateAsync({ modelId: modelToDelete });
    } catch (err) {
      console.error('Failed to delete model:', err);
      // Error is already handled by the mutation's onError
    }
  };

  const handleDeleteCancel = () => {
    setShowDeleteDialog(false);
    setModelToDelete(null);
  };

  const handleSelectModel = async (modelId: string) => {
    try {
      await setSelectedModelMutation.mutateAsync({ modelId });
    } catch (err) {
      console.error('Failed to select model:', err);
      // Error is already handled by the mutation's onError
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  // Loading state
  const loading = availableModelsQuery.isLoading || downloadedModelsQuery.isLoading || 
                 isLocalWhisperAvailableQuery.isLoading || selectedModelQuery.isLoading;

  // Data from queries
  const availableModels = availableModelsQuery.data || [];
  const downloadedModels = downloadedModelsQuery.data || {};
  const isLocalWhisperAvailable = isLocalWhisperAvailableQuery.data || false;
  const selectedModel = selectedModelQuery.data;

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
        <TabsList className="grid w-full grid-cols-1">
          <TabsTrigger value="speech-recognition">Speech Recognition</TabsTrigger>
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