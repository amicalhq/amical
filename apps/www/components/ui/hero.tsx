"use client";
import React from "react";
import HeroCards from "./hero-cards";

export function Hero() {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-0 lg:gap-12 items-center">
        {/* Left side - Title and content */}
        <div className="space-y-6 lg:col-span-2 text-center lg:text-left">
          <h1 className="text-3xl md:text-4xl lg:text-5xl text-white font-bold inter-var leading-tight">
            Open Source <br /> AI Dictation App
          </h1>
          <h2 className="text-base md:text-lg text-neutral-300 font-normal inter-var leading-relaxed">
            Type 10x faster, no keyboard needed. Fast, Accurate, Context-aware and Private.
          </h2>
          <div className="pt-4">
            <a
              href="https://github.com/amicalhq/amical"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block px-8 py-3 bg-white text-black font-semibold rounded-lg hover:bg-gray-100 transition-colors"
            >
              Get Started
            </a>
          </div>
        </div>

        {/* Right side - Hero cards */}
        <div className="flex justify-center lg:col-span-3 order-2 lg:order-1">
          <HeroCards />
        </div>
      </div>
    </div>
  );
}
