import { router } from 'expo-router';
import { useEffect } from 'react';

import { AppScreen } from '@/components/common/AppScreen';

/** Leave a malformed external route after the current render has committed. */
export function InvalidRouteRedirect() {
  useEffect(() => {
    const timer = setTimeout(() => {
      if (router.canDismiss()) router.dismissAll();
      router.replace('/');
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  return <AppScreen edges={[]}>{null}</AppScreen>;
}
