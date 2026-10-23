import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { useErrorToast } from '../use-error-toast';
import { useToastStore } from '@/stores/toast.store';

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

function Feedback({ error }: { error?: string }) {
  useErrorToast(error, 'detail');
  return null;
}

it('announces a failure once per transition and announces a failed retry again', () => {
  let renderer!: ReactTestRenderer;
  act(() => { renderer = create(<Feedback error="request_failed" />); });
  const id = useToastStore.getState().id;
  expect(useToastStore.getState()).toMatchObject({ message: 'request_failed', variant: 'error', target: 'detail' });
  act(() => { renderer.update(<Feedback error="request_failed" />); });
  expect(useToastStore.getState().id).toBe(id);
  act(() => { renderer.update(<Feedback />); });
  act(() => { renderer.update(<Feedback error="request_failed" />); });
  expect(useToastStore.getState().id).toBe(id + 1);
  act(() => renderer.unmount());
  useToastStore.getState().hide();
});
