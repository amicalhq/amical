import React, { useState, useEffect } from 'react';
import { Button } from './ui/button';
import { Progress } from './ui/progress';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { RadioGroup, RadioGroupItem } from './ui/radio-group';
import { Label } from './ui/label';
import { Trash2, Download, X, Loader2 } from 'lucide-react';
import { Alert, AlertDescription } from './ui/alert';
import { Model, DownloadedModel, DownloadProgress } from '../constants/models';

export const ModelsView: React.FC = () => {
  const [availableModels, setAvailableModels] = useState<Model[]>([]);
  const [downloadedModels, setDownloadedModels] = useState<Record<string, DownloadedModel>>({});
  const [downloadProgress, setDownloadProgress] = useState<Record<string, DownloadProgress>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isLocalWhisperAvailable, setIsLocalWhisperAvailable] = useState(false);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);

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
      setError(`Failed to load models: ${err instanceof Error ? err.message : String(err)}`);
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

  const handleDownload = async (modelId: string) => {
    try {
      await window.electronAPI.downloadModel(modelId);
    } catch (err) {
      console.error('Failed to start download:', err);
      setError(`Failed to start download: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleCancelDownload = async (modelId: string) => {
    try {
      await window.electronAPI.cancelDownload(modelId);
    } catch (err) {
      console.error('Failed to cancel download:', err);
      setError(`Failed to cancel download: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleDelete = async (modelId: string) => {
    if (!window.confirm('Are you sure you want to delete this model? This action cannot be undone.')) {
      return;
    }

    try {
      await window.electronAPI.deleteModel(modelId);
    } catch (err) {
      console.error('Failed to delete model:', err);
      setError(`Failed to delete model: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleSelectModel = async (modelId: string) => {
    try {
      await window.electronAPI.setSelectedModel(modelId);
      setSelectedModel(modelId);
    } catch (err) {
      console.error('Failed to select model:', err);
      setError(`Failed to select model: ${err instanceof Error ? err.message : String(err)}`);
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
              {error && (
                <Alert variant="destructive" className="mb-4">
                  <AlertDescription>
                    {error}
                    <Button
                      onClick={() => setError(null)}
                      variant="outline"
                      size="sm"
                      className="ml-2"
                    >
                      Dismiss
                    </Button>
                  </AlertDescription>
                </Alert>
              )}

              <RadioGroup
                value={selectedModel || ''}
                onValueChange={handleSelectModel}
                className="space-y-4"
              >
                {availableModels.map((model) => {
                  const isDownloaded = !!downloadedModels[model.id];
                  const progress = downloadProgress[model.id];
                  const isDownloading = progress?.status === 'downloading';
                  const isCancelling = progress?.status === 'cancelling';
                  const hasError = progress?.status === 'error';

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
                            RAM ~{model.ramUsageFormatted}
                          </div>

                          {/* Error message */}
                          {hasError && progress?.error && (
                            <div className="mt-1 text-xs text-red-500">
                              Error: {progress.error}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-col items-center space-y-1">
                        {!isDownloaded && (
                          <div className="relative">
                            <button
                              onClick={() => isDownloading ? handleCancelDownload(model.id) : handleDownload(model.id)}
                              disabled={isCancelling || hasError}
                              className="relative w-10 h-10 rounded-full bg-primary hover:bg-primary/90 disabled:bg-muted flex items-center justify-center text-primary-foreground transition-colors"
                            >
                              {isDownloading ? (
                                <X className="w-5 h-5" />
                              ) : (
                                <Download className="w-5 h-5" />
                              )}
                            </button>
                            
                            {/* Circular Progress */}
                            {isDownloading && progress && (
                              <svg
                                className="absolute inset-0 w-10 h-10 -rotate-90"
                                viewBox="0 0 36 36"
                              >
                                <path
                                  d="M18 2.0845
                                    a 15.9155 15.9155 0 0 1 0 31.831
                                    a 15.9155 15.9155 0 0 1 0 -31.831"
                                  fill="none"
                                  stroke="hsl(var(--muted))"
                                  strokeWidth="2"
                                />
                                <path
                                  d="M18 2.0845
                                    a 15.9155 15.9155 0 0 1 0 31.831
                                    a 15.9155 15.9155 0 0 1 0 -31.831"
                                  fill="none"
                                  stroke="hsl(var(--primary))"
                                  strokeWidth="2"
                                  strokeDasharray={`${progress.progress}, 100`}
                                  strokeLinecap="round"
                                />
                              </svg>
                            )}
                          </div>
                        )}

                        {isDownloaded && (
                          <button
                            onClick={() => handleDelete(model.id)}
                            className="w-10 h-10 rounded-full bg-red-500 hover:bg-red-600 flex items-center justify-center text-white transition-colors"
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
    </div>
  );
}; 