import { useEffect, useRef, useState } from "react";
import { api } from "@/trpc/react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { ExternalLink, Loader2, Check, Mail } from "lucide-react";
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
  const [email, setEmail] = useState<string | null>(null);
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

  const logoutMutation = api.auth.logout.useMutation();

  api.auth.onAuthStateChange.useSubscription(undefined, {
    onData: (authState) => {
      if (authState.isAuthenticated) {
        if (!authed && attempted) {
          toast.success(t("onboarding.signIn.toast.authenticated"));
        }
        clearLoadingTimeout();
        setAuthed(true);
        setEmail(authState.userEmail ?? null);
        setLoading(false);
      } else {
        // Signed out (e.g. via "use a different account") or never signed in.
        setAuthed(false);
        setEmail(null);
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
        {authed ? (
          <>
            <div className="flex w-full items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-500">
                <Mail size={18} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold">
                  {t("onboarding.signIn.verdict")}
                </div>
                {email && (
                  <div className="truncate text-[13px] text-muted-foreground">
                    {email}
                  </div>
                )}
              </div>
              <Check
                size={17}
                className="shrink-0 text-emerald-600 dark:text-emerald-400"
              />
            </div>
            <button
              type="button"
              onClick={() => logoutMutation.mutate()}
              className="self-start py-1 text-[13px] font-semibold text-muted-foreground transition-colors hover:text-foreground"
            >
              {t("onboarding.signIn.switchAccount")}
            </button>
          </>
        ) : (
          <>
            <ObButton
              className="w-full justify-center"
              disabled={loading}
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
            {attempted && (
              <div className="mt-1 text-xs text-muted-foreground/80">
                {t("onboarding.signIn.waiting")}
              </div>
            )}
          </>
        )}
      </div>
    </OnboardingLayout>
  );
}
