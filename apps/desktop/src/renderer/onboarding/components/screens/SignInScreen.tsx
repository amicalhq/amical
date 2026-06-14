import { useEffect, useRef, useState } from "react";
import { api } from "@/trpc/react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { ExternalLink, Loader2, Check } from "lucide-react";
import { OnboardingLayout } from "../shared/OnboardingLayout";
import { NavigationButtons } from "../shared/NavigationButtons";
import { ObButton } from "../shared/ui";
import { useApplyOnboardingModel } from "../shared/useApplyOnboardingModel";
import { OnboardingScreen } from "../../../../types/onboarding";

interface SignInScreenProps {
  onNext: () => void;
  onBack: () => void;
}

/**
 * Cloud setup step: OAuth PKCE sign-in. A single "Sign in" button hands off to
 * the system browser (no in-app credential entry); when the auth subscription
 * reports authenticated, the footer Continue unlocks.
 */
export function SignInScreen({ onNext, onBack }: SignInScreenProps) {
  const { t } = useTranslation();
  const [authed, setAuthed] = useState(false);
  const [loading, setLoading] = useState(false);
  // Sign-in has been started at least once — keeps the waiting hint up after
  // the spinner times out, and gates the success toast.
  const [attempted, setAttempted] = useState(false);

  // The OAuth handoff lives in the browser and can be abandoned there, so the
  // spinner must not hold the button hostage: reset after 5s (same pattern as
  // the app's auth-button) and the re-enabled Sign in button is the retry.
  // Auth completing later still lands via the subscription below.
  const loadingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearLoadingTimeout = () => {
    if (loadingTimeoutRef.current) {
      clearTimeout(loadingTimeoutRef.current);
      loadingTimeoutRef.current = null;
    }
  };
  useEffect(() => clearLoadingTimeout, []);

  const loginMutation = api.auth.login.useMutation({
    onMutate: () => {
      setLoading(true);
      setAttempted(true);
      clearLoadingTimeout();
      loadingTimeoutRef.current = setTimeout(() => setLoading(false), 5000);
    },
    onSuccess: () => toast.info(t("onboarding.signIn.toast.loginInBrowser")),
    onError: (err) => {
      console.error("OAuth error:", err);
      toast.error(t("onboarding.signIn.error.loginStartFailed"));
      clearLoadingTimeout();
      setLoading(false);
    },
  });

  api.auth.onAuthStateChange.useSubscription(undefined, {
    onData: (authState) => {
      if (authState.isAuthenticated) {
        if (!authed && attempted) {
          toast.success(t("onboarding.signIn.toast.authenticated"));
        }
        clearLoadingTimeout();
        setAuthed(true);
        setLoading(false);
      }
    },
    onError: (err) => console.error("Auth state subscription error:", err),
  });

  // Cloud model is selected the moment auth lands, before the try-it segment.
  useApplyOnboardingModel(authed);

  return (
    <OnboardingLayout
      screen={OnboardingScreen.SignIn}
      title={t("onboarding.signIn.title")}
      subtitle={t("onboarding.signIn.subtitle")}
      footer={
        <NavigationButtons
          onBack={onBack}
          onNext={onNext}
          disableNext={!authed}
        />
      }
    >
      <div className="flex w-full max-w-[360px] animate-ob-rise flex-col items-start gap-[11px]">
        <ObButton
          className="w-full justify-center"
          disabled={loading || authed}
          onClick={() => loginMutation.mutate()}
        >
          {loading ? (
            <Loader2 className="animate-spin" size={16} />
          ) : (
            <ExternalLink size={16} />
          )}
          {t("onboarding.signIn.button")}
        </ObButton>
        <div className="mt-1 text-xs text-muted-foreground/80">
          {t("onboarding.signIn.fine")}
        </div>
        {authed ? (
          <div className="mt-1 flex items-center gap-2 text-[12.5px] font-medium text-emerald-600 dark:text-emerald-400">
            <Check size={14} />
            {t("onboarding.signIn.verdict")}
          </div>
        ) : (
          attempted && (
            <div className="mt-1 text-xs text-muted-foreground/80">
              {t("onboarding.signIn.waiting")}
            </div>
          )
        )}
      </div>
    </OnboardingLayout>
  );
}
