import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { ApplicationAccessControls } from '../ApplicationAccessControls';
import { AppText } from '@/components/common/AppText';
import { ListRow } from '@/components/common/ListRow';
import { Toggle } from '@/components/common/Toggle';
import { AppButton } from '@/components/common/AppButton';

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/hooks/use-error-toast', () => ({ useErrorToast: jest.fn() }));
jest.mock('@/components/common/AppText', () => ({ AppText: () => null }));
jest.mock('@/components/common/AppButton', () => ({ AppButton: () => null }));
jest.mock('@/components/common/ListRow', () => ({ ListRow: () => null }));
jest.mock('@/components/common/ListGroup', () => ({ ListGroup: ({ children }: { children: React.ReactNode }) => children }));
jest.mock('@/components/common/Toggle', () => ({ Toggle: () => null }));
jest.mock('@/theme', () => ({ spacing: { md: 12, xl: 24 }, useThemeColors: () => ({ accent: 'accent' }) }));

let renderer: ReactTestRenderer;
afterEach(() => { act(() => renderer.unmount()); });

it('shows required access immediately and distinguishes enabled and disabled optional access', () => {
  const onToggle = jest.fn();
  act(() => { renderer = create(<ApplicationAccessControls required={['shell', 'common']}
    optional={['network', 'appearance']} selected={['shell', 'common', 'network']} onToggle={onToggle} />); });
  const rows = renderer.root.findAllByType(ListRow);
  expect(rows.map(row => row.props.title)).toEqual([
    'applications.capability_relay', 'applications.capability_resource', 'applications.capability_appearance',
  ]);
  expect(rows[0].props.value).toBe('applications.capabilities_required');
  expect(rows[1].props.subtitle).toBe('applications.permissions_enabled');
  expect(rows[2].props.subtitle).toBe('applications.permissions_disabled');
  const toggle = rows[2].props.trailing;
  expect(toggle.type).toBe(Toggle);
  expect(toggle.props.accessibilityLabel).toBe('applications.capability_appearance');
  act(() => { toggle.props.onValueChange(true); });
  expect(onToggle).toHaveBeenCalledWith('appearance', true);
});

it('does not present unresolved optional access as disabled', () => {
  act(() => { renderer = create(<ApplicationAccessControls required={['network']} optional={['appearance']} />); });
  expect(renderer.root.findAllByType(ListRow)).toHaveLength(1);
  const text = renderer.root.findAllByType(AppText).map(node => node.props.children);
  expect(text).not.toContain('applications.permissions_disabled');
});

it('keeps draft state visible and requires saving before reloading', () => {
  const onSave = jest.fn();
  act(() => { renderer = create(<ApplicationAccessControls required={[]} optional={['appearance']}
    selected={['appearance']} changed onSave={onSave} />); });
  expect(onSave).not.toHaveBeenCalled();
  const save = renderer.root.findByType(AppButton);
  expect(save.props.label).toBe('applications.permissions_save');
  act(() => { save.props.onPress(); });
  expect(onSave).toHaveBeenCalledTimes(1);
});
