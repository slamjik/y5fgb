export function buildApiURL(apiBaseUrl: string, apiPrefix: string, path: string): string {
  const cleanedPath = path.startsWith("/") ? path.slice(1) : path;
  const cleanedPrefix = apiPrefix.endsWith("/") ? apiPrefix.slice(0, -1) : apiPrefix;
  return new URL(`${cleanedPrefix}/${cleanedPath}`, `${apiBaseUrl}/`).toString();
}
