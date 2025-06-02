"use client";
import React from "react";
import { WavyBackground } from "../ui/wavy-background";

export function Hero() {
  return (
      <WavyBackground
        className="max-w-6xl mx-auto pb-10"
        backgroundFill="#0A0A0A"
      >
        <h1 className="text-2xl md:text-4xl lg:text-6xl text-white font-bold inter-var text-center leading-tight -mt-20">
          Open Source AI Dictation App
        </h1>
        <h2 className="text-base md:text-lg mt-4 text-white font-normal inter-var text-center">
          Type 10x faster, no keyboard needed. Fast, Accurate, Context-aware and Private.
        </h2>
        <div className="flex justify-center">
          <a
            href="https://github.com/amicalhq/amical"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block mt-8 px-8 py-3 bg-white text-black font-semibold rounded-lg hover:bg-gray-100 transition-colors"
          >
            Get Started
          </a>
        </div>
      </WavyBackground>
  );
}
