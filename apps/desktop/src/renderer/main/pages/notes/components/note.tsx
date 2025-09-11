import { useState } from "react";
import {
  Sparkles,
  Share,
  Mic,
  MoreHorizontal,
  Copy,
  FileText,
  FolderOpen,
  Trash2,
  Check,
  Star,
  FileTextIcon,
  Loader2,
} from "lucide-react";
import EmojiPicker, { Theme } from "emoji-picker-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type InvitedUser = {
  id: number;
  name: string;
  avatar?: string;
  email: string;
  access: string;
  status: "active" | "invited";
};

export type NotePageUIProps = {
  noteId: string;
  noteTitle: string;
  noteBody: string;
  noteEmoji: string | null;
  isLoading: boolean;
  isSyncing: boolean;
  lastEditDate: Date;
  onTitleChange: (value: string) => void;
  onBodyChange: (value: string) => void;
  onDelete: () => void;
  onEmojiChange: (emoji: string | null) => void;
  onBack?: () => void;
  isDeleting?: boolean;
};

export default function Note({
  noteTitle,
  noteBody,
  noteEmoji,
  isLoading,
  isSyncing,
  lastEditDate,
  onTitleChange,
  onBodyChange,
  onDelete,
  onEmojiChange,
  isDeleting = false,
}: NotePageUIProps) {
  // Local UI state
  const [shareEmail, setShareEmail] = useState("");
  const [accessLevel, setAccessLevel] = useState("can-read");
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [invitedUsers, setInvitedUsers] = useState<Array<InvitedUser>>([]);
  const [starred, setStarred] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);

  // Mock shared users data
  /* const sharedUsers = [
    {
      id: 1,
      name: "Alice Johnson",
      avatar:
        "https://images.unsplash.com/photo-1588516903720-8ceb67f9ef84?q=80&w=1344&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D",
      email: "alice@example.com",
      access: "can-write",
      status: "active" as const,
    },
    {
      id: 2,
      name: "Bob Smith",
      avatar:
        "https://images.unsplash.com/photo-1564564321837-a57b7070ac4f?q=80&w=2676&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D",
      email: "bob@example.com",
      access: "can-write",
      status: "active" as const,
    },
    {
      id: 3,
      name: "Carol Davis",
      avatar:
        "https://images.unsplash.com/photo-1560087637-bf797bc7796a?q=80&w=1287&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D",
      email: "carol@example.com",
      access: "can-read",
      status: "active" as const,
    },
  ]; */

  // TODO: implement actual share functionality
  /* const handleShare = () => {
    if (shareEmail) {
      const newInvite = {
        id: Date.now(),
        name: shareEmail.split("@")[0],
        email: shareEmail,
        access: accessLevel,
        status: "invited" as const,
      };
      setInvitedUsers((prev) => [...prev, newInvite]);
      setShowConfirmation(true);
      setShareEmail("");

      // Hide confirmation after 3 seconds
      setTimeout(() => setShowConfirmation(false), 3000);
    }
  }; */

  const handleDeleteClick = () => {
    setShowDeleteDialog(false);
    onDelete();
  };

  const handleEmojiSelect = (emojiData: { emoji: string }) => {
    onEmojiChange(emojiData.emoji);
    setShowEmojiPicker(false);
  };

  const handleEmojiRemove = () => {
    onEmojiChange(null);
  };

  /* const allUsers = [...sharedUsers, ...invitedUsers]; */

  // Loading state
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="">
        {/* Note Content */}
        <div className="mt-0 space-y-2">
          {/* Note Title with Emoji Picker */}
          <div className="flex items-center">
            {/* Emoji Picker */}
            <Popover open={showEmojiPicker} onOpenChange={setShowEmojiPicker}>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-12 w-12 p-0 hover:bg-muted/50"
                >
                  {noteEmoji ? (
                    <span className="text-2xl">{noteEmoji}</span>
                  ) : (
                    <FileTextIcon className="!h-6 !w-6 text-muted-foreground" />
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <div>
                  {noteEmoji && (
                    <div className="flex justify-end p-2 border-b">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleEmojiRemove}
                        className="text-xs"
                      >
                        Remove emoji
                      </Button>
                    </div>
                  )}
                  <EmojiPicker
                    onEmojiClick={handleEmojiSelect}
                    autoFocusSearch={false}
                    theme={Theme.DARK}
                    lazyLoadEmojis={false}
                    height={400}
                    width={400}
                  />
                </div>
              </PopoverContent>
            </Popover>

            {/* Note Title Input */}
            <Input
              value={noteTitle}
              onChange={(e) => onTitleChange(e.target.value)}
              className="!text-4xl font-semibold border-none px-4 py-2 focus-visible:ring-0 placeholder:text-muted-foreground flex-1"
              style={{ backgroundColor: "transparent" }}
              placeholder="Note title..."
              disabled={isSyncing}
            />
          </div>

          {/* Top Bar */}
          <div className="flex items-center justify-start pl-4 pb-0.5 bg-card">
            {/* Right side - Actions */}
            <div className="flex items-center ">
              {/* Last edited date */}
              <span className="text-sm text-muted-foreground">
                Edited{" "}
                {lastEditDate.toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year:
                    lastEditDate.getFullYear() !== new Date().getFullYear()
                      ? "numeric"
                      : undefined,
                })}
              </span>

              {/* {console.log("[v0] Note ID:", noteId)} */}

              {/* <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled
                    className="gap-1 mx-1.5"
                  >
                    <Sparkles className="h-4 w-4" />
                    AI Notes
                  </Button>
                </TooltipTrigger>
                <TooltipContent>AI Notes coming soon</TooltipContent>
              </Tooltip> */}

              {/* Shared users avatars */}
              {/* <div className="flex -space-x-2">
                {sharedUsers.map((user) => (
                  <Tooltip key={user.id}>
                    <TooltipTrigger asChild>
                      <Avatar className="h-8 w-8 border-2 border-background cursor-pointer">
                        <AvatarImage
                          className="object-cover"
                          src={user.avatar || "/placeholder.svg"}
                          alt={user.name}
                        />
                        <AvatarFallback className="text-xs">
                          {user.name
                            .split(" ")
                            .map((n) => n[0])
                            .join("")}
                        </AvatarFallback>
                      </Avatar>
                    </TooltipTrigger>
                    <TooltipContent>
                      <div className="text-center">
                        <p className="font-medium">{user.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {user.email}
                        </p>
                      </div>
                    </TooltipContent>
                  </Tooltip>
                ))}
              </div> */}

              {/* Star the note */}
              {/* <Button
                size="sm"
                variant="ghost"
                className="gap-2"
                onClick={() => setStarred(!starred)}
              >
                <Star
                  fill={starred ? "orange" : "none"}
                  stroke={starred ? "orange" : "currentColor"}
                  className="h-4 w-4"
                />
              </Button> */}

              {/* Share button with popover */}
              {/* <Popover>
                <PopoverTrigger asChild>
                  <Button size="sm" variant="ghost">
                    <Share className="h-4 w-4" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-80" align="end">
                  <div className="space-y-4">
                    {showConfirmation ? (
                      <div className="flex items-center gap-2 p-3 bg-green-50 dark:bg-green-950/20 rounded-lg border border-green-200 dark:border-green-800">
                        <Check className="h-4 w-4 text-green-600 dark:text-green-400" />
                        <span className="text-sm text-green-700 dark:text-green-300">
                          Invitation sent successfully!
                        </span>
                      </div>
                    ) : (
                      <>
                        <div>
                          <h4 className="font-medium text-sm mb-2">
                            Share this note
                          </h4>
                          <p className="text-xs text-muted-foreground mb-3">
                            Invite others to collaborate on this note
                          </p>
                        </div>

                        <div className="space-y-3">
                          <Input
                            placeholder="Enter email address"
                            value={shareEmail}
                            onChange={(e) => setShareEmail(e.target.value)}
                          />

                          <Select
                            value={accessLevel}
                            onValueChange={setAccessLevel}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="full-access">
                                Full access
                              </SelectItem>
                              <SelectItem value="can-write">
                                Can write
                              </SelectItem>
                              <SelectItem value="can-read">Can read</SelectItem>
                            </SelectContent>
                          </Select>

                          <Button
                            onClick={handleShare}
                            className="w-full"
                            size="sm"
                          >
                            Send invitation
                          </Button>
                        </div>
                      </>
                    )}

                    {allUsers.length > 0 && (
                      <div className="pt-3 border-t border-border">
                        <h5 className="text-xs font-medium mb-2 text-muted-foreground">
                          People with access
                        </h5>
                        <div className="space-y-2">
                          {allUsers.map((user) => (
                            <div
                              key={user.id}
                              className="flex items-center gap-2"
                            >
                              <Avatar className="h-6 w-6">
                                <AvatarImage
                                  src={user.avatar || "/placeholder.svg"}
                                  alt={user.name}
                                />
                                <AvatarFallback className="text-xs">
                                  {user.name
                                    .split(" ")
                                    .map((n) => n[0])
                                    .join("")}
                                </AvatarFallback>
                              </Avatar>
                              <div className="flex-1">
                                <span className="text-xs">{user.name}</span>
                                {user.status === "invited" && (
                                  <span className="text-xs text-muted-foreground ml-1">
                                    (invited)
                                  </span>
                                )}
                              </div>
                              <span className="text-xs text-muted-foreground capitalize">
                                {user.access.replace("-", " ")}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </PopoverContent>
              </Popover> */}

              {/* <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="sm" disabled>
                    <Mic className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Transcription coming soon</TooltipContent>
              </Tooltip> */}

              {/* More actions dropdown */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {/* <DropdownMenuItem className="gap-2">
                    <Copy className="h-4 w-4" />
                    Copy
                  </DropdownMenuItem>
                  <DropdownMenuItem className="gap-2">
                    <FileText className="h-4 w-4" />
                    Duplicate
                  </DropdownMenuItem>
                  <DropdownMenuItem className="gap-2">
                    <FolderOpen className="h-4 w-4" />
                    Move to
                  </DropdownMenuItem> */}
                  <AlertDialog
                    open={showDeleteDialog}
                    onOpenChange={setShowDeleteDialog}
                  >
                    <AlertDialogTrigger asChild>
                      <DropdownMenuItem
                        className="gap-2"
                        onSelect={(e) => e.preventDefault()}
                        variant="destructive"
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                        Delete
                      </DropdownMenuItem>
                    </AlertDialogTrigger>
                  </AlertDialog>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {/* Note Body */}
          <Textarea
            value={noteBody}
            onChange={(e) => onBodyChange(e.target.value)}
            placeholder="Start writing your note..."
            className="min-h-[500px] resize-none border-none bg-transparent px-4 py-2 focus-visible:ring-0 text-base leading-relaxed placeholder:text-muted-foreground"
            style={{
              backgroundColor: "transparent",
            }}
            disabled={isSyncing}
          />
        </div>

        {/* Delete Confirmation Dialog */}
        <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Note</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete "{noteTitle}"? This action
                cannot be undone and the note will be permanently removed.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleDeleteClick}
                className="bg-destructive text-foreground hover:bg-destructive/90"
                disabled={isDeleting}
              >
                {isDeleting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Deleting...
                  </>
                ) : (
                  "Delete Note"
                )}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </TooltipProvider>
  );
}
