import { getGoogleProviderStatus } from "@/lib/auth/google";

export function getAuthProviderStatus() {
  const google = getGoogleProviderStatus();
  return {
    email: { available: true },
    google: {
      available: google.available,
      reason: google.reason,
    },
  };
}
