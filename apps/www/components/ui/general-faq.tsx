"use client";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import Link from "next/link";

const faqItems = [
  {
    question: "What is Amical?",
    answer: "Amical is an open-source speech-to-text application powered by Gen AI. It allows you to type 10x faster without using a keyboard, offering fast, accurate, context-aware, and private transcription."
  },
  {
    question: "How does Amical work?",
    answer: "Amical combines advanced speech-to-text AI models, such as Whisper, with a context-aware approach to deliver accurate real-time transcriptions. By processing your voice input and analyzing the context of the application you're using through local desktop APIs, it generates precise transcriptions that are seamlessly integrated across various applications."
  },
  {
    question: "Is Amical free to use?",
    answer: (
      <>
        Yes, Amical is completely free and open-source. You can find the source code on{" "}
        <Link
          href="https://github.com/amicalhq/amical"
          target="_blank"
          rel="noopener noreferrer"
          className="text-indigo-500 hover:underline"
        >
          GitHub
        </Link>
        .
      </>
    )
  },
  {
    question: "How accurate is the transcription?",
    answer: "Amical uses state-of-the-art AI models to provide highly accurate transcriptions. The accuracy is enhanced by context awareness and continuous learning from user interactions."
  },
  {
    question: "Is my data private?",
    answer: (
      <>
        Yes, Amical is 100% open-source and you can build and use the app directly from our{" "}
        <Link
          href="https://github.com/amicalhq/amical"
          target="_blank"
          rel="noopener noreferrer"
          className="text-indigo-500 hover:underline"
        >
          source repo
        </Link>
        . You can bring your own keys/AI models, including support for local models.
      </>
    )
  }
];

export function GeneralFAQ() {
  return (
    <div className="w-full max-w-4xl mx-auto px-4 py-16">
      <h2 className="text-3xl font-bold text-center mb-8">Frequently Asked Questions</h2>
      <Accordion type="single" collapsible className="w-full">
        {faqItems.map((item, index) => (
          <AccordionItem key={index} value={`item-${index + 1}`}>
            <AccordionTrigger>{item.question}</AccordionTrigger>
            <AccordionContent className="text-gray-400">
              {item.answer}
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </div>
  );
}