import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Image } from 'expo-image';
import { Platform } from 'react-native';
import { SvgXml } from 'react-native-svg';

import { Avatar } from '../Avatar';

jest.mock('@/theme', () => ({
  useThemeColors: () => ({ surfaceMuted: '#101013' }),
}));
jest.mock('expo-image', () => ({ Image: () => null }));

const pubkey = '9ea00010deb0a1435648363456102325234436292046333549453645243641452123';

describe('Avatar gradient references', () => {
  let renderer: ReactTestRenderer | undefined;
  const originalPlatform = Platform.OS;

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
    Object.defineProperty(Platform, 'OS', {
      configurable: true,
      value: originalPlatform,
    });
  });

  const gradientImages = () => renderer!.root.findAllByType(Image).filter(
    (node) => node.props.source?.uri?.startsWith('data:image/svg+xml,'),
  );
  const gradientSvgs = () => renderer!.root.findAllByType(SvgXml);

  it('renders native circular SVG layers with isolated gradient references', () => {
    const avatars = (size: number) => (
      <>
        <Avatar pubkey={pubkey} size={44} />
        <Avatar pubkey={pubkey} size={size} />
      </>
    );
    act(() => {
      renderer = create(avatars(32));
    });

    const before = gradientSvgs().map((node) => node.props.xml as string);
    expect(before).toHaveLength(2);
    before.forEach((xml) => {
      expect(xml).toContain('<radialGradient');
      expect(xml).toContain('<circle');
      expect(xml).not.toContain('<rect');
    });
    const ids = before.map((xml) => Array.from(
      xml.matchAll(/id="([^"]+)"/g),
      (match) => match[1],
    ));
    expect(ids[0].filter((id) => ids[1].includes(id))).toEqual([]);
    before.forEach((xml, index) => {
      const references = Array.from(
        xml.matchAll(/url\(#([^)]+)\)/g),
        (match) => match[1],
      );
      expect(references).toEqual(ids[index]);
    });

    act(() => renderer!.update(avatars(96)));
    expect(gradientSvgs().map((node) => node.props.xml)).toEqual(before);
    expect(gradientSvgs()[1].props.width).toBe(96);
  });

  it('renders rectangular SVG data images on web', () => {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'web' });
    act(() => {
      renderer = create(<Avatar pubkey={pubkey} size={44} />);
    });

    expect(gradientSvgs()).toHaveLength(0);
    const gradient = gradientImages()[0];
    const uri = gradient.props.source.uri as string;
    const xml = decodeURIComponent(uri.slice('data:image/svg+xml,'.length));
    expect(xml).toContain('<radialGradient');
    expect(xml).toContain('<rect');
    expect(xml).not.toContain('<circle');
    expect(gradient.props.style).toMatchObject({ borderRadius: 22 });
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

    expect(gradientSvgs()).toHaveLength(0);
    const [failed, successful, unrelated] = renderer!.root.findAllByType(Image);
    expect(successful.props.style).toMatchObject({ borderRadius: 22 });
    act(() => { void failed.props.onError(); });
    expect(gradientSvgs()).toHaveLength(1);
    act(() => { void successful.props.onLoad(); });

    const [retried, stillSuccessful, stillUnrelated] = renderer!.root.findAllByType(Image);
    expect(retried).not.toBe(failed);
    expect(stillSuccessful).toBe(successful);
    expect(stillUnrelated).toBe(unrelated);
    expect(retried.props.source).toEqual({ uri: sharedUrl });
    expect(gradientSvgs()).toHaveLength(0);

    act(() => { void retried.props.onError(); });
    act(() => { void successful.props.onLoad(); });
    const secondRetry = renderer!.root.findAllByType(Image)[0];
    expect(secondRetry).not.toBe(retried);
    act(() => { void secondRetry.props.onError(); });
    const finalGradient = gradientSvgs()[0];
    act(() => { void successful.props.onLoad(); });
    expect(gradientSvgs()[0]).toBe(finalGradient);
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
    expect(gradientSvgs()).toHaveLength(1);
    act(() => renderer!.update(avatars(newUrl)));
    expect(gradientSvgs()).toHaveLength(0);
    const changed = renderer!.root.findAllByType(Image)[0];
    act(() => { void second.props.onLoad(); });
    expect(renderer!.root.findAllByType(Image)[0]).toBe(changed);
    expect(gradientSvgs()).toHaveLength(0);
  });
});
