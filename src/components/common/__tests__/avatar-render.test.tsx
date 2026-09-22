import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Image } from 'expo-image';
import { SvgXml } from 'react-native-svg';

import { Avatar } from '../Avatar';

jest.mock('@/theme', () => ({
  useThemeColors: () => ({ surfaceMuted: '#101013' }),
}));
jest.mock('expo-image', () => ({ Image: () => null }));

const pubkey = '9ea00010deb0a1435648363456102325234436292046333549453645243641452123';

describe('Avatar gradient references', () => {
  let renderer: ReactTestRenderer | undefined;

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
  });

  it('isolates repeated identities while preserving their artwork and stable references', () => {
    const avatars = (size: number) => (
      <>
        <Avatar pubkey={pubkey} size={44} />
        <Avatar pubkey={pubkey} size={size} />
      </>
    );
    act(() => {
      renderer = create(avatars(32));
    });

    const readXml = () => renderer!.root.findAllByType(SvgXml).map((node) => node.props.xml as string);
    const before = readXml();
    const ids = before.map((xml) => Array.from(xml.matchAll(/id="([^"]+)"/g), (match) => match[1]));
    expect(ids[0].length).toBeGreaterThan(0);
    expect(ids[1]).toHaveLength(ids[0].length);
    expect(ids[0].filter((id) => ids[1].includes(id))).toEqual([]);
    before.forEach((xml, index) => {
      const references = Array.from(xml.matchAll(/url\(#([^)]+)\)/g), (match) => match[1]);
      expect(references).toEqual(ids[index]);
    });
    const artwork = before.map((xml) => xml
      .replace(/id="[^"]+"/g, 'id="gradient"')
      .replace(/url\(#[^)]+\)/g, 'url(#gradient)'));
    expect(artwork[0]).toBe(artwork[1]);

    act(() => renderer!.update(avatars(96)));
    expect(readXml()).toEqual(before);
  });

  it('shows the gradient only after failure and retries when the same URL loads elsewhere', () => {
    const sharedUrl = 'https://example.com/avatar.png';
    const otherUrl = 'https://example.com/other.png';
    act(() => {
      renderer = create(
        <>
          <Avatar pubkey={pubkey} picture={sharedUrl} />
          <Avatar pubkey={pubkey} picture={sharedUrl} />
          <Avatar pubkey={pubkey} picture={otherUrl} />
        </>,
      );
    });

    expect(renderer!.root.findAllByType(SvgXml)).toHaveLength(0);
    const [failed, successful, unrelated] = renderer!.root.findAllByType(Image);
    act(() => { void failed.props.onError(); });
    expect(renderer!.root.findAllByType(SvgXml)).toHaveLength(1);
    act(() => { void successful.props.onLoad(); });

    const [retried, stillSuccessful, stillUnrelated] = renderer!.root.findAllByType(Image);
    expect(retried).not.toBe(failed);
    expect(stillSuccessful).toBe(successful);
    expect(stillUnrelated).toBe(unrelated);
    expect(retried.props.source).toEqual({ uri: sharedUrl });
    expect(renderer!.root.findAllByType(SvgXml)).toHaveLength(1);

    act(() => { void retried.props.onError(); });
    act(() => { void successful.props.onLoad(); });
    const secondRetry = renderer!.root.findAllByType(Image)[0];
    expect(secondRetry).not.toBe(retried);
    act(() => { void secondRetry.props.onError(); });
    act(() => { void successful.props.onLoad(); });
    expect(renderer!.root.findAllByType(Image)[0]).toBe(secondRetry);
    act(() => { void secondRetry.props.onLoad(); });
    expect(renderer!.root.findAllByType(SvgXml)).toHaveLength(0);
  });

  it('ignores a success for a previous picture URL', () => {
    const oldUrl = 'https://example.com/old.png';
    const newUrl = 'https://example.com/new.png';
    const avatars = (picture: string) => (
      <>
        <Avatar pubkey={pubkey} picture={picture} />
        <Avatar pubkey={pubkey} picture={oldUrl} />
      </>
    );
    act(() => { renderer = create(avatars(oldUrl)); });
    const [first, second] = renderer!.root.findAllByType(Image);
    act(() => { void first.props.onError(); });
    expect(renderer!.root.findAllByType(SvgXml)).toHaveLength(1);
    act(() => renderer!.update(avatars(newUrl)));
    expect(renderer!.root.findAllByType(SvgXml)).toHaveLength(0);
    const changed = renderer!.root.findAllByType(Image)[0];
    act(() => { void second.props.onLoad(); });
    expect(renderer!.root.findAllByType(Image)[0]).toBe(changed);
    expect(renderer!.root.findAllByType(SvgXml)).toHaveLength(0);
  });
});
