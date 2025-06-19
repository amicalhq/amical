import * as React from "react"
import { Mic, Settings, FileText, History, User, Book } from "lucide-react"
import { NavUser } from "@/components/nav-user"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"

// Sample data for Amical app
const data = {
  user: {
    name: "Amical User",
    email: "user@amical.app",
    avatar: "/avatars/user.jpg",
  },
  navMain: [
    {
      title: "Voice Recording",
      url: "#",
      icon: Mic,
      isActive: true,
    },
    {
      title: "Transcriptions",
      url: "#",
      icon: FileText,
      isActive: false,
    },
    {
      title: "Vocabulary",
      url: "#",
      icon: Book,
      isActive: false,
    },
    {
      title: "History",
      url: "#",
      icon: History,
      isActive: false,
    },
    {
      title: "Settings",
      url: "#",
      icon: Settings,
      isActive: false,
    },
    {
      title: "Profile",
      url: "#",
      icon: User,
      isActive: false,
    },
  ],
}

interface AppSidebarProps extends React.ComponentProps<typeof Sidebar> {
  onNavigate?: (item: typeof data.navMain[0]) => void
}

export function AppSidebar({ onNavigate, ...props }: AppSidebarProps) {
  const [activeItem, setActiveItem] = React.useState(data.navMain[0])

  const handleItemClick = (item: typeof data.navMain[0]) => {
    setActiveItem(item)
    onNavigate?.(item)
  }

  return (
    <Sidebar
      collapsible="icon"
      className="!w-[calc(var(--sidebar-width-icon)_+_1px)] [&>div]:pt-14"
      {...props}
    >
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild className="md:h-8 md:p-0">
              <a href="#">
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg">
                  <img 
                    src="/assets/logo.svg" 
                    alt="Amical" 
                    className="size-8"
                    onError={(e) => {
                      // Fallback to PNG if SVG fails
                      e.currentTarget.src = "/assets/logo-32.png";
                    }}
                  />
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">Amical</span>
                  <span className="truncate text-xs">Voice Assistant</span>
                </div>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent className="px-1.5 md:px-0">
            <SidebarMenu>
              {data.navMain.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    tooltip={{
                      children: item.title,
                      hidden: false,
                    }}
                    onClick={() => handleItemClick(item)}
                    isActive={activeItem?.title === item.title}
                    className="px-2.5 md:px-2"
                  >
                    <item.icon />
                    <span>{item.title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="gap-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              className="flex items-center justify-center size-8"
              tooltip={{
                children: "Join Discord Community",
                hidden: false,
              }}
            >
              <a 
                href="https://amical.ai/community" 
                target="_blank" 
                rel="noopener noreferrer"
                className="flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
              >
                <img 
                  src="/assets/discord-icon.svg" 
                  alt="Discord" 
                  className="w-5 h-5"
                />
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <NavUser user={data.user} />
      </SidebarFooter>
    </Sidebar>
  )
} 