/** Route operating-system share intents into the shared `/forward` picker. */
export async function redirectSystemPath({
  path,
}: {
  path: string;
  initial: boolean;
}): Promise<string> {
  try {
    if (new URL(path).hostname === 'expo-sharing') {
      return '/forward?kind=external';
    }
    return path;
  } catch {
    return '/';
  }
}
