"use client";

import type React from "react";
import { useState, useEffect } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Zap,
  Circle,
  Cloud,
  Download,
  Languages,
  Clock,
  Shield,
  Users,
  Volume2,
  FileText,
  Filter,
  Headphones,
  MessageSquare,
  Sparkles,
  Brain,
  Gauge,
  Settings,
  X,
} from "lucide-react";

interface SpeechModel {
  name: string;
  features: Array<{
    icon: React.ReactNode;
    tooltip: string;
  }>;
  speed: number; // out of 5
  accuracy: number; // out of 5
  setup: "amical" | "offline" | "api";
  provider: string;
  modelSize?: string; // for offline models
}

const models: SpeechModel[] = [
  {
    name: "OpenAI Whisper",
    features: [
      {
        icon: <Languages className="w-4 h-4" />,
        tooltip: "99+ languages with automatic detection",
      },
      {
        icon: <FileText className="w-4 h-4" />,
        tooltip: "Automatic punctuation and capitalization",
      },
      {
        icon: <MessageSquare className="w-4 h-4" />,
        tooltip: "Built-in translation to English",
      },
      {
        icon: <Volume2 className="w-4 h-4" />,
        tooltip: "Robust to background noise and accents",
      },
      {
        icon: <Clock className="w-4 h-4" />,
        tooltip: "Timestamp generation for segments",
      },
    ],
    speed: 3.0,
    accuracy: 4.5,
    setup: "offline",
    provider: "OpenAI",
    modelSize: "769 MB",
  },
  {
    name: "Google Speech-to-Text",
    features: [
      {
        icon: <Languages className="w-4 h-4" />,
        tooltip: "125+ languages and variants",
      },
      {
        icon: <Gauge className="w-4 h-4" />,
        tooltip: "Real-time streaming recognition",
      },
      {
        icon: <FileText className="w-4 h-4" />,
        tooltip: "Automatic punctuation and formatting",
      },
      { icon: <Filter className="w-4 h-4" />, tooltip: "Profanity filtering" },
      {
        icon: <Settings className="w-4 h-4" />,
        tooltip: "Custom vocabulary and models",
      },
      {
        icon: <Headphones className="w-4 h-4" />,
        tooltip: "Enhanced phone call model",
      },
    ],
    speed: 4.5,
    accuracy: 4.0,
    setup: "amical",
    provider: "Google",
  },
  {
    name: "Azure Speech Services",
    features: [
      {
        icon: <Languages className="w-4 h-4" />,
        tooltip: "100+ languages and dialects",
      },
      {
        icon: <Settings className="w-4 h-4" />,
        tooltip: "Custom Speech model training",
      },
      {
        icon: <Gauge className="w-4 h-4" />,
        tooltip: "Real-time and batch processing",
      },
      {
        icon: <Users className="w-4 h-4" />,
        tooltip: "Speaker recognition and verification",
      },
      {
        icon: <Brain className="w-4 h-4" />,
        tooltip: "Intent recognition integration",
      },
      {
        icon: <Shield className="w-4 h-4" />,
        tooltip: "Enterprise-grade security",
      },
    ],
    speed: 4.0,
    accuracy: 4.0,
    setup: "amical",
    provider: "Microsoft",
  },
  {
    name: "Amazon Transcribe",
    features: [
      {
        icon: <Languages className="w-4 h-4" />,
        tooltip: "31 languages supported",
      },
      {
        icon: <Users className="w-4 h-4" />,
        tooltip: "Speaker identification (diarization)",
      },
      {
        icon: <Settings className="w-4 h-4" />,
        tooltip: "Custom vocabulary and models",
      },
      {
        icon: <Headphones className="w-4 h-4" />,
        tooltip: "Call analytics specialization",
      },
      {
        icon: <Shield className="w-4 h-4" />,
        tooltip: "Content redaction (PII removal)",
      },
      {
        icon: <Sparkles className="w-4 h-4" />,
        tooltip: "Medical and legal transcription",
      },
    ],
    speed: 4.0,
    accuracy: 3.5,
    setup: "amical",
    provider: "Amazon",
  },
  {
    name: "AssemblyAI",
    features: [
      {
        icon: <Users className="w-4 h-4" />,
        tooltip: "Advanced speaker diarization",
      },
      {
        icon: <MessageSquare className="w-4 h-4" />,
        tooltip: "Sentiment analysis and emotion detection",
      },
      {
        icon: <Sparkles className="w-4 h-4" />,
        tooltip: "Topic detection and summarization",
      },
      {
        icon: <Filter className="w-4 h-4" />,
        tooltip: "Content safety and moderation",
      },
      {
        icon: <FileText className="w-4 h-4" />,
        tooltip: "Auto-chapters and key phrases",
      },
      { icon: <Gauge className="w-4 h-4" />, tooltip: "Real-time streaming" },
    ],
    speed: 4.5,
    accuracy: 4.5,
    setup: "amical",
    provider: "AssemblyAI",
  },
  {
    name: "Deepgram",
    features: [
      {
        icon: <Gauge className="w-4 h-4" />,
        tooltip: "Ultra-fast real-time processing",
      },
      {
        icon: <Languages className="w-4 h-4" />,
        tooltip: "30+ languages with custom models",
      },
      {
        icon: <Sparkles className="w-4 h-4" />,
        tooltip: "Keyword and topic detection",
      },
      { icon: <Users className="w-4 h-4" />, tooltip: "Speaker diarization" },
      {
        icon: <Settings className="w-4 h-4" />,
        tooltip: "Custom model training",
      },
      {
        icon: <Volume2 className="w-4 h-4" />,
        tooltip: "Enhanced audio preprocessing",
      },
    ],
    speed: 5.0,
    accuracy: 4.0,
    setup: "amical",
    provider: "Deepgram",
  },
  {
    name: "Wav2Vec2",
    features: [
      { icon: <Shield className="w-4 h-4" />, tooltip: "Open source and free" },
      {
        icon: <Brain className="w-4 h-4" />,
        tooltip: "Self-supervised learning approach",
      },
      {
        icon: <Languages className="w-4 h-4" />,
        tooltip: "Multilingual model variants",
      },
      {
        icon: <Settings className="w-4 h-4" />,
        tooltip: "Fine-tunable for custom domains",
      },
      {
        icon: <Volume2 className="w-4 h-4" />,
        tooltip: "Robust to noisy audio",
      },
    ],
    speed: 2.5,
    accuracy: 3.5,
    setup: "offline",
    provider: "Meta",
    modelSize: "360 MB",
  },
  {
    name: "Vosk",
    features: [
      {
        icon: <Shield className="w-4 h-4" />,
        tooltip: "Open source and lightweight",
      },
      {
        icon: <Gauge className="w-4 h-4" />,
        tooltip: "Real-time processing capability",
      },
      {
        icon: <Languages className="w-4 h-4" />,
        tooltip: "20+ language models available",
      },
      {
        icon: <Settings className="w-4 h-4" />,
        tooltip: "Embedded and mobile friendly",
      },
      {
        icon: <Clock className="w-4 h-4" />,
        tooltip: "Partial results and timestamps",
      },
    ],
    speed: 3.0,
    accuracy: 3.0,
    setup: "offline",
    provider: "Alpha Cephei",
    modelSize: "50 MB",
  },
];

const SpeedRating = ({ rating }: { rating: number }) => {
  const fullIcons = Math.floor(rating);
  const hasHalf = rating % 1 !== 0;

  return (
    <div className="flex items-center gap-1">
      {Array.from({ length: 5 }, (_, i) => {
        if (i < fullIcons) {
          return (
            <Zap key={i} className="w-4 h-4 fill-yellow-400 text-yellow-400" />
          );
        } else if (i === fullIcons && hasHalf) {
          return (
            <div key={i} className="relative w-4 h-4">
              <Zap className="w-4 h-4 text-gray-300" />
              <div className="absolute inset-0 overflow-hidden w-1/2">
                <Zap className="w-4 h-4 fill-yellow-400 text-yellow-400" />
              </div>
            </div>
          );
        } else {
          return <Zap key={i} className="w-4 h-4 text-gray-300" />;
        }
      })}
      <span className="text-sm text-muted-foreground ml-1">{rating}</span>
    </div>
  );
};

const AccuracyRating = ({ rating }: { rating: number }) => {
  const fullIcons = Math.floor(rating);
  const hasHalf = rating % 1 !== 0;

  return (
    <div className="flex items-center gap-1">
      {Array.from({ length: 5 }, (_, i) => {
        if (i < fullIcons) {
          return (
            <Circle key={i} className="w-4 h-4 fill-green-500 text-green-500" />
          );
        } else if (i === fullIcons && hasHalf) {
          return (
            <div key={i} className="relative w-4 h-4">
              <Circle className="w-4 h-4 text-gray-300" />
              <div className="absolute inset-0 overflow-hidden w-1/2">
                <Circle className="w-4 h-4 fill-green-500 text-green-500" />
              </div>
            </div>
          );
        } else {
          return <Circle key={i} className="w-4 h-4 text-gray-300" />;
        }
      })}
      <span className="text-sm text-muted-foreground ml-1">{rating}</span>
    </div>
  );
};

const CloudBadge = () => {
  return (
    <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-200 flex items-center gap-1 min-w-[80px] justify-center">
      <Cloud className="w-3 h-3" />
      Cloud
    </Badge>
  );
};

const OfflineBadge = () => {
  return (
    <Badge className="bg-green-100 text-green-800 hover:bg-green-200 flex items-center gap-1 min-w-[80px] justify-center">
      <Download className="w-3 h-3" />
      Offline
    </Badge>
  );
};

interface DownloadButtonProps {
  modelName: string;
  modelSize: string;
}

const DownloadButton = ({ modelName, modelSize }: DownloadButtonProps) => {
  const [downloadState, setDownloadState] = useState<
    "idle" | "downloading" | "completed"
  >("idle");
  const [progress, setProgress] = useState(0);

  const startDownload = () => {
    setDownloadState("downloading");
    setProgress(0);
  };

  const stopDownload = () => {
    setDownloadState("idle");
    setProgress(0);
  };

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;
    if (downloadState === "downloading") {
      interval = setInterval(() => {
        setProgress((prev) => {
          if (prev >= 100) {
            setDownloadState("completed");
            return 100;
          }
          const increment = Math.random() * 15 + 5;
          return Math.min(prev + increment, 100); // Clamp to 100
        });
      }, 200);
    }
    return () => {
      if (interval) {
        clearInterval(interval);
      }
    };
  }, [downloadState]);

  if (downloadState === "completed") {
    return (
      <div className="flex flex-col items-center gap-1">
        <OfflineBadge />
      </div>
    );
  }

  if (downloadState === "downloading") {
    return (
      <div className="flex flex-col items-center gap-1">
        <div className="relative">
          <Button
            size="sm"
            variant="outline"
            className="w-10 h-10 rounded-full p-0 relative overflow-hidden bg-transparent"
            onClick={stopDownload}
          >
            <div
              className="absolute inset-0 border-2 border-blue-500 rounded-full"
              style={{
                background: `conic-gradient(#3b82f6 ${progress * 3.6}deg, transparent ${progress * 3.6}deg)`,
                mask: "radial-gradient(circle at center, transparent 60%, black 60%)",
                WebkitMask:
                  "radial-gradient(circle at center, transparent 60%, black 60%)",
              }}
            />
            <X className="w-4 h-4 text-red-500" />
          </Button>
        </div>
        <div className="text-xs text-center text-muted-foreground">
          <div>{Math.round(progress)}%</div>
          <div className="text-[10px]">{modelSize}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-1">
      <Button
        size="sm"
        variant="outline"
        className="w-10 h-10 rounded-full p-0 hover:bg-blue-50 hover:border-blue-300 bg-transparent"
        onClick={startDownload}
      >
        <Download className="w-4 h-4 text-blue-600" />
      </Button>
      <div className="text-xs text-center text-muted-foreground">
        <div className="text-[10px]">{modelSize}</div>
      </div>
    </div>
  );
};

const SetupCell = ({ model }: { model: SpeechModel }) => {
  if (model.setup === "amical") {
    return <CloudBadge />;
  }

  if (model.setup === "api") {
    return (
      <Badge variant="outline" className="text-xs">
        API
      </Badge>
    );
  }

  return (
    <DownloadButton
      modelName={model.name}
      modelSize={model.modelSize || "Unknown"}
    />
  );
};

export default function Component() {
  return (
    <div className="w-full max-w-7xl mx-auto p-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl font-bold">
            Speech LLM Models Comparison
          </CardTitle>
          <p className="text-muted-foreground">
            Compare features, performance, and setup requirements of popular
            speech-to-text models
          </p>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <TooltipProvider>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[200px]">Model</TableHead>
                    <TableHead className="min-w-[250px]">Features</TableHead>
                    <TableHead className="min-w-[120px]">Speed</TableHead>
                    <TableHead className="min-w-[120px]">Accuracy</TableHead>
                    <TableHead className="min-w-[120px]">Setup</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {models.map((model, index) => (
                    <TableRow key={index} className="hover:bg-muted/50">
                      <TableCell>
                        <div>
                          <div className="font-semibold">{model.name}</div>
                          <div className="text-sm text-muted-foreground">
                            {model.provider}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-2">
                          {model.features.map((feature, featureIndex) => (
                            <Tooltip key={featureIndex}>
                              <TooltipTrigger asChild>
                                <div className="p-2 rounded-md bg-muted hover:bg-muted/80 cursor-help transition-colors">
                                  {feature.icon}
                                </div>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>{feature.tooltip}</p>
                              </TooltipContent>
                            </Tooltip>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell>
                        <SpeedRating rating={model.speed} />
                      </TableCell>
                      <TableCell>
                        <AccuracyRating rating={model.accuracy} />
                      </TableCell>
                      <TableCell>
                        <SetupCell model={model} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TooltipProvider>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
