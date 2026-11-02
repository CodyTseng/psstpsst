import { IS_ELECTRON } from '@/lib/platform';
import { platform } from '@/platform';
import { AppUpdateWindowScreen } from '@/components/common/AppUpdateWindow';

export default function AppUpdateWindowRoute() {
  return IS_ELECTRON && platform.appUpdate.isHost ? <AppUpdateWindowScreen /> : null;
}
