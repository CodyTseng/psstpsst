import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { ActionRow } from '@/components/common/ActionRow';
import { SigningDecisions } from '../SigningDecisions';

jest.mock('react-i18next', () => ({ useTranslation: () => ({
  t: (key: string, values?: { seconds: number }) => values ? `Reject(${values.seconds})` : key,
}) }));
jest.mock('@/stores/theme.store', () => ({
  useThemeStore: (select: (state: object) => unknown) => select({ accent: 'blue', preference: 'light' }),
}));
let renderer: ReactTestRenderer;
beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(100000); });
afterEach(() => { act(() => renderer?.unmount()); jest.useRealTimers(); });
const label = () => renderer.root.findByType(ActionRow);

it('keeps decisions available without a countdown or timers after a long review', () => {
  const approve = jest.fn(), reject = jest.fn();
  act(() => { renderer = create(<SigningDecisions onApprove={approve} onReject={reject} />); });
  expect(label().props.dismiss.label).toBe('applications.signing_reject');
  act(() => { jest.advanceTimersByTime(60 * 60000); });
  expect(label().props.dismiss.label).toBe('applications.signing_reject');
  expect(jest.getTimerCount()).toBe(0);
  act(() => { label().props.confirm.onPress(); });
  expect(approve).toHaveBeenCalledTimes(1);
  expect(reject).not.toHaveBeenCalled();
});

it('routes rejection to the currently displayed request after it changes', () => {
  const obsolete = jest.fn(), current = jest.fn();
  act(() => { renderer = create(<SigningDecisions key="first" onApprove={jest.fn()} onReject={obsolete} />); });
  act(() => { renderer.update(<SigningDecisions key="next" onApprove={jest.fn()} onReject={current} />); });
  act(() => { label().props.dismiss.onPress(); });
  expect(current).toHaveBeenCalledTimes(1);
  expect(obsolete).not.toHaveBeenCalled();
});
