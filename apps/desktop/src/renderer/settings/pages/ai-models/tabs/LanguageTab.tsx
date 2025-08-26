"use client";
import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Check, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// Available models from providers
const availableOpenRouterModels = [
  {
    value: "gemini-flash-2",
    name: "Gemini Flash 2.0",
    provider: "OpenRouter",
    size: "Large",
    context: "128k",
    capabilities: ["multilingual", "fast"],
  },
  {
    value: "claude-3-haiku",
    name: "Claude 3 Haiku",
    provider: "OpenRouter",
    size: "Medium",
    context: "200k",
    capabilities: ["multilingual", "reasoning"],
  },
  {
    value: "gpt-4o-mini",
    name: "GPT-4o Mini",
    provider: "OpenRouter",
    size: "Small",
    context: "128k",
    capabilities: ["multilingual", "fast"],
  },
];

const availableOllamaModels = [
  {
    value: "llama-3",
    name: "Llama 3",
    provider: "Ollama",
    size: "8B",
    context: "32k",
    capabilities: ["english", "open-source"],
  },
  {
    value: "smollm2-360m",
    name: "Smollm2 360M",
    provider: "Ollama",
    size: "360M",
    context: "8k",
    capabilities: ["english", "fast"],
  },
  {
    value: "gemma3-1b",
    name: "Gemma3 1B",
    provider: "Ollama",
    size: "1B",
    context: "8k",
    capabilities: ["english", "fast"],
  },
];

export default function LanguageTab() {
  const [syncedModels, setSyncedModels] = useState<
    typeof availableOpenRouterModels
  >([]);
  const [defaultLanguageModel, setDefaultLanguageModel] = useState("");

  // Provider connection states
  const [openrouterKey, setOpenrouterKey] = useState("");
  const [openrouterStatus, setOpenrouterStatus] = useState<
    "connected" | "disconnected"
  >("disconnected");
  const [ollamaUrl, setOllamaUrl] = useState("");
  const [ollamaStatus, setOllamaStatus] = useState<
    "connected" | "disconnected"
  >("disconnected");

  // Dialog states
  const [openrouterDialogOpen, setOpenrouterDialogOpen] = useState(false);
  const [ollamaDialogOpen, setOllamaDialogOpen] = useState(false);
  const [selectedOpenRouterModels, setSelectedOpenRouterModels] = useState<
    string[]
  >([]);
  const [selectedOllamaModels, setSelectedOllamaModels] = useState<string[]>(
    []
  );
  const [openrouterSearch, setOpenrouterSearch] = useState("");
  const [ollamaSearch, setOllamaSearch] = useState("");
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [modelToDelete, setModelToDelete] = useState<string>("");
  const [removeProviderDialogOpen, setRemoveProviderDialogOpen] =
    useState(false);
  const [providerToRemove, setProviderToRemove] = useState<string>("");
  const [errorDialogOpen, setErrorDialogOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [changeDefaultDialogOpen, setChangeDefaultDialogOpen] = useState(false);
  const [newDefaultModel, setNewDefaultModel] = useState<string>("");

  // Connect functions
  const handleOpenRouterConnect = () => {
    if (openrouterKey.trim()) {
      setOpenrouterStatus("connected");
    }
  };

  const handleOllamaConnect = () => {
    if (ollamaUrl.trim()) {
      setOllamaStatus("connected");
    }
  };

  // Open dialog with pre-selected synced models
  const openOpenRouterDialog = () => {
    const syncedOpenRouterModels = syncedModels
      .filter((m) => m.provider === "OpenRouter")
      .map((m) => m.value);
    setSelectedOpenRouterModels(syncedOpenRouterModels);
    setOpenrouterSearch("");
    setOpenrouterDialogOpen(true);
  };

  const openOllamaDialog = () => {
    const syncedOllamaModels = syncedModels
      .filter((m) => m.provider === "Ollama")
      .map((m) => m.value);
    setSelectedOllamaModels(syncedOllamaModels);
    setOllamaSearch("");
    setOllamaDialogOpen(true);
  };

  // Sync models functions
  const handleOpenRouterSync = () => {
    const selectedModels = availableOpenRouterModels.filter((model) =>
      selectedOpenRouterModels.includes(model.value)
    );
    setSyncedModels((prev) => {
      const newModels = [
        ...prev.filter((m) => m.provider !== "OpenRouter"),
        ...selectedModels,
      ];
      // Set first model as default if no default is set
      if (!defaultLanguageModel && newModels.length > 0) {
        setDefaultLanguageModel(newModels[0].value);
      }
      return newModels;
    });
    setOpenrouterDialogOpen(false);
    setSelectedOpenRouterModels([]);
  };

  const handleOllamaSync = () => {
    const selectedModels = availableOllamaModels.filter((model) =>
      selectedOllamaModels.includes(model.value)
    );
    setSyncedModels((prev) => {
      const newModels = [
        ...prev.filter((m) => m.provider !== "Ollama"),
        ...selectedModels,
      ];
      // Set first model as default if no default is set
      if (!defaultLanguageModel && newModels.length > 0) {
        setDefaultLanguageModel(newModels[0].value);
      }
      return newModels;
    });
    setOllamaDialogOpen(false);
    setSelectedOllamaModels([]);
  };

  const handleRemoveModel = (modelValue: string) => {
    setSyncedModels((prev) => prev.filter((m) => m.value !== modelValue));
    if (defaultLanguageModel === modelValue) {
      setDefaultLanguageModel("");
    }
  };

  // Delete confirmation functions
  const openDeleteDialog = (modelValue: string) => {
    // Check if trying to remove the default model
    if (modelValue === defaultLanguageModel) {
      setErrorMessage(
        "Please select another model as default before removing this model."
      );
      setErrorDialogOpen(true);
      return;
    }
    setModelToDelete(modelValue);
    setDeleteDialogOpen(true);
  };

  const confirmDelete = () => {
    if (modelToDelete) {
      handleRemoveModel(modelToDelete);
      setDeleteDialogOpen(false);
      setModelToDelete("");
    }
  };

  const cancelDelete = () => {
    setDeleteDialogOpen(false);
    setModelToDelete("");
  };

  // Remove provider functions
  const openRemoveProviderDialog = (provider: string) => {
    setProviderToRemove(provider);
    setRemoveProviderDialogOpen(true);
  };

  const confirmRemoveProvider = () => {
    if (providerToRemove === "OpenRouter") {
      setOpenrouterStatus("disconnected");
      setOpenrouterKey("");
      setSyncedModels((prev) =>
        prev.filter((m) => m.provider !== "OpenRouter")
      );
      if (
        defaultLanguageModel &&
        syncedModels.find((m) => m.value === defaultLanguageModel)?.provider ===
          "OpenRouter"
      ) {
        setDefaultLanguageModel("");
      }
    } else if (providerToRemove === "Ollama") {
      setOllamaStatus("disconnected");
      setOllamaUrl("");
      setSyncedModels((prev) => prev.filter((m) => m.provider !== "Ollama"));
      if (
        defaultLanguageModel &&
        syncedModels.find((m) => m.value === defaultLanguageModel)?.provider ===
          "Ollama"
      ) {
        setDefaultLanguageModel("");
      }
    }
    setRemoveProviderDialogOpen(false);
    setProviderToRemove("");
  };

  const cancelRemoveProvider = () => {
    setRemoveProviderDialogOpen(false);
    setProviderToRemove("");
  };

  // Change default model functions
  const openChangeDefaultDialog = (modelValue: string) => {
    setNewDefaultModel(modelValue);
    setChangeDefaultDialogOpen(true);
  };

  const confirmChangeDefault = () => {
    setDefaultLanguageModel(newDefaultModel);
    setChangeDefaultDialogOpen(false);
    setNewDefaultModel("");
  };

  const cancelChangeDefault = () => {
    setChangeDefaultDialogOpen(false);
    setNewDefaultModel("");
  };

  // Filter functions
  const filteredOpenRouterModels = availableOpenRouterModels.filter(
    (model) =>
      model.name.toLowerCase().includes(openrouterSearch.toLowerCase()) ||
      model.value.toLowerCase().includes(openrouterSearch.toLowerCase()) ||
      model.capabilities.some((cap) =>
        cap.toLowerCase().includes(openrouterSearch.toLowerCase())
      )
  );

  const filteredOllamaModels = availableOllamaModels.filter(
    (model) =>
      model.name.toLowerCase().includes(ollamaSearch.toLowerCase()) ||
      model.value.toLowerCase().includes(ollamaSearch.toLowerCase()) ||
      model.capabilities.some((cap) =>
        cap.toLowerCase().includes(ollamaSearch.toLowerCase())
      )
  );

  function statusIndicator(status: "connected" | "disconnected") {
    return (
      <Badge
        variant="secondary"
        className={cn(
          "text-xs flex items-center gap-1",
          status === "connected"
            ? "text-green-500 border-green-500"
            : "text-red-500 border-red-500"
        )}
      >
        <span
          className={cn(
            "w-2 h-2 rounded-full inline-block animate-pulse mr-1",
            status === "connected" ? "bg-green-500" : "bg-red-500"
          )}
        />
        {status === "connected" ? "Connected" : "Disconnected"}
      </Badge>
    );
  }

  return (
    <Card>
      <CardContent className="space-y-6 p-6">
        {/* Default model picker */}
        <div>
          <Label className="text-lg font-semibold">
            Default Language Model
          </Label>
          <div className="mt-2 max-w-xs">
            <Combobox
              options={syncedModels.map((m) => ({
                value: m.value,
                label: m.name,
              }))}
              value={defaultLanguageModel}
              onChange={(value) => {
                if (value !== defaultLanguageModel) {
                  openChangeDefaultDialog(value);
                }
              }}
              placeholder="Select a model..."
            />
          </div>
        </div>

        {/* Providers Accordions */}
        <Accordion type="multiple" className="w-full">
          {/* OpenRouter */}
          <AccordionItem value="openrouter">
            <AccordionTrigger className="no-underline hover:no-underline group-hover:no-underline">
              <div className="flex w-full items-center justify-between">
                <span className="hover:underline">OpenRouter</span>
                {statusIndicator(openrouterStatus)}
              </div>
            </AccordionTrigger>
            <AccordionContent className="p-1">
              <div className="flex flex-col md:flex-row md:items-center gap-4 mb-2">
                <Input
                  type="password"
                  placeholder="API Key"
                  value={openrouterKey}
                  onChange={(e) => setOpenrouterKey(e.target.value)}
                  className="max-w-xs"
                  disabled={openrouterStatus === "connected"}
                />
                {openrouterStatus === "disconnected" ? (
                  <Button
                    variant="outline"
                    onClick={handleOpenRouterConnect}
                    disabled={!openrouterKey.trim()}
                  >
                    Connect
                  </Button>
                ) : (
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={openOpenRouterDialog}>
                      Sync models
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => openRemoveProviderDialog("OpenRouter")}
                      className="text-destructive hover:text-destructive"
                    >
                      Remove Provider
                    </Button>
                  </div>
                )}
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* Ollama */}
          <AccordionItem value="ollama">
            <AccordionTrigger className="no-underline hover:no-underline group-hover:no-underline">
              <div className="flex w-full items-center justify-between">
                <span className="hover:underline">Ollama</span>
                {statusIndicator(ollamaStatus)}
              </div>
            </AccordionTrigger>
            <AccordionContent className="p-1">
              <div className="flex flex-col md:flex-row md:items-center gap-4 mb-2">
                <Input
                  type="text"
                  placeholder="Ollama URL (e.g., http://localhost:11434)"
                  value={ollamaUrl}
                  onChange={(e) => setOllamaUrl(e.target.value)}
                  className="max-w-xs"
                  disabled={ollamaStatus === "connected"}
                />
                {ollamaStatus === "disconnected" ? (
                  <Button
                    variant="outline"
                    onClick={handleOllamaConnect}
                    disabled={!ollamaUrl.trim()}
                  >
                    Connect
                  </Button>
                ) : (
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={openOllamaDialog}>
                      Sync models
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => openRemoveProviderDialog("Ollama")}
                      className="text-destructive hover:text-destructive"
                    >
                      Remove Provider
                    </Button>
                  </div>
                )}
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>

        {/* Model Table */}
        <div>
          <Label className="text-lg font-semibold mb-2 block">
            Synced Models
          </Label>
          {syncedModels.length === 0 ? (
            <div className="border rounded-md p-8 text-center text-muted-foreground">
              <p>No models synced yet.</p>
              <p className="text-sm mt-1">
                Connect to a provider and sync models to see them here.
              </p>
            </div>
          ) : (
            <div className="divide-y border rounded-md bg-muted/30">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Provider</TableHead>
                    <TableHead>Size</TableHead>
                    <TableHead>Context</TableHead>
                    <TableHead>Capabilities</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {syncedModels.map((model) => (
                    <TableRow key={model.value}>
                      <TableCell className="font-medium">
                        {model.name}
                      </TableCell>
                      <TableCell>{model.provider}</TableCell>
                      <TableCell>{model.size}</TableCell>
                      <TableCell>{model.context}</TableCell>
                      <TableCell>
                        <div className="flex gap-1 flex-wrap">
                          {model.capabilities.map((cap) => (
                            <Badge key={cap} variant="outline">
                              {cap}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-2">
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  onClick={() =>
                                    openChangeDefaultDialog(model.value)
                                  }
                                >
                                  <Check
                                    className={cn(
                                      "w-4 h-4",
                                      defaultLanguageModel === model.value
                                        ? "text-green-500"
                                        : "text-muted-foreground"
                                    )}
                                  />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>
                                  {defaultLanguageModel === model.value
                                    ? "Current default model"
                                    : "Set as default model"}
                                </p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  onClick={() => openDeleteDialog(model.value)}
                                >
                                  <Trash2 className="w-4 h-4 text-destructive" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>Remove model</p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>

        {/* OpenRouter Model Selection Dialog */}
        <Dialog
          open={openrouterDialogOpen}
          onOpenChange={setOpenrouterDialogOpen}
        >
          <DialogContent className="min-w-4xl">
            <DialogHeader>
              <DialogTitle>Select OpenRouter Models</DialogTitle>
              <DialogDescription>
                Choose which models you want to sync from OpenRouter.
              </DialogDescription>
            </DialogHeader>
            <div className="overflow-y-auto">
              <div className="flex items-center gap-2 mb-4">
                <Input
                  placeholder="Search models..."
                  value={openrouterSearch}
                  onChange={(e) => setOpenrouterSearch(e.target.value)}
                  className="max-w-xs"
                />
                <Button
                  variant="outline"
                  onClick={() => setOpenrouterSearch("")}
                >
                  Clear
                </Button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {filteredOpenRouterModels.map((model) => (
                  <div
                    key={model.value}
                    className="flex items-start space-x-3 p-4 border rounded-lg hover:bg-muted/30 transition-colors"
                  >
                    <Checkbox
                      id={model.value}
                      checked={selectedOpenRouterModels.includes(model.value)}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          setSelectedOpenRouterModels((prev) => [
                            ...prev,
                            model.value,
                          ]);
                        } else {
                          setSelectedOpenRouterModels((prev) =>
                            prev.filter((v) => v !== model.value)
                          );
                        }
                      }}
                      className="mt-1"
                    />
                    <div className="grid gap-1.5 leading-none flex-1">
                      <label
                        htmlFor={model.value}
                        className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                      >
                        {model.name}
                      </label>
                      <div className="flex gap-2 text-xs text-muted-foreground">
                        <span>Size: {model.size}</span>
                        <span>Context: {model.context}</span>
                      </div>
                      <div className="flex gap-1 flex-wrap mt-1">
                        {model.capabilities.map((cap) => (
                          <Badge
                            key={cap}
                            variant="outline"
                            className="text-xs"
                          >
                            {cap}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setOpenrouterDialogOpen(false);
                  setSelectedOpenRouterModels([]);
                }}
              >
                Cancel
              </Button>
              <Button
                onClick={handleOpenRouterSync}
                disabled={selectedOpenRouterModels.length === 0}
              >
                Sync {selectedOpenRouterModels.length} model
                {selectedOpenRouterModels.length !== 1 ? "s" : ""}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Ollama Model Selection Dialog */}
        <Dialog open={ollamaDialogOpen} onOpenChange={setOllamaDialogOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Select Ollama Models</DialogTitle>
              <DialogDescription>
                Choose which models you want to sync from Ollama.
              </DialogDescription>
            </DialogHeader>
            <div className="max-h-96 overflow-y-auto">
              <div className="flex items-center gap-2 mb-4">
                <Input
                  placeholder="Search models..."
                  value={ollamaSearch}
                  onChange={(e) => setOllamaSearch(e.target.value)}
                  className="max-w-xs"
                />
                <Button variant="outline" onClick={() => setOllamaSearch("")}>
                  Clear
                </Button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {filteredOllamaModels.map((model) => (
                  <div
                    key={model.value}
                    className="flex items-start space-x-3 p-4 border rounded-lg hover:bg-muted/30 transition-colors"
                  >
                    <Checkbox
                      id={model.value}
                      checked={selectedOllamaModels.includes(model.value)}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          setSelectedOllamaModels((prev) => [
                            ...prev,
                            model.value,
                          ]);
                        } else {
                          setSelectedOllamaModels((prev) =>
                            prev.filter((v) => v !== model.value)
                          );
                        }
                      }}
                      className="mt-1"
                    />
                    <div className="grid gap-1.5 leading-none flex-1">
                      <label
                        htmlFor={model.value}
                        className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                      >
                        {model.name}
                      </label>
                      <div className="flex gap-2 text-xs text-muted-foreground">
                        <span>Size: {model.size}</span>
                        <span>Context: {model.context}</span>
                      </div>
                      <div className="flex gap-1 flex-wrap mt-1">
                        {model.capabilities.map((cap) => (
                          <Badge
                            key={cap}
                            variant="outline"
                            className="text-xs"
                          >
                            {cap}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setOllamaDialogOpen(false);
                  setSelectedOllamaModels([]);
                }}
              >
                Cancel
              </Button>
              <Button
                onClick={handleOllamaSync}
                disabled={selectedOllamaModels.length === 0}
              >
                Sync {selectedOllamaModels.length} model
                {selectedOllamaModels.length !== 1 ? "s" : ""}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete Confirmation Dialog */}
        <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Confirm Deletion</DialogTitle>
              <DialogDescription>
                Are you sure you want to remove "
                {syncedModels.find((m) => m.value === modelToDelete)?.name}"
                from your synced models? This action cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={cancelDelete}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={confirmDelete}>
                Remove Model
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Remove Provider Confirmation Dialog */}
        <Dialog
          open={removeProviderDialogOpen}
          onOpenChange={setRemoveProviderDialogOpen}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Remove Provider Connection</DialogTitle>
              <DialogDescription>
                Are you sure you want to remove your {providerToRemove}{" "}
                connection? This will disconnect your account and remove all
                synced models from this provider. This action cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={cancelRemoveProvider}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={confirmRemoveProvider}>
                Remove Provider
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Error Dialog */}
        <Dialog open={errorDialogOpen} onOpenChange={setErrorDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Cannot Remove Model</DialogTitle>
              <DialogDescription>{errorMessage}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button onClick={() => setErrorDialogOpen(false)}>OK</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Change Default Model Dialog */}
        <Dialog
          open={changeDefaultDialogOpen}
          onOpenChange={setChangeDefaultDialogOpen}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Change Default Model</DialogTitle>
              <DialogDescription>
                Are you sure you want to set "
                {syncedModels.find((m) => m.value === newDefaultModel)?.name}"
                as your default language model?
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={cancelChangeDefault}>
                Cancel
              </Button>
              <Button onClick={confirmChangeDefault}>Change Default</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
