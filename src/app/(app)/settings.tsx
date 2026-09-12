import { Redirect } from 'expo-router';

/** Preserve old deep links after Settings moved into the Me tab. */
export default function SettingsRedirect() {
  return <Redirect href="/me" />;
}
