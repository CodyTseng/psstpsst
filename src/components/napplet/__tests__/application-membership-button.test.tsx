import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { AppButton } from '@/components/common/AppButton';
import { ApplicationMembershipButton } from '../ApplicationMembershipButton';

jest.mock('@/components/common/AppButton', () => ({ AppButton: 'Button' }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('lucide-react-native/icons/plus', () => () => null);
jest.mock('lucide-react-native/icons/trash-2', () => () => null);
let mockScheme: 'light' | 'dark' = 'light';
jest.mock('@/stores/theme.store', () => ({ useThemeStore: (select: (state: object) => unknown) => select({ accent: 'blue', preference: mockScheme }) }));

let renderer: ReactTestRenderer;
afterEach(() => act(() => renderer?.unmount()));

it.each(['light', 'dark'] as const)('adds once and stops list navigation while saving in %s mode', async scheme => {
  mockScheme = scheme;
  let finish!: () => void;
  const onChange = jest.fn(() => new Promise<void>(resolve => { finish = resolve; }));
  act(() => { renderer = create(<ApplicationMembershipButton added={false} onChange={onChange} />); });
  const event = { stopPropagation: jest.fn() };
  let first!: Promise<void>;
  act(() => { first = renderer.root.findByType(AppButton).props.onPress(event); });
  expect(event.stopPropagation).toHaveBeenCalledTimes(1);
  expect(renderer.root.findByType(AppButton).props).toMatchObject({ loading: true, disabled: true });
  await act(async () => { await renderer.root.findByType(AppButton).props.onPress(event); });
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(onChange).toHaveBeenCalledWith(true);
  await act(async () => { finish(); await first; });
  act(() => { renderer.update(<ApplicationMembershipButton added onChange={onChange} />); });
  expect(renderer.root.findByType(AppButton).props).toMatchObject({ label: 'applications.remove_app', variant: 'danger', disabled: false, loading: false });
  let removal!: Promise<void>;
  act(() => { removal = renderer.root.findByType(AppButton).props.onPress(event); });
  expect(onChange).toHaveBeenLastCalledWith(false);
  await act(async () => { finish(); await removal; });
  expect(onChange).toHaveBeenCalledTimes(2);
});

it('disables membership actions until the account snapshot resolves', async () => {
  const onChange = jest.fn();
  act(() => { renderer = create(<ApplicationMembershipButton added={undefined} onChange={onChange} />); });
  const button = renderer.root.findByType(AppButton);
  expect(button.props).toMatchObject({ label: 'applications.my_apps', disabled: true, loading: true });
  await act(async () => { await button.props.onPress({ stopPropagation: jest.fn() }); });
  expect(onChange).not.toHaveBeenCalled();
});
