import { resolveDevelopmentRendererOrigin } from '../renderer-origin';

test.each(['http://localhost:8081', 'https://evil.example/', 'not-a-url', undefined])('packaged builds ignore renderer override %s', value => {
  expect(resolveDevelopmentRendererOrigin(true, value)).toBeNull();
});
test('unpackaged builds allow only a bare localhost HTTP origin', () => {
  expect(resolveDevelopmentRendererOrigin(false, 'http://localhost:8081')).toBe('http://localhost:8081');
  for (const value of ['https://evil.example', 'http://localhost:8081/path', 'http://user@localhost:8081']) {
    expect(() => resolveDevelopmentRendererOrigin(false, value)).toThrow();
  }
});
