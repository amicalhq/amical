import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Mic } from "lucide-react";
import { cn } from "@/lib/utils";
import "./license-card.css";

interface LicenseCardProps {
  cardHolderName: string;
  className?: string;
  floating?: boolean;
}

interface CardInteractionFrame {
  glareOpacity: number;
  pointerX: number;
  pointerY: number;
  rotateX: number;
  rotateY: number;
  shadowX: number;
  shadowY: number;
}

const NEUTRAL_INTERACTION: CardInteractionFrame = {
  glareOpacity: 0,
  pointerX: 50,
  pointerY: 50,
  rotateX: 0,
  rotateY: 0,
  shadowX: 0,
  shadowY: 0,
};

/**
 * Shared license card visual used in onboarding.
 * Can be shown as the main welcome card or as a persistent compact card.
 */
export function LicenseCard({
  cardHolderName,
  className,
  floating = true,
}: LicenseCardProps) {
  const interactiveRef = useRef<HTMLDivElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const isPointerInsideRef = useRef(false);
  const targetFrameRef = useRef<CardInteractionFrame>({ ...NEUTRAL_INTERACTION });
  const currentFrameRef = useRef<CardInteractionFrame>({
    ...NEUTRAL_INTERACTION,
  });
  const [isPointerActive, setIsPointerActive] = useState(false);
  const reducedMotion = useMemo(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    [],
  );

  const applyInteractionFrame = useCallback((frame: CardInteractionFrame) => {
    const target = interactiveRef.current;
    if (!target) return;

    const tiltMagnitude = Math.min(
      Math.hypot(frame.rotateX, frame.rotateY) / 13,
      1,
    );
    const anisoAngle = 104 + frame.rotateY * 2.2 - frame.rotateX * 1.1;
    const anisoShiftX = frame.rotateY * 1.55;
    const anisoShiftY = -frame.rotateX * 1.05;
    const anisoOpacity = 0.14 + tiltMagnitude * 0.12;
    const anisoHotAlpha = 0.055 + tiltMagnitude * 0.13;
    const anisoDarkAlpha = 0.045 + tiltMagnitude * 0.1;
    const anisoFineOpacity = 0.065 + tiltMagnitude * 0.075;
    const anisoFineLineAlpha = 0.021 + tiltMagnitude * 0.033;
    const anisoFineShiftX = anisoShiftX * 1.5;
    const anisoFineShiftY = anisoShiftY * 1.2;
    const normalizedRotateY = Math.max(-1, Math.min(1, frame.rotateY / 12.5));
    const normalizedRotateX = Math.max(-1, Math.min(1, frame.rotateX / 11.25));
    const fresnelBase = 0.04 + tiltMagnitude * 0.016;
    const fresnelBoost = 0.13 * tiltMagnitude;
    const fresnelLeftAlpha = fresnelBase + Math.max(0, normalizedRotateY) * fresnelBoost;
    const fresnelRightAlpha = fresnelBase + Math.max(0, -normalizedRotateY) * fresnelBoost;
    const fresnelTopAlpha = fresnelBase + Math.max(0, normalizedRotateX) * fresnelBoost;
    const fresnelBottomAlpha = 0.052 + Math.max(0, -normalizedRotateX) * fresnelBoost;
    const fresnelSoftAlpha = 0.038 + tiltMagnitude * 0.058;

    target.style.setProperty("--card-pointer-x", `${frame.pointerX.toFixed(2)}%`);
    target.style.setProperty("--card-pointer-y", `${frame.pointerY.toFixed(2)}%`);
    target.style.setProperty("--card-rotate-x", `${frame.rotateX.toFixed(2)}deg`);
    target.style.setProperty("--card-rotate-y", `${frame.rotateY.toFixed(2)}deg`);
    target.style.setProperty("--card-shadow-x", `${frame.shadowX.toFixed(2)}px`);
    target.style.setProperty("--card-shadow-y", `${frame.shadowY.toFixed(2)}px`);
    target.style.setProperty("--card-glare-opacity", frame.glareOpacity.toFixed(2));
    target.style.setProperty("--card-aniso-angle", `${anisoAngle.toFixed(2)}deg`);
    target.style.setProperty("--card-aniso-shift-x", `${anisoShiftX.toFixed(2)}px`);
    target.style.setProperty("--card-aniso-shift-y", `${anisoShiftY.toFixed(2)}px`);
    target.style.setProperty("--card-aniso-opacity", anisoOpacity.toFixed(3));
    target.style.setProperty("--card-aniso-hot-alpha", anisoHotAlpha.toFixed(3));
    target.style.setProperty("--card-aniso-dark-alpha", anisoDarkAlpha.toFixed(3));
    target.style.setProperty("--card-aniso-fine-opacity", anisoFineOpacity.toFixed(3));
    target.style.setProperty(
      "--card-aniso-fine-line-alpha",
      anisoFineLineAlpha.toFixed(3),
    );
    target.style.setProperty(
      "--card-aniso-fine-shift-x",
      `${anisoFineShiftX.toFixed(2)}px`,
    );
    target.style.setProperty(
      "--card-aniso-fine-shift-y",
      `${anisoFineShiftY.toFixed(2)}px`,
    );
    target.style.setProperty("--card-fresnel-left-alpha", fresnelLeftAlpha.toFixed(3));
    target.style.setProperty("--card-fresnel-right-alpha", fresnelRightAlpha.toFixed(3));
    target.style.setProperty("--card-fresnel-top-alpha", fresnelTopAlpha.toFixed(3));
    target.style.setProperty(
      "--card-fresnel-bottom-alpha",
      fresnelBottomAlpha.toFixed(3),
    );
    target.style.setProperty("--card-fresnel-soft-alpha", fresnelSoftAlpha.toFixed(3));
  }, []);

  const stopInterpolation = useCallback(() => {
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
  }, []);

  const runInterpolation = useCallback(() => {
    const current = currentFrameRef.current;
    const target = targetFrameRef.current;
    const easing = isPointerInsideRef.current ? 0.22 : 0.14;

    current.pointerX += (target.pointerX - current.pointerX) * easing;
    current.pointerY += (target.pointerY - current.pointerY) * easing;
    current.rotateX += (target.rotateX - current.rotateX) * easing;
    current.rotateY += (target.rotateY - current.rotateY) * easing;
    current.shadowX += (target.shadowX - current.shadowX) * easing;
    current.shadowY += (target.shadowY - current.shadowY) * easing;
    current.glareOpacity += (target.glareOpacity - current.glareOpacity) * easing;

    applyInteractionFrame(current);

    const maxRemainingDelta = Math.max(
      Math.abs(target.pointerX - current.pointerX),
      Math.abs(target.pointerY - current.pointerY),
      Math.abs(target.rotateX - current.rotateX),
      Math.abs(target.rotateY - current.rotateY),
      Math.abs(target.shadowX - current.shadowX),
      Math.abs(target.shadowY - current.shadowY),
      Math.abs(target.glareOpacity - current.glareOpacity),
    );

    if (maxRemainingDelta > 0.03 || isPointerInsideRef.current) {
      animationFrameRef.current = window.requestAnimationFrame(runInterpolation);
      return;
    }

    animationFrameRef.current = null;
  }, [applyInteractionFrame]);

  const ensureInterpolation = useCallback(() => {
    if (animationFrameRef.current === null) {
      animationFrameRef.current = window.requestAnimationFrame(runInterpolation);
    }
  }, [runInterpolation]);

  useEffect(() => {
    return () => {
      stopInterpolation();
    };
  }, [stopInterpolation]);

  const updateInteraction = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const target = interactiveRef.current;
      if (!target) return;

      const rect = target.getBoundingClientRect();
      if (!rect.width || !rect.height) return;

      const pointerX = Math.min(Math.max(event.clientX - rect.left, 0), rect.width);
      const pointerY = Math.min(Math.max(event.clientY - rect.top, 0), rect.height);
      const normalizedX = pointerX / rect.width;
      const normalizedY = pointerY / rect.height;

      const tiltStrength = 12.5;
      const rotateY = (normalizedX - 0.5) * tiltStrength;
      const rotateX = (0.5 - normalizedY) * tiltStrength * 0.9;
      const shadowX = (0.5 - normalizedX) * 22;
      const shadowY = (0.5 - normalizedY) * 14;

      targetFrameRef.current = {
        glareOpacity: 0.38,
        pointerX: normalizedX * 100,
        pointerY: normalizedY * 100,
        rotateX,
        rotateY,
        shadowX,
        shadowY,
      };

      ensureInterpolation();
    },
    [ensureInterpolation],
  );

  const shouldSkipInteraction = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) =>
      reducedMotion || event.pointerType !== "mouse",
    [reducedMotion],
  );

  const handlePointerEnter = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (shouldSkipInteraction(event)) return;

      isPointerInsideRef.current = true;
      setIsPointerActive(true);
      updateInteraction(event);
    },
    [shouldSkipInteraction, updateInteraction],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (shouldSkipInteraction(event)) return;
      if (!isPointerInsideRef.current) return;

      updateInteraction(event);
    },
    [shouldSkipInteraction, updateInteraction],
  );

  const handlePointerLeave = useCallback(() => {
    isPointerInsideRef.current = false;
    setIsPointerActive(false);
    const current = currentFrameRef.current;
    targetFrameRef.current = {
      ...current,
      glareOpacity: 0,
      rotateX: 0,
      rotateY: 0,
      shadowX: 0,
      shadowY: 0,
    };
    ensureInterpolation();
  }, [ensureInterpolation]);

  return (
    <div
      ref={interactiveRef}
      className={cn(
        "license-card-interactive relative w-full self-center max-w-[560px]",
        className,
      )}
      data-active={isPointerActive ? "true" : "false"}
      onPointerEnter={handlePointerEnter}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
    >
      <div className="pointer-events-none absolute inset-x-14 top-1/2 h-44 -translate-y-1/2 rounded-full bg-white/18 blur-3xl dark:bg-white/10" />
      <div
        aria-hidden="true"
        className="license-card-ground-shadow pointer-events-none absolute left-[8%] right-[8%] top-[72%] h-[14%]"
      />
      <div className={cn("relative", floating && "welcome-card-float")}>
        <div className="license-card-tilt">
          <div className="license-card-surface relative aspect-[16/10] overflow-hidden rounded-[30px] border border-border/70 shadow-[0_18px_72px_rgba(5,12,24,0.38)]">
            <img
              src="assets/onboarding/license-card-base.svg"
              alt="Grizzo license card"
              className="absolute inset-0 h-full w-full object-cover"
            />
            <img
              src="assets/onboarding/security-pattern.svg"
              alt=""
              aria-hidden="true"
              className="absolute inset-0 h-full w-full object-cover opacity-14 mix-blend-screen grayscale"
            />
            <img
              src="assets/onboarding/grain-noise.png"
              alt=""
              aria-hidden="true"
              className="license-card-noise-low absolute inset-0 h-full w-full object-cover"
            />
            <img
              src="assets/onboarding/grain-noise.png"
              alt=""
              aria-hidden="true"
              className="license-card-noise-high absolute inset-0 h-full w-full object-cover"
            />
            <div
              aria-hidden="true"
              className="license-card-roughness-map pointer-events-none absolute inset-0"
            />
            <div
              aria-hidden="true"
              className="license-card-brush pointer-events-none absolute inset-0"
            />
            <div
              aria-hidden="true"
              className="license-card-aniso pointer-events-none absolute inset-0"
            />
            <div
              aria-hidden="true"
              className="license-card-aniso-fine pointer-events-none absolute inset-0"
            />
            <div
              aria-hidden="true"
              className="welcome-metal-sheen pointer-events-none absolute inset-y-0 left-0 w-[56%]"
            />
            <div className="absolute inset-0 bg-gradient-to-br from-white/10 via-transparent to-black/20" />
            <div
              aria-hidden="true"
              className="license-card-glare pointer-events-none absolute inset-0 z-30"
            />

            <div className="relative z-10 flex h-full flex-col justify-between p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span
                      aria-hidden="true"
                      className="inline-block h-0 w-0 border-y-[3px] border-y-transparent border-r-[9px] border-r-slate-200/80"
                    />
                    <p className="text-[11px] font-semibold tracking-[0.32em] text-slate-200/80">
                      LICENSE CARD
                    </p>
                  </div>
                </div>
                <div
                  aria-hidden="true"
                  className="flex items-center gap-1.5 text-slate-50/92"
                >
                  <Mic className="h-4 w-4" strokeWidth={2.2} />
                  <span className="text-[10px] font-bold italic tracking-[0.14em]">
                    VOICE
                  </span>
                </div>
              </div>

              <div className="space-y-3">
                <div className="text-center">
                  <p className="text-[10px] tracking-[0.28em] text-slate-200/72">
                    CARD HOLDER
                  </p>
                  <p className="mt-1 text-3xl font-semibold tracking-[0.08em] text-slate-50">
                    {cardHolderName}
                  </p>
                </div>
              </div>

              <div className="flex justify-end">
                <img
                  src="assets/onboarding/metal-logo.svg"
                  alt=""
                  aria-hidden="true"
                  className="mb-0.5 h-9 w-[145px] shrink-0 object-contain opacity-90"
                />
              </div>
            </div>
            <div
              aria-hidden="true"
              className="license-card-clearcoat pointer-events-none absolute inset-0 z-20"
            />
            <div
              aria-hidden="true"
              className="license-card-bevel pointer-events-none absolute inset-0 z-40"
            />
            <div
              aria-hidden="true"
              className="license-card-fresnel pointer-events-none absolute inset-0 z-50"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
