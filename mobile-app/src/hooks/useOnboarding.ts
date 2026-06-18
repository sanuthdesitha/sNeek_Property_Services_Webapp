import { useCallback, useEffect, useState } from "react";
import { getFlag, setFlag, STORAGE_KEYS } from "@/lib/storage";

export type OnboardingState = {
  /** Still resolving whether onboarding has run before. */
  checking: boolean;
  /** True until the first-launch walkthrough has been completed. */
  needsOnboarding: boolean;
  /** Mark the walkthrough complete (persists so it never shows again). */
  complete: () => Promise<void>;
};

/**
 * First-launch onboarding gate. The animated walkthrough shows once; after the
 * user finishes it we persist a flag so subsequent launches go straight to the
 * app.
 */
export function useOnboarding(): OnboardingState {
  const [checking, setChecking] = useState(true);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const done = await getFlag(STORAGE_KEYS.onboardingComplete);
      if (cancelled) return;
      setNeedsOnboarding(!done);
      setChecking(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const complete = useCallback(async () => {
    await setFlag(STORAGE_KEYS.onboardingComplete, true);
    setNeedsOnboarding(false);
  }, []);

  return { checking, needsOnboarding, complete };
}
