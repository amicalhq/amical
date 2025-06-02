"use client"

import { useState, useEffect } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"

const emailContent = `Hi Sarah,

Thanks for yesterday's meeting! Here are our 3 follow-up items:

1. Technical Integration - Implementation roadmap by Friday
2. Custom Dashboard - Analytics mockups for your KPIs
3. Pricing Proposal - ROI analysis by next week

Available for a call Tuesday to review?

Best,
Alex`

const slackMessage = `Hey Alex, thank you for helping me out with the OKRs, you are a lifesaver! 🙌`

const jiraComment = `Bug resolved - closing the task. Please publish the changelog. Thanks!`

const whatsappMessage = `Thanks for the wonderful evening 🙏, loved the pot roast 😋, see you next week at the game 🏈!`

const cards = ["gmail", "slack", "jira", "whatsapp"] as const

export default function HeroCards() {
  const [currentCardIndex, setCurrentCardIndex] = useState(0)
  const [isTransitioning, setIsTransitioning] = useState(false)
  const [isMobile, setIsMobile] = useState(false)

  // Email states
  const [typedContent, setTypedContent] = useState("")
  const [currentIndex, setCurrentIndex] = useState(0)
  const [isTyping, setIsTyping] = useState(true)

  // Slack states
  const [slackTypedContent, setSlackTypedContent] = useState("")
  const [slackCurrentIndex, setSlackCurrentIndex] = useState(0)
  const [slackIsTyping, setSlackIsTyping] = useState(true)

  // Jira states
  const [jiraTypedContent, setJiraTypedContent] = useState("")
  const [jiraCurrentIndex, setJiraCurrentIndex] = useState(0)
  const [jiraIsTyping, setJiraIsTyping] = useState(true)

  // WhatsApp states
  const [whatsappTypedContent, setWhatsappTypedContent] = useState("")
  const [whatsappCurrentIndex, setWhatsappCurrentIndex] = useState(0)
  const [whatsappIsTyping, setWhatsappIsTyping] = useState(true)

  // Check for mobile screen size
  useEffect(() => {
    const checkScreenSize = () => {
      setIsMobile(window.innerWidth < 640)
    }

    checkScreenSize()
    window.addEventListener('resize', checkScreenSize)

    return () => window.removeEventListener('resize', checkScreenSize)
  }, [])

  // Carousel rotation function
  const rotateCarousel = () => {
    if (!isTransitioning) {
      setIsTransitioning(true)
      setTimeout(() => {
        setCurrentCardIndex((prev) => (prev + 1) % cards.length)
        setIsTransitioning(false)
      }, 300)
    }
  }

  // Email typing animation
  useEffect(() => {
    if (cards[currentCardIndex] === "gmail") {
      if (currentIndex < emailContent.length && isTyping) {
        const timeout = setTimeout(() => {
          setTypedContent(emailContent.slice(0, currentIndex + 1))
          setCurrentIndex(currentIndex + 1)
        }, 3)
        return () => clearTimeout(timeout)
      } else if (currentIndex >= emailContent.length && isTyping) {
        setIsTyping(false)
        setTimeout(() => {
          rotateCarousel()
          setTimeout(() => {
            setCurrentIndex(0)
            setTypedContent("")
            setIsTyping(true)
          }, 400)
        }, 1000)
      }
    }
  }, [currentIndex, isTyping, currentCardIndex])

  // Slack typing animation
  useEffect(() => {
    if (cards[currentCardIndex] === "slack") {
      if (slackCurrentIndex < slackMessage.length && slackIsTyping) {
        const timeout = setTimeout(() => {
          setSlackTypedContent(slackMessage.slice(0, slackCurrentIndex + 1))
          setSlackCurrentIndex(slackCurrentIndex + 1)
        }, 25)
        return () => clearTimeout(timeout)
      } else if (slackCurrentIndex >= slackMessage.length && slackIsTyping) {
        setSlackIsTyping(false)
        setTimeout(() => {
          rotateCarousel()
          setTimeout(() => {
            setSlackCurrentIndex(0)
            setSlackTypedContent("")
            setSlackIsTyping(true)
          }, 400)
        }, 2000)
      }
    }
  }, [slackCurrentIndex, slackIsTyping, currentCardIndex])

  // Jira typing animation
  useEffect(() => {
    if (cards[currentCardIndex] === "jira") {
      if (jiraCurrentIndex < jiraComment.length && jiraIsTyping) {
        const timeout = setTimeout(() => {
          setJiraTypedContent(jiraComment.slice(0, jiraCurrentIndex + 1))
          setJiraCurrentIndex(jiraCurrentIndex + 1)
        }, 30)
        return () => clearTimeout(timeout)
      } else if (jiraCurrentIndex >= jiraComment.length && jiraIsTyping) {
        setJiraIsTyping(false)
        setTimeout(() => {
          rotateCarousel()
          setTimeout(() => {
            setJiraCurrentIndex(0)
            setJiraTypedContent("")
            setJiraIsTyping(true)
          }, 400)
        }, 2000)
      }
    }
  }, [jiraCurrentIndex, jiraIsTyping, currentCardIndex])

  // WhatsApp typing animation
  useEffect(() => {
    if (cards[currentCardIndex] === "whatsapp") {
      if (whatsappCurrentIndex < whatsappMessage.length && whatsappIsTyping) {
        const timeout = setTimeout(() => {
          setWhatsappTypedContent(whatsappMessage.slice(0, whatsappCurrentIndex + 1))
          setWhatsappCurrentIndex(whatsappCurrentIndex + 1)
        }, 20)
        return () => clearTimeout(timeout)
      } else if (whatsappCurrentIndex >= whatsappMessage.length && whatsappIsTyping) {
        setWhatsappIsTyping(false)
        setTimeout(() => {
          rotateCarousel()
          setTimeout(() => {
            setWhatsappCurrentIndex(0)
            setWhatsappTypedContent("")
            setWhatsappIsTyping(true)
          }, 400)
        }, 2000)
      }
    }
  }, [whatsappCurrentIndex, whatsappIsTyping, currentCardIndex])

  const renderGmailCard = () => (
    <Card className="shadow-xl border border-neutral-800 bg-neutral-950 overflow-hidden flex flex-col w-full h-full py-0 gap-0">
      {/* Gmail Header */}
      <div className="bg-neutral-900 px-3 py-1.5 flex items-center justify-between border-b border-neutral-800">
        <div className="flex items-center gap-2">
          <img
            src="/integrations/gmail.svg"
            alt="Gmail"
            className="w-5 h-5"
          />
          <span className="text-sm font-medium text-neutral-300">New Email</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-4 h-4 bg-neutral-600 rounded-sm"></div>
          <div className="w-4 h-4 bg-neutral-600 rounded-sm"></div>
          <div className="w-4 h-4 bg-neutral-600 rounded-sm"></div>
        </div>
      </div>

      <CardContent className="p-0 flex flex-col flex-1">
        {/* Email Fields */}
        <div className="space-y-0">
          <div className="flex items-center border-b border-neutral-800 px-3 py-1.5">
            <label className="text-sm text-neutral-400 w-12 flex-shrink-0">To</label>
            <div className="flex-1 bg-neutral-950 px-2 py-0.5">
              <div className="h-4 bg-neutral-700 rounded w-48"></div>
            </div>
          </div>
          <div className="flex items-center border-b border-neutral-800 px-3 py-1.5">
            <label className="text-sm text-neutral-400 w-12 flex-shrink-0">Subject</label>
            <div className="flex-1 bg-neutral-950 px-2 py-0.5">
              <div className="h-4 bg-neutral-700 rounded w-40"></div>
            </div>
          </div>
        </div>

        {/* Email Body */}
        <div className="px-3 py-0.5 flex-1 bg-neutral-950">
          <div className="whitespace-pre-wrap text-xs leading-relaxed text-neutral-100">
            {typedContent}
            {isTyping && <span className="animate-pulse bg-blue-500 w-0.5 h-4 inline-block ml-1" />}
          </div>
        </div>

        {/* Bottom Actions */}
        <div className="px-3 py-1 bg-neutral-900 border-t border-neutral-800 flex items-center justify-between mt-auto">
          <div className="flex items-center gap-2">
            <button className="bg-blue-600 text-white px-4 py-1.5 rounded text-sm font-medium hover:bg-blue-700">
              Send
            </button>
            <div className="flex items-center gap-1">
              <div className="w-4 h-4 bg-neutral-700 rounded cursor-pointer"></div>
              <div className="w-4 h-4 bg-neutral-700 rounded cursor-pointer"></div>
              <div className="w-4 h-4 bg-neutral-700 rounded cursor-pointer"></div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-4 h-4 bg-neutral-700 rounded cursor-pointer"></div>
            <div className="w-4 h-4 bg-neutral-700 rounded cursor-pointer"></div>
          </div>
        </div>
      </CardContent>
    </Card>
  )

  const renderSlackCard = () => (
    <Card className="shadow-lg border border-neutral-800 bg-neutral-950 overflow-hidden flex flex-col w-full h-full py-0 gap-0">
      {/* Slack Header */}
      <div className="bg-neutral-900 px-3 py-1.5 flex items-center justify-between border-b border-neutral-800">
        <div className="flex items-center gap-2">
          <img
            src="/integrations/slack.svg"
            alt="Slack"
            className="w-5 h-5"
          />
          <span className="text-sm font-medium text-neutral-300">New Message</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-4 h-4 bg-neutral-600 rounded-sm"></div>
          <div className="w-4 h-4 bg-neutral-600 rounded-sm"></div>
          <div className="w-4 h-4 bg-neutral-600 rounded-sm"></div>
        </div>
      </div>

      {/* Channel Header */}
      <div className="bg-neutral-950 border-b border-neutral-800 px-4 py-1.5">
        <div className="flex items-center gap-2">
          <span className="text-md text-neutral-100"># dev-team</span>
          <div className="w-4 h-4 bg-neutral-700 rounded-full"></div>
          <span className="text-sm text-neutral-400">42 members</span>
        </div>
      </div>

      <CardContent className="p-0 bg-neutral-950 flex-1 flex flex-col">
        {/* Messages Area */}
        <div className="px-4 py-1.5 h-[80px] overflow-y-auto space-y-2 flex-1">
          <div className="flex gap-3 hover:bg-neutral-900 px-2 py-1 rounded">
            <Avatar className="w-9 h-9 mt-1">
              <AvatarFallback className="text-sm bg-blue-500 text-white font-semibold">AM</AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2 mb-2">
                <span className="text-sm font-bold text-neutral-100">Alex Miller</span>
                <span className="text-xs text-neutral-400">2:34 PM</span>
              </div>
              <div className="space-y-1">
                <div className="h-4 bg-neutral-700 rounded w-full"></div>
                <div className="h-4 bg-neutral-700 rounded w-3/4"></div>
              </div>
            </div>
          </div>

          <div className="flex gap-3 hover:bg-neutral-900 px-2 py-1 rounded">
            <Avatar className="w-9 h-9 mt-1">
              <AvatarFallback className="text-sm bg-green-500 text-white font-semibold">JD</AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2 mb-2">
                <span className="text-sm font-bold text-neutral-100">Jane Doe</span>
                <span className="text-xs text-neutral-400">2:35 PM</span>
              </div>
              <div className="space-y-1">
                <div className="h-4 bg-neutral-700 rounded w-2/3"></div>
              </div>
            </div>
          </div>
        </div>

        {/* Message Input */}
        <div className="border-t border-neutral-800 p-2 mt-auto">
          <div className="border border-neutral-700 rounded-lg bg-neutral-950">
            <div className="px-3 py-1.5 min-h-[48px] flex items-start">
              <span className="text-sm text-neutral-100 leading-relaxed">
                {slackTypedContent}
                {slackIsTyping && <span className="animate-pulse bg-neutral-400 w-0.5 h-4 inline-block ml-1" />}
              </span>
            </div>
            <div className="border-t border-neutral-700 px-3 py-1.5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 bg-neutral-800 rounded"></div>
                <div className="w-5 h-5 bg-neutral-800 rounded"></div>
                <div className="w-5 h-5 bg-neutral-800 rounded"></div>
              </div>
              <div className="w-8 h-6 bg-green-600 rounded text-white flex items-center justify-center">
                <span className="text-xs">→</span>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )

  const renderJiraCard = () => (
    <Card className="shadow-lg border border-neutral-800 bg-neutral-950 overflow-hidden flex flex-col w-full h-full py-0 gap-0">
      {/* Jira Header */}
      <div className="bg-neutral-900 px-3 py-1.5 flex items-center justify-between border-b border-neutral-800">
        <div className="flex items-center gap-2">
          <img src="/integrations/jira.svg" alt="Jira" className="w-5 h-5" />
          <span className="text-sm font-medium text-neutral-300">Add Comment</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-4 h-4 bg-neutral-600 rounded-sm"></div>
          <div className="w-4 h-4 bg-neutral-600 rounded-sm"></div>
          <div className="w-4 h-4 bg-neutral-600 rounded-sm"></div>
        </div>
      </div>

      {/* Task Header */}
      <div className="bg-neutral-950 border-b border-neutral-800 px-4 py-1.5">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 bg-red-500 rounded-sm flex items-center justify-center">
            <span className="text-xs text-white font-bold">🐛</span>
          </div>
          <span className="text-sm text-neutral-100">BUG-1234</span>
          <div className="h-4 bg-neutral-700 rounded w-48"></div>
        </div>
      </div>

      <CardContent className="p-0 bg-neutral-950 flex flex-col flex-1">
        {/* Task Details */}
        <div className="px-4 py-1.5 space-y-1.5 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-xs text-neutral-400 w-16">Status:</span>
            <div className="bg-green-900 text-green-300 px-2 py-1 rounded text-xs font-medium">Done</div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-neutral-400 w-16">Assignee:</span>
            <Avatar className="w-6 h-6">
              <AvatarFallback className="text-xs bg-blue-500 text-white font-semibold">JD</AvatarFallback>
            </Avatar>
            <span className="text-xs text-neutral-300">John Developer</span>
          </div>

          <div className="space-y-2">
            <div className="border-l-2 border-neutral-700 pl-3">
              <div className="flex items-center gap-2 mb-1">
                <Avatar className="w-5 h-5">
                  <AvatarFallback className="text-xs bg-purple-500 text-white font-semibold">PM</AvatarFallback>
                </Avatar>
                <span className="text-xs font-medium text-neutral-300">Product Manager</span>
                <span className="text-xs text-neutral-400">2 hours ago</span>
              </div>
              <div className="space-y-1">
                <div className="h-3 bg-neutral-700 rounded w-full"></div>
                <div className="h-3 bg-neutral-700 rounded w-3/4"></div>
              </div>
            </div>
          </div>
        </div>

        {/* Comment Input */}
        <div className="border-t border-neutral-800 p-2 mt-auto">
          <div className="border border-neutral-700 rounded-md bg-neutral-950">
            <div className="px-3 py-1.5 min-h-[48px] flex items-start">
              <span className="text-sm text-neutral-100 leading-relaxed">
                {jiraTypedContent}
                {jiraIsTyping && <span className="animate-pulse bg-blue-500 w-0.5 h-4 inline-block ml-1" />}
              </span>
            </div>
            <div className="border-t border-neutral-700 px-3 py-1.5 flex items-center justify-between bg-neutral-900">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 bg-neutral-800 rounded flex items-center justify-center">
                  <span className="text-xs text-neutral-300">B</span>
                </div>
                <div className="w-6 h-6 bg-neutral-800 rounded flex items-center justify-center">
                  <span className="text-xs text-neutral-300">I</span>
                </div>
                <div className="w-6 h-6 bg-neutral-800 rounded flex items-center justify-center">
                  <span className="text-xs text-neutral-300">@</span>
                </div>
              </div>
              <div className="bg-blue-600 text-white px-3 py-1.5 rounded text-xs font-medium">Comment</div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )

  const renderWhatsAppCard = () => (
    <Card className="shadow-lg border border-neutral-800 bg-neutral-950 overflow-hidden flex flex-col w-full h-full py-0 gap-0">
      {/* WhatsApp Header */}
      <div className="bg-neutral-900 px-3 py-1.5 flex items-center justify-between border-b border-neutral-800">
        <div className="flex items-center gap-2">
          <img
            src="/integrations/whatsapp.svg"
            alt="WhatsApp"
            className="w-5 h-5"
          />
          <span className="text-sm font-medium text-neutral-300">Send IM</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-4 h-4 bg-neutral-600 rounded-sm"></div>
          <div className="w-4 h-4 bg-neutral-600 rounded-sm"></div>
          <div className="w-4 h-4 bg-neutral-600 rounded-sm"></div>
        </div>
      </div>

      {/* Chat Header */}
      <div className="bg-neutral-950 border-b border-neutral-800 px-4 py-1.5">
        <div className="flex items-center gap-2">
          <span className="text-md text-neutral-100">Family Group</span>
          <div className="w-4 h-4 bg-neutral-700 rounded-full"></div>
          <span className="text-sm text-neutral-400">5 members</span>
        </div>
      </div>

      <CardContent className="p-0 bg-neutral-950 flex-1 flex flex-col">
        {/* Messages Area */}
        <div className="px-4 py-1.5 h-[80px] overflow-y-auto space-y-2 flex-1">
          <div className="flex gap-3 hover:bg-neutral-900 px-2 py-1 rounded">
            <Avatar className="w-9 h-9 mt-1">
              <AvatarFallback className="text-sm bg-purple-500 text-white font-semibold">MO</AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2 mb-2">
                <span className="text-sm font-bold text-neutral-100">Mom</span>
                <span className="text-xs text-neutral-400">7:45 PM</span>
              </div>
              <div className="space-y-1">
                <div className="h-4 bg-neutral-700 rounded w-full"></div>
                <div className="h-4 bg-neutral-700 rounded w-1/2"></div>
              </div>
            </div>
          </div>

          <div className="flex gap-3 hover:bg-neutral-900 px-2 py-1 rounded">
            <Avatar className="w-9 h-9 mt-1">
              <AvatarFallback className="text-sm bg-blue-500 text-white font-semibold">DA</AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2 mb-2">
                <span className="text-sm font-bold text-neutral-100">Dad</span>
                <span className="text-xs text-neutral-400">8:12 PM</span>
              </div>
              <div className="space-y-1">
                <div className="h-4 bg-neutral-700 rounded w-3/4"></div>
                <div className="h-4 bg-neutral-700 rounded w-1/2"></div>
              </div>
            </div>
          </div>


        </div>

        {/* Message Input */}
        <div className="border-t border-neutral-800 p-2 mt-auto">
          <div className="border border-neutral-700 rounded-lg bg-neutral-950">
            <div className="px-3 py-1.5 min-h-[48px] flex items-start">
              <span className="text-sm text-neutral-100 leading-relaxed">
                {whatsappTypedContent}
                {whatsappIsTyping && <span className="animate-pulse bg-green-500 w-0.5 h-4 inline-block ml-1" />}
              </span>
            </div>
            <div className="border-t border-neutral-700 px-3 py-1.5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 bg-neutral-800 rounded"></div>
                <div className="w-5 h-5 bg-neutral-800 rounded"></div>
                <div className="w-5 h-5 bg-neutral-800 rounded"></div>
              </div>
              <div className="w-8 h-6 bg-green-600 rounded text-white flex items-center justify-center">
                <span className="text-xs">→</span>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )

  const renderCard = (cardType: string) => {
    switch (cardType) {
      case "gmail":
        return renderGmailCard()
      case "slack":
        return renderSlackCard()
      case "jira":
        return renderJiraCard()
      case "whatsapp":
        return renderWhatsAppCard()
      default:
        return null
    }
  }

  const renderCurrentCardIcon = () => {
    switch (cards[currentCardIndex]) {
      case "gmail":
        return (
          <img
            src="/integrations/gmail.svg"
            alt="Gmail"
            className="w-5 h-5"
          />
        )
      case "slack":
        return (
          <img
            src="/integrations/slack.svg"
            alt="Slack"
            className="w-5 h-5"
          />
        )
      case "jira":
        return <img src="/integrations/jira.svg" alt="Jira" className="w-5 h-5" />
      case "whatsapp":
        return (
          <img
            src="/integrations/whatsapp.svg"
            alt="WhatsApp"
            className="w-5 h-5"
          />
        )
      default:
        return null
    }
  }

  return (
    <div className="w-full flex flex-col items-center justify-center bg-neutral-950 overflow-hidden py-4 sm:py-8">
      {/* Carousel Container */}
      <div className="relative w-full max-w-4xl h-[380px] sm:h-[320px] md:h-[400px]">
        <div className="relative w-full h-full overflow-hidden">
          {/* Fade Gradients */}
          <div className="absolute left-0 top-0 w-8 sm:w-24 md:w-32 h-full bg-gradient-to-r from-neutral-950 to-transparent z-10 pointer-events-none"></div>
          <div className="absolute right-0 top-0 w-8 sm:w-24 md:w-32 h-full bg-gradient-to-l from-neutral-950 to-transparent z-10 pointer-events-none"></div>

          {/* Cards Container with responsive scaling */}
          <div
            className={`flex transition-transform duration-300 ease-in-out h-full ${isTransitioning ? "opacity-90" : "opacity-100"} scale-65 sm:scale-75 md:scale-90 lg:scale-100 origin-center`}
            style={{
              transform: `translateX(calc(-${currentCardIndex * (isMobile ? 57 : 40)}% + ${isMobile ? '-22' : '15'}%))`,
              width: `${cards.length * (isMobile ? 50 : 35)}%`,
            }}
          >
            {cards.map((cardType, index) => (
              <div
                key={cardType}
                className="w-3/5 sm:w-2/5 px-1 sm:px-2 h-full flex-shrink-0"
                style={{
                  opacity: index === currentCardIndex ? 1 : 0.3,
                  transform: index === currentCardIndex ? "scale(1)" : "scale(0.9)",
                  transition: "opacity 300ms ease-in-out, transform 300ms ease-in-out",
                }}
              >
                {renderCard(cardType)}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Recording Pill - Fixed below cards with stronger indigo glow */}
      <div className="-mt-10 sm:mt-0 md:mt-8 mb-8">
        <div
          className="flex items-center gap-2 sm:gap-3 md:gap-4 bg-black rounded-full px-4 sm:px-5 md:px-6 py-2 sm:py-2.5 md:py-3 border border-neutral-700 relative"
          style={{
            boxShadow:
              "0 0 30px rgba(99, 102, 241, 0.6), 0 0 60px rgba(99, 102, 241, 0.3), 0 0 90px rgba(99, 102, 241, 0.1)",
          }}
        >
          {/* Dynamic App Icon */}
          <div>
            {renderCurrentCardIcon()}
          </div>

          {/* Extended Recording Wave Animation */}
          <div className="flex items-center gap-[1px] sm:gap-[2px] h-4 sm:h-5">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => (
              <div
                key={i}
                className="w-[2px] sm:w-[3px] bg-green-500 rounded-full"
                style={{
                  height: `${Math.max(30, 50 + Math.sin(i) * 20)}%`,
                  animation: `waveAnimation ${0.5 + i * 0.1}s ease-in-out infinite alternate`,
                }}
              />
            ))}
          </div>
        </div>
      </div>

      {/* CSS for wave animation */}
      <style jsx global>{`
        @keyframes waveAnimation {
          0% {
            height: 30%;
          }
          100% {
            height: 100%;
          }
        }
      `}</style>
    </div>
  )
}
