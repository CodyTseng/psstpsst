import { memo, useCallback, useMemo } from 'react';
import type { RuntimePromptChoice } from '@/services/napplet/runtime';
import { nappletService } from '@/services/napplet/service';
import { ApplicationListRow } from './ApplicationListRow';

export const ApplicationChoiceRow = memo(function ApplicationChoiceRow({ choice, requestId }: {
  choice: RuntimePromptChoice; requestId: string;
}) {
  const application = useMemo(() => choice.application ?? { title: choice.title, kind: 'napp' as const, servers: [] }, [choice]);
  const open = useCallback(() => nappletService.answer(requestId, choice.key), [requestId, choice.key]);
  return <ApplicationListRow application={application} onPress={open}/>;
});
