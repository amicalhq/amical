"use client";
import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Cloud,
  Download,
  Languages,
  Zap,
  FileText,
  MessageSquare,
  Volume2,
  Clock,
  Gauge,
  Filter,
  Settings,
  Headphones,
  Brain,
  Shield,
  Sparkles,
  Users,
  Circle,
  X,
  CheckCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import {
  TooltipContent,
  Tooltip,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface SpeechModel {
  name: string;
  features: Array<{
    icon: React.ReactNode;
    tooltip: string;
  }>;
  speed: number; // out of 5
  accuracy: number; // out of 5
  setup: "cloud" | "offline";
  provider: string;
  providerIcon?: string; // nullable field for provider icon
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
    ],
    speed: 3.0,
    accuracy: 4.5,
    setup: "offline",
    provider: "OpenAI",
    providerIcon: "/icons/models/openai_dark.svg",
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
    ],
    speed: 4.5,
    accuracy: 4.0,
    setup: "cloud",
    provider: "Google",
    providerIcon: "/icons/models/google.svg",
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
    ],
    speed: 4.0,
    accuracy: 4.0,
    setup: "cloud",
    provider: "Microsoft",
    providerIcon: "/icons/models/azure.svg",
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
    ],
    speed: 4.0,
    accuracy: 3.5,
    setup: "cloud",
    provider: "Amazon",
    providerIcon: "/icons/models/aws_dark.svg",
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
    ],
    speed: 4.5,
    accuracy: 4.5,
    setup: "cloud",
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
    ],
    speed: 5.0,
    accuracy: 4.0,
    setup: "cloud",
    provider: "Deepgram",
  },
  {
    name: "Wav2Vec2",
    features: [
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
    providerIcon: "/icons/models/meta.svg",
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

export default function SpeechTab() {
  // const [defaultSpeechModel, setDefaultSpeechModel] = useState(models[0].name);
  const [defaultSpeechModel, setDefaultSpeechModel] = useState<SpeechModel>(
    models[0]
  );
  return (
    <Card>
      <CardContent className="space-y-6">
        <div>
          <Label className="text-lg font-semibold">Default Speech Model</Label>
          <div className="mt-2 max-w-xs">
            <Combobox
              options={models.map((m) => ({
                value: m.name,
                label: m.name,
              }))}
              value={defaultSpeechModel.name}
              onChange={(value) => {
                const model = models.find((m) => m.name === value);
                if (model) {
                  setDefaultSpeechModel(model);
                }
              }}
            />
          </div>
        </div>
        <div>
          <Label className="text-lg font-semibold mb-2 block">
            Available Models
          </Label>
          <div className="divide-y border rounded-md bg-muted/30">
            <TooltipProvider>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Model</TableHead>
                    <TableHead>Features</TableHead>
                    <TableHead>Speed</TableHead>
                    <TableHead>Accuracy</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {models.map((model, index) => (
                    <TableRow key={index} className="hover:bg-muted/50">
                      <TableCell>
                        <div>
                          <div className="font-semibold">{model.name}</div>
                          <div className="flex items-center gap-2 text-sm text-muted-foreground mt-1">
                            <Avatar className="w-4 h-4">
                              {model.providerIcon ? (
                                <AvatarImage
                                  src={model.providerIcon}
                                  alt={`${model.provider} icon`}
                                />
                              ) : null}
                              <AvatarFallback className="text-xs">
                                {model.provider.charAt(0).toUpperCase()}
                              </AvatarFallback>
                            </Avatar>
                            <span>{model.provider}</span>
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
        </div>
      </CardContent>
    </Card>
  );
}

const OfflineBadge = () => {
  return (
    <div className="flex flex-col items-center gap-1">
      <Button
        size="sm"
        variant="outline"
        className="w-10 h-10 rounded-full p-0 bg-transparent"
      >
        <CheckCircle className="w-4 h-4" />
      </Button>
    </div>
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
    let interval: NodeJS.Timeout;
    if (downloadState === "downloading") {
      interval = setInterval(() => {
        setProgress((prev) => {
          if (prev >= 100) {
            setDownloadState("completed");
            return 100;
          }
          return prev + Math.random() * 15 + 5; // Random progress increment
        });
      }, 200);
    }
    return () => clearInterval(interval);
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
                background: `conic-gradient(#3b82f6 ${
                  progress * 3.6
                }deg, transparent ${progress * 3.6}deg)`,
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
        className="w-10 h-10 rounded-full p-0 bg-transparent"
        onClick={startDownload}
      >
        <Download className="w-4 h-4" />
      </Button>
      <div className="text-xs text-center text-muted-foreground">
        <div className="text-[10px]">~{modelSize}</div>
      </div>
    </div>
  );
};

const SetupCell = ({ model }: { model: SpeechModel }) => {
  if (model.setup === "cloud") {
    return (
      <div className="flex flex-col items-center gap-1">
        <Button
          size="sm"
          variant="outline"
          className="w-10 h-10 rounded-full p-0 bg-transparent"
        >
          <Cloud className="w-6 h-6" />
        </Button>
      </div>
    );
  }

  return (
    <DownloadButton
      modelName={model.name}
      modelSize={model.modelSize || "Unknown"}
    />
  );
};
