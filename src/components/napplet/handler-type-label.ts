import type { HandlerType } from '@/services/explore/default-handlers';

export function handlerTypeLabel(type: HandlerType, t: (key: string, options?: Record<string, unknown>) => string) {
  const known: Record<string, string> = { profile: 'profile', 'view:0': 'profile', 'view:1': 'notes', 'view:30023': 'articles',
    view: 'content', edit: 'edit', compose: 'compose' };
  const name = Object.hasOwn(known, type.name) ? known[type.name] : undefined;
  const label = name ? t(`applications.handler_type_${name}`) : type.kind === 'intent'
    ? t('applications.handler_type_task', { name: type.name.slice('napplet:'.length).replace('/', ' / ') })
    : /^view:\d+$/.test(type.name) ? t('applications.handler_type_number', { number: type.name.slice(5) })
      : t('applications.handler_type_task', { name: type.name });
  return type.kind === 'action' && type.auxiliary ? t('applications.handler_type_auxiliary', { type: label }) : label;
}

