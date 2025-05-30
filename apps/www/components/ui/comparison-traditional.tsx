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
          <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-[#232329]">
            {/* Header Row */}
            <div className="p-8 flex items-center gap-2">
              <Check className="w-5 h-5 text-emerald-500" />
              <span className="text-xl md:text-2xl font-bold bg-gradient-to-r from-emerald-500 to-purple-500 bg-clip-text text-transparent">Amical Dictation</span>
            </div>
            <div className="p-8 flex items-center gap-2">
              <X className="w-5 h-5 text-gray-400" />
              <span className="text-xl md:text-2xl font-bold bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">Mac/Windows Native Dictation</span>
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
        </Card>
      </div>
    </section>
  );
}
