export function resolveAnalyticsServerConfig(env: { [key: string]: string | undefined }): {
  url: string;
  serviceRoleKey: string;
} | null {
  const url = env.SUPABASE_URL?.trim() || env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  return url && serviceRoleKey ? { url, serviceRoleKey } : null;
}
