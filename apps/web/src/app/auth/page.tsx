import { AuthForm, AuthProvidersStatus } from "@/components/auth-form";
import { AuthPageChrome } from "./auth-page-client";
import { getAuthProviderStatus } from "@/lib/auth/providers";

export default async function AuthPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const status = getAuthProviderStatus();
  const googleConfigured = status.google.available;
  const emailConfigured = status.email.available;
  const params = await searchParams;
  const initialError = typeof params.error === "string" ? params.error : null;

  return (
    <AuthPageChrome>
      <AuthForm googleConfigured={googleConfigured} initialError={initialError} />
      <AuthProvidersStatus emailConfigured={emailConfigured} googleConfigured={googleConfigured} />
    </AuthPageChrome>
  );
}
