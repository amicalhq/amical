import React from "react";
import { Card } from "./card";
import { Zap, Shield, Layers, BarChart, Check, X, Brain, User, Target, Wand2, Workflow } from "lucide-react";

const features = [
  {
    title: "Powered by Gen AI",
    description: "Unparalleled accuracy and power with advanced AI understanding",
    icon: <Brain className="w-6 h-6 text-emerald-500 mr-3" />,
    negativeTitle: "Basic Speech Recognition",
    negativeDescription: "Limited accuracy with outdated speech-to-text technology that struggles with context",
    negativeIcon: <Brain className="w-6 h-6 text-gray-400 mr-3" />,
  },
  {
    title: "Writes like you",
    description: "Adapts to your vocabulary and personal writing style",
    icon: <User className="w-6 h-6 text-emerald-500 mr-3" />,
    negativeTitle: "Generic Output",
    negativeDescription: "One-size-fits-all approach that doesn't adapt to your personal writing style",
    negativeIcon: <User className="w-6 h-6 text-gray-400 mr-3" />,
  },
  {
    title: "Intelligent context",
    description: "Professional for Gmail, casual for Instagram - perfect tone for every app, automatically!",
    icon: <Target className="w-6 h-6 text-emerald-500 mr-3" />,
    negativeTitle: "No Context Awareness",
    negativeDescription: "Same output regardless of whether you're writing professionally or casually",
    negativeIcon: <Target className="w-6 h-6 text-gray-400 mr-3" />,
  },
  {
    title: "Smart Formatting and Autocorrect",
    description: "Auto-corrects grammar, fixes pronouns, and adds contextual emojis",
    icon: <Wand2 className="w-6 h-6 text-emerald-500 mr-3" />,
    negativeTitle: "Basic Text Output",
    negativeDescription: "Raw speech-to-text with no intelligent formatting or context-aware corrections",
    negativeIcon: <Wand2 className="w-6 h-6 text-gray-400 mr-3" />,
  },
  {
    title: "AI Workflows powered by MCP",
    description: "Say \"Hi to Jane on WhatsApp\" and watch it happen automatically",
    icon: <Workflow className="w-6 h-6 text-emerald-500 mr-3" />,
    negativeTitle: "Text Input Only",
    negativeDescription: "Limited to basic text input with no ability to trigger actions or workflows",
    negativeIcon: <Workflow className="w-6 h-6 text-gray-400 mr-3" />,
  },
];

export default function ComparisonTraditional() {
  return (
    <section className="py-16 bg-[#0A0A0A]">
      <div className="container max-w-6xl mx-auto px-4">
        {/* Header */}
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
            Accurate and powerful, <br />native Mac and Windows dictation is no match
          </h2>
        </div>

        <Card className="bg-[#18181B] border border-[#232329] p-0 shadow-lg overflow-hidden">
          {/* Desktop Layout */}
          <div className="hidden md:grid md:grid-cols-2 md:divide-x divide-[#232329]">
            {/* Header Row */}
            <div className="p-8 flex items-center gap-2 bg-gradient-to-r from-emerald-950/50 to-emerald-900/30 border-b border-emerald-500/20">
              <Check className="w-5 h-5 text-emerald-400" />
              <span className="text-xl md:text-2xl font-bold bg-gradient-to-r from-emerald-400 to-emerald-300 bg-clip-text text-transparent">Amical Dictation</span>
            </div>
            <div className="p-8 flex items-center gap-2 bg-gradient-to-r from-gray-900/50 to-gray-800/30 border-b border-gray-600/20">
              <X className="w-5 h-5 text-gray-400" />
              <span className="text-xl md:text-2xl font-bold bg-gradient-to-r from-gray-300 to-gray-500 bg-clip-text text-transparent">Mac/Windows Native Dictation</span>
            </div>
            {/* Feature Rows */}
            {features.map((f, i) => (
              <React.Fragment key={i}>
                {/* Modern Solution Cell */}
                <div className="p-8 flex items-start gap-3 border-t border-[#232329]">
                  {f.icon}
                  <div>
                    <span className="text-white font-semibold text-base">{f.title}</span>
                    <div className="text-gray-400 text-sm mt-1">{f.description}</div>
                  </div>
                </div>
                {/* Traditional Product Cell */}
                <div className="p-8 flex items-start gap-3 border-t border-[#232329]">
                  {f.negativeIcon}
                  <div>
                    <span className="text-white font-semibold text-base">{f.negativeTitle}</span>
                    <div className="text-gray-400 text-sm mt-1">{f.negativeDescription}</div>
                  </div>
                </div>
              </React.Fragment>
            ))}
          </div>

          {/* Mobile Layout */}
          <div className="md:hidden">
            {/* First Column - Amical Dictation */}
            <div className="p-6 flex items-center gap-2 bg-gradient-to-r from-emerald-950/60 to-emerald-900/40 border-b-2 border-emerald-500/30">
              <Check className="w-5 h-5 text-emerald-400" />
              <span className="text-xl font-bold bg-gradient-to-r from-emerald-400 to-emerald-300 bg-clip-text text-transparent">Amical Dictation</span>
            </div>
            {features.map((f, i) => (
              <div key={`positive-${i}`} className="p-6 flex items-start gap-3 border-b border-[#232329]">
                {f.icon}
                <div>
                  <span className="text-white font-semibold text-base">{f.title}</span>
                  <div className="text-gray-400 text-sm mt-1">{f.description}</div>
                </div>
              </div>
            ))}

            {/* Second Column - Mac/Windows Native Dictation */}
            <div className="p-6 flex items-center gap-2 bg-gradient-to-r from-gray-900/60 to-gray-800/40 border-b-2 border-gray-600/30 mt-6">
              <X className="w-5 h-5 text-gray-400" />
              <span className="text-xl font-bold bg-gradient-to-r from-gray-300 to-gray-500 bg-clip-text text-transparent">Mac/Windows Native Dictation</span>
            </div>
            {features.map((f, i) => (
              <div key={`negative-${i}`} className="p-6 flex items-start gap-3 border-b border-[#232329] last:border-b-0">
                {f.negativeIcon}
                <div>
                  <span className="text-white font-semibold text-base">{f.negativeTitle}</span>
                  <div className="text-gray-400 text-sm mt-1">{f.negativeDescription}</div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </section>
  );
}
