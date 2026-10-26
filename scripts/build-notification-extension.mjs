import { build } from 'esbuild';
import { readFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export async function buildNotificationExtension(output = resolve(root, 'ios-notification-extension/processor.js')) {
  await mkdir(dirname(output), { recursive: true });
  const result = await build({
    absWorkingDir: root,
    entryPoints: ['src/platform/notification-extension/entry.ts'],
    outfile: output,
    bundle: true,
    format: 'iife',
    globalName: 'PsstPsstNotification',
    platform: 'browser',
    target: 'safari16.4',
    minify: true,
    metafile: true,
    define: {
      'process.env.NODE_ENV': '"production"',
      'process.env.EXPO_PUBLIC_APP_ENV': JSON.stringify(process.env.EXPO_PUBLIC_APP_ENV ?? 'production'),
    },
    plugins: [{
      name: 'independent-notification-runtime',
      setup(builder) {
        builder.onResolve({ filter: /(^@\/i18n$|^@\/lib\/platform$|^\.\/registry$)/ }, ({ path, importer }) => {
          if (path === '@/i18n') return { path: resolve(root, 'src/i18n/core.ts') };
          if (path === '@/lib/platform') return { path: resolve(root, 'src/platform/notification-extension/platform-identity.ts') };
          if (['src/platform/index.ts', 'src/platform/vault-access.ts'].some(file => importer === resolve(root, file))) {
            return { path: resolve(root, 'src/platform/notification-extension/registry.ts') };
          }
        });
        builder.onLoad({ filter: /src\/i18n\/[^/]+\.json$/ }, async ({ path }) => {
          const catalog = JSON.parse(await readFile(path, 'utf8'));
          return { loader: 'json', contents: JSON.stringify({
            notifications: catalog.notifications,
            group: catalog.group,
            conversations: Object.fromEntries(Object.entries(catalog.conversations).filter(([key]) => key.startsWith('attachment_'))),
          }) };
        });
        builder.onResolve({ filter: /^(react($|\/)|react-native($|-|\/)|react-i18next$|expo($|-|\/)|@expo\/)/ }, ({ path }) => {
          throw new Error(`Notification processing must not import an app runtime: ${path}`);
        });
      },
    }],
  });
  return result.metafile;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const metadata = await buildNotificationExtension(process.argv[2]);
  console.info(`Notification processor: ${Object.keys(metadata.inputs).length} modules`);
}
