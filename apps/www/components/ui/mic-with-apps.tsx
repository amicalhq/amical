import Image from "next/image"
import { Mic } from "lucide-react"

// App logos with their URLs
const appLogos = [
  { name: "Slack", icon: "https://amical.ai/integrations/slack.svg" },
  { name: "Notion", icon: "integrations/notion.svg" },
  { name: "Gmail", icon: "integrations/gmail.svg" },
  { name: "Discord", icon: "https://amical.ai/integrations/discord.svg" },
  { name: "Cursor", icon: "https://amical.ai/integrations/cursor.svg" },
  { name: "Instagram", icon: "https://amical.ai/integrations/instagram.svg" },
  { name: "WhatsApp", icon: "https://amical.ai/integrations/whatsapp.svg" },
]

interface MicrophoneWithAppsProps {
  isDarkMode?: boolean
  logoSize?: number
  radius?: number
}

export default function MicrophoneWithApps({
  isDarkMode = false,
  logoSize = 48,
  radius = 130,
}: MicrophoneWithAppsProps) {
  // Determine glow class based on mode
  const glowClass = isDarkMode ? "mic-glow-dark" : "mic-glow"

  // Determine colors based on mode
  const outerGlowColor = isDarkMode ? "bg-purple-500" : "bg-purple-600"
  const centerColor = isDarkMode ? "bg-purple-500" : "bg-purple-600"
  const shadowEffect = isDarkMode
    ? "shadow-[0_0_15px_6px_rgba(168,85,247,0.6)]"
    : "shadow-[0_0_12px_4px_rgba(147,51,234,0.5)]"
  const micShadow = isDarkMode
    ? "drop-shadow-[0_0_5px_rgba(255,255,255,0.9)]"
    : "drop-shadow-[0_0_3px_rgba(255,255,255,0.8)]"

  return (
    <div className="relative flex items-center justify-center w-[500px] h-[500px]">
      {/* Microphone Component */}
      <div className="relative w-36 h-36 flex items-center justify-center">
        <div className="w-36 h-36 rounded-full flex items-center justify-center bg-transparent relative animate-pulse">
          {/* Outer glow layers */}
          <div className={`absolute inset-[-12px] ${outerGlowColor}/10 rounded-full blur-md`}></div>
          <div className={`absolute inset-[-9px] ${outerGlowColor}/15 rounded-full blur-md`}></div>
          <div className={`absolute inset-[-6px] ${outerGlowColor}/20 rounded-full blur-md`}></div>

          {/* Inner glow layers */}
          <div className="absolute inset-0 bg-purple-700/30 rounded-full"></div>
          <div className="absolute inset-[3px] bg-purple-700/40 rounded-full"></div>
          <div className="absolute inset-[6px] bg-purple-700/50 rounded-full"></div>
          <div className="absolute inset-[9px] bg-purple-800/60 rounded-full"></div>
          <div className="absolute inset-[12px] bg-purple-800/70 rounded-full"></div>

          {/* Center circle with microphone */}
          <div
            className={`absolute inset-[15px] ${centerColor} rounded-full flex items-center justify-center ${shadowEffect} ${glowClass}`}
          >
            <Mic className={`h-8 w-8 text-white ${micShadow}`} />
          </div>
        </div>
      </div>

      {/* Surrounding app logos */}
      {appLogos.map((app, index) => {
        // Calculate position in a circle
        const angle = index * (360 / appLogos.length) * (Math.PI / 180)
        const x = radius * Math.cos(angle)
        const y = radius * Math.sin(angle)

        return (
          <div
            key={app.name}
            className="absolute flex items-center justify-center"
            style={{ transform: `translate(${x}px, ${y}px)` }}
          >
            <Image
              src={app.icon || "/placeholder.svg"}
              alt={`${app.name} logo`}
              width={logoSize}
              height={logoSize}
              className="object-contain"
              unoptimized={true}
            />
          </div>
        )
      })}
    </div>
  )
}
