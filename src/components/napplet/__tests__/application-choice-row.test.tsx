import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { ApplicationChoiceRow } from '../ApplicationChoiceRow';
import { ApplicationListRow } from '../ApplicationListRow';
import { nappletService } from '@/services/napplet/service';

jest.mock('../ApplicationListRow', () => ({ ApplicationListRow: 'ApplicationRow' }));
jest.mock('@/services/napplet/service', () => ({ nappletService: { answer: jest.fn() } }));

it.each([false, true])('answers with an explicit remember=%s choice', remember => {
  let renderer!: ReactTestRenderer;
  act(() => { renderer = create(<ApplicationChoiceRow requestId="request" choice={{ key: 'source:target', title: 'Target' }} remember={remember} />); });
  act(() => { renderer.root.findByType(ApplicationListRow).props.onPress(); });
  expect(nappletService.answer).toHaveBeenLastCalledWith('request', remember ? 'default:source:target' : 'source:target');
  act(() => renderer.unmount());
});
