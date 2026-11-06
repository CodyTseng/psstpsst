import { memo, useCallback, useMemo } from 'react';
import type { RuntimePromptChoice } from '@/services/napplet/runtime';
import { nappletService } from '@/services/napplet/service';
import { ApplicationListRow } from './ApplicationListRow';

export const ApplicationChoiceRow = memo(function ApplicationChoiceRow({ choice, requestId, remember = false }: {
  choice: RuntimePromptChoice; requestId: string; remember?: boolean;
}) {
  const application = useMemo(() => choice.application ?? { title: choice.title, kind: 'napp' as const, servers: [] }, [choice]);
  const open = useCallback(() => nappletService.answer(requestId, remember ? `default:${choice.key}` : choice.key), [requestId, choice.key, remember]);
  return <ApplicationListRow application={application} onPress={open}/>;
});
