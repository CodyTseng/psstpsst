import { readFileSync } from 'node:fs';

const report = readFileSync(process.argv[2], 'utf8');
const forbidden = report.split('\n').filter((line) =>
  /(?:com\.google\.firebase:firebase-(?:messaging|iid)(?=:|-)|com\.google\.mlkit:|com\.google\.android\.gms:play-services-(?:cloud-messaging|code-scanner|mlkit-[^:]+):|androidx\.camera:camera-mlkit-vision:|project :expo-notifications\b|host\.exp\.exponent:expo\.modules\.notifications:|\bFAILED\b)/.test(line),
);
if (!report.includes('releaseRuntimeClasspath')) {
  throw new Error('Expected a Gradle releaseRuntimeClasspath dependency report.');
}
if (forbidden.length) {
  console.error('Android release contains remote push/ML Kit dependencies or unresolved artifacts:');
  console.error(forbidden.join('\n'));
  process.exitCode = 1;
} else {
  console.log('Android release dependency check passed.');
}
