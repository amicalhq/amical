import React from "react";
import MicContext from "./mic-with-apps";

export function FeatureContext() {
  return (
    <section className="py-10 bg-[#0A0A0A]">
      <div className="container">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-8">
            <h2 className="text-3xl md:text-4xl font-bold text-white mb-6">
              Smart Context, Perfect Format, Incredible Accuracy
            </h2>
            <p className="text-lg text-gray-300 leading-relaxed max-w-3xl mx-auto">
              Amical understands the context of your applications, automatically formatting your dictation into the perfect format - whether it's a professional email in Gmail or a casual post on Instagram.
            </p>
          </div>

          <div className="flex justify-center">
            <MicContext isDarkMode={true} logoSize={40} radius={120} />
          </div>
        </div>
      </div>
    </section>
  );
}
