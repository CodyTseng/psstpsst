import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { SvgXml } from 'react-native-svg';

import { Avatar } from '../Avatar';

jest.mock('@/theme', () => ({
  useThemeColors: () => ({ surfaceMuted: '#101013' }),
}));

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
});
