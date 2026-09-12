import { platform } from '@/platform';
import { loadLicenseCatalog, loadProjectNotices, openProjectUrl, searchLicensedProjects, splitNoticeText } from '../licenses.service';

jest.mock('@/platform', () => ({ platform: {
  bundledNotices: { readText: jest.fn() },
  urlOpener: { openExternalUrl: jest.fn() },
} }));

it('opens generated scoped package IDs and searches without changing catalog order', async () => {
  const catalog = await loadLicenseCatalog();
  const project = catalog.projects.find((item) => item.name === '@noble/hashes')!;
  expect(catalog.byId.get(project.id)).toBe(project);
  expect(searchLicensedProjects(catalog, ' NOBLE   MIT ')).toContain(project);
  expect(searchLicensedProjects(catalog, '  ')).toBe(catalog.projects);
  expect(searchLicensedProjects(catalog, 'definitely nonexistent dependency')).toEqual([]);
});

it('preserves every character and Unicode pair while bounding native text layout', async () => {
  for (const text of ['Copyright\r\n\nLicensed text\n', 'x'.repeat(2999) + '🪴'.repeat(5000), 'A\n'.repeat(50_000)]) {
    const chunks = await splitNoticeText(text);
    expect(chunks.join('')).toBe(text);
    expect(chunks.every((chunk) => chunk.length <= 3000)).toBe(true);
    expect(chunks.every((chunk) => !/^[\uDC00-\uDFFF]/.test(chunk))).toBe(true);
  }
});

it('shares in-flight reads, caches settled text, and retries failures', async () => {
  const project = { id: 'test', name: 'Test', license: 'MIT', documents: [{ id: 'test-document', title: 'LICENSE' }] };
  jest.mocked(platform.bundledNotices.readText).mockRejectedValueOnce(new Error('Unavailable'));
  await expect(loadProjectNotices(project)).rejects.toThrow('Unavailable');
  jest.mocked(platform.bundledNotices.readText).mockResolvedValue('Original copyright and permission.');
  const [first, second] = await Promise.all([loadProjectNotices(project), loadProjectNotices(project)]);
  expect(first).toEqual(second);
  await loadProjectNotices(project);
  expect(platform.bundledNotices.readText).toHaveBeenCalledTimes(2);
});

it('rejects unsafe links before reaching the platform', async () => {
  await expect(openProjectUrl('file:///tmp/notice')).rejects.toThrow('Unsupported');
  expect(platform.urlOpener.openExternalUrl).not.toHaveBeenCalled();
  await openProjectUrl('https://github.com/example/project');
  expect(platform.urlOpener.openExternalUrl).toHaveBeenCalledWith('https://github.com/example/project');
});
