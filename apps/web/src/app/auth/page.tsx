import { AuthForm, AuthProvidersStatus } from "@/components/auth-form";
import { AuthPageChrome } from "./auth-page-client";
import { getAuthProviderStatus } from "@/lib/auth/providers";

export default function AuthPage() {
  const status = getAuthProviderStatus();
  const googleConfigured = status.google.available;
  const emailConfigured = status.email.available;

  return (
    <AuthPageChrome>
      <AuthForm googleConfigured={googleConfigured} />
      <AuthProvidersStatus emailConfigured={emailConfigured} googleConfigured={googleConfigured} />
    </AuthPageChrome>
  );
}
