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

it('uses the displayed review deadline and corrects elapsed time after suspension', () => {
  act(() => { renderer = create(<SigningDecisions onApprove={jest.fn()} onReject={jest.fn()} expiresAt={108000} />); });
  expect(label().props.dismiss.label).toBe('Reject(8)');
  act(() => { jest.setSystemTime(102000); jest.advanceTimersByTime(1000); });
  expect(label().props.dismiss.label).toBe('Reject(5)');
  act(() => { jest.advanceTimersByTime(5000); });
  expect(label().props.dismiss.label).toBe('Reject(0)');
  expect(jest.getTimerCount()).toBe(0);
});

it('starts from the next request deadline and clears the previous timer', () => {
  act(() => { renderer = create(<SigningDecisions key="first" onApprove={jest.fn()} onReject={jest.fn()} expiresAt={125000} />); });
  act(() => { jest.advanceTimersByTime(2000); });
  expect(label().props.dismiss.label).toBe('Reject(23)');
  act(() => { renderer.update(<SigningDecisions key="next" onApprove={jest.fn()} onReject={jest.fn()} expiresAt={106000} />); });
  expect(label().props.dismiss.label).toBe('Reject(4)');
  expect(jest.getTimerCount()).toBe(1);
  act(() => { renderer.unmount(); });
  expect(jest.getTimerCount()).toBe(0);
});

it('clamps already expired requests without starting a timer', () => {
  act(() => { renderer = create(<SigningDecisions onApprove={jest.fn()} onReject={jest.fn()} expiresAt={99000} />); });
  expect(label().props.dismiss.label).toBe('Reject(0)');
  expect(jest.getTimerCount()).toBe(0);
});
