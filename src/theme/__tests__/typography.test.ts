import {
  desktopFontWeight,
  desktopTypography,
  mobileFontWeight,
  mobileTypography,
} from '../typography';

describe('typography', () => {
  it('keeps the existing mobile scale unchanged', () => {
    expect(mobileTypography.subtitle).toMatchObject({ fontSize: 17, lineHeight: 24 });
    expect(mobileTypography.body).toMatchObject({ fontSize: 15, lineHeight: 22 });
    expect(mobileFontWeight.semibold).toBe('600');
  });

  it('uses a denser, quieter desktop scale', () => {
    expect(desktopTypography.subtitle).toMatchObject({ fontSize: 15, lineHeight: 21 });
    expect(desktopTypography.body).toMatchObject({ fontSize: 14, lineHeight: 20 });
    expect(desktopTypography.subtitle.fontFamily).toContain('PingFang SC');
    expect(desktopFontWeight.semibold).toBe('500');
  });
});
