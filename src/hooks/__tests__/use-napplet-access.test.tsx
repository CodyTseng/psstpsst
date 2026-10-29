import { useEffect } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { useNappletAccess } from '../use-napplet-access';
import { nappletService } from '@/services/napplet/service';
import type { NappletRelease } from '@/services/napplet/protocol';

jest.mock('@/stores/napplet.store', () => ({ useNappletPermissionRevision: () => 0 }));
jest.mock('@/services/napplet/service', () => ({ nappletService: { activateAccount: jest.fn(), domainPermissions: jest.fn() } }));
const release = { eventKey: 'app', hash: 'version', required: ['network'] } as NappletRelease;
let renderer: ReactTestRenderer;
let result: ReturnType<typeof useNappletAccess>;
function Probe({ app }: { app?: NappletRelease }) {
  const value = useNappletAccess(app, 'account');
  useEffect(() => { result = value; }, [value]);
  return null;
}
beforeEach(() => jest.resetAllMocks());
afterEach(() => act(() => renderer.unmount()));

it('does not initialize anything without an application permission view', async () => {
  await act(async () => { renderer = create(<Probe />); });
  expect(nappletService.activateAccount).not.toHaveBeenCalled();
  expect(nappletService.domainPermissions).not.toHaveBeenCalled();
});

it('prepares the account on demand before reading that application permissions', async () => {
  let ready!: () => void;
  jest.mocked(nappletService.activateAccount).mockImplementationOnce(() => new Promise(resolve => { ready = resolve; }));
  jest.mocked(nappletService.domainPermissions).mockResolvedValueOnce(['shell', 'network']);
  await act(async () => { renderer = create(<Probe app={release} />); });
  expect(nappletService.activateAccount).toHaveBeenCalledWith('account');
  expect(nappletService.domainPermissions).not.toHaveBeenCalled();
  await act(async () => { ready(); });
  expect(nappletService.domainPermissions).toHaveBeenCalledWith(release, 'account');
  expect(result).toMatchObject({ loaded: true, approved: true });
});


it('treats required identity as signer access instead of launch consent', async () => {
  jest.mocked(nappletService.activateAccount).mockResolvedValueOnce(undefined);
  jest.mocked(nappletService.domainPermissions).mockResolvedValueOnce(['shell']);
  await act(async () => { renderer = create(<Probe app={{ ...release, required: ['identity'] }} />); });
  expect(result).toMatchObject({ loaded: true, approved: true });
});
