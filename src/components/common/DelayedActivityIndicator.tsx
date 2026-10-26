import { useEffect, useState } from 'react';
import { ActivityIndicator, type ActivityIndicatorProps } from 'react-native';

/** Quick local reads finish without flashing a loading indicator. */
export function DelayedActivityIndicator(props: ActivityIndicatorProps) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), 150);
    return () => clearTimeout(timer);
  }, []);
  return visible ? <ActivityIndicator {...props} /> : null;
}
