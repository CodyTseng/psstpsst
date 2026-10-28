import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { ApplicationRecentRow } from '../ApplicationRecentRow';
import { websiteEntry, type ExploreEntry, type GridApp } from '@/services/explore/model';
import { updateApplicationMetadata } from '@/services/explore/application-event';

const mockRender = jest.fn((_props: { app: GridApp }) => null);
jest.mock('../ApplicationContextRow', () => ({ ApplicationContextRow: (props: { app: GridApp }) => mockRender(props) }));
const actions = { onAdd: jest.fn(), onUnfavorite: jest.fn(), onRemove: jest.fn(), onDetails: jest.fn(), onPermissions: jest.fn(), onShare: jest.fn() };
function Rows({ entries }: { entries: ExploreEntry[] }) {
  return <>{entries.map((app, index) => <ApplicationRecentRow key={app.key} app={app} desktopPosition={index % 2 ? null : index}
    testID={app.key} {...actions} />)}</>;
}

it('renders only the changed history item, including when favorite positions are projected', () => {
  const entries = Array.from({ length: 100 }, (_, index) => websiteEntry(`https://app-${index}.example/`));
  let renderer!: ReactTestRenderer;
  act(() => { renderer = create(<Rows entries={entries} />); });
  expect(mockRender).toHaveBeenCalledTimes(100);
  mockRender.mockClear();
  const updated = updateApplicationMetadata(entries, { ...entries[73], description: 'Changed description' });
  act(() => { renderer.update(<Rows entries={updated} />); });
  expect(mockRender).toHaveBeenCalledTimes(1);
  expect(mockRender.mock.calls[0][0].app.key).toBe(entries[73].key);
  act(() => renderer.unmount());
});
