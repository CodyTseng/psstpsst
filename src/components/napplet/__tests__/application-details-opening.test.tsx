import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { ApplicationDetailsPage } from '../ApplicationDetailsPage';
import { ApplicationOpenSetting } from '../ApplicationOpenSetting';
import { applicationPresentation, type ExploreEntry } from '@/services/explore/model';

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/components/common/AppScreen', () => ({ AppScreen: 'Screen' }));
jest.mock('@/components/common/AppText', () => ({ AppText: 'Text' }));
jest.mock('@/components/common/AppButton', () => ({ AppButton: 'Button' }));
jest.mock('@/components/common/ScreenHeader', () => ({ ScreenHeader: 'Header', useScreenHeaderClearance: () => 56 }));
jest.mock('@/hooks/use-scrolled', () => ({ useScrolled: () => ({ scrolled: false, scrollProps: {} }) }));
jest.mock('../NappletInfo', () => ({ ApplicationInfo: 'Info' }));
jest.mock('../ApplicationComments', () => ({ ApplicationComments: 'Comments' }));
jest.mock('../ApplicationDetailsActions', () => ({ ApplicationDetailsActions: 'Actions' }));
jest.mock('../ApplicationOpenSetting', () => ({ ApplicationOpenSetting: 'OpeningPreference' }));
jest.mock('@/theme', () => ({ spacing: { lg: 16, xl: 24, sm: 8 }, useThemeColors: () => ({ accent: 'accent' }) }));

const entry: ExploreEntry = { key: 'https://example.com', address: 'https://example.com', title: 'Website',
  kind: 'website', description: '', required: [], servers: [], desktopPosition: null, lastUsedAt: null };

it.each([false, true])('places the webpage preference in the details body with discussion=%s', discussion => {
  let renderer!: ReactTestRenderer;
  act(() => { renderer = create(<ApplicationDetailsPage application={applicationPresentation(entry)}
    access={{ loaded: true, approved: true }} actions={{ entry, account: 'account' }}
    discussion={discussion ? { entry, account: 'account' } : undefined} onOpen={() => {}} onPublisher={() => {}} />); });
  const body = discussion ? renderer.root.findByType('Comments' as never).props.header : null;
  if (body) {
    let header!: ReactTestRenderer;
    act(() => { header = create(body); });
    expect(header.root.findByType(ApplicationOpenSetting).props).toEqual({ entry, account: 'account' });
    act(() => header.unmount());
  } else {
    expect(renderer.root.findByType(ApplicationOpenSetting).props).toEqual({ entry, account: 'account' });
  }
  act(() => renderer.unmount());
});
