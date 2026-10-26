import { nappletNip07Sandbox } from '@/lib/napp/nip07-sandbox.generated';

/** Browser source is generated before Hermes compiles the host application. */
export function nappletNip07Bridge(): string {
  return `${nappletNip07Sandbox}\nPsstNappletNip07.install();`;
}
