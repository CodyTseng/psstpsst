import { formatPlayerClock, normalizeVoiceMime, resolveVoiceMime } from '../voice';

describe('voice helpers', () => {
  it('classifies audio-only video containers as audio', () => {
    expect(normalizeVoiceMime('video/mp4')).toBe('audio/mp4');
    expect(normalizeVoiceMime('video/webm')).toBe('audio/webm');
    expect(normalizeVoiceMime('video/3gpp')).toBe('audio/3gpp');
  });

  it('does not reclassify unrelated media types', () => {
    expect(normalizeVoiceMime('video/quicktime')).toBe('video/quicktime');
    expect(normalizeVoiceMime('audio/ogg')).toBe('audio/ogg');
  });

  it('prefers the recorder audio type over an ambiguous container signature', () => {
    expect(resolveVoiceMime('audio/mp4', 'video/mp4')).toBe('audio/mp4');
    expect(resolveVoiceMime('audio/webm; codecs=opus', 'video/webm')).toBe('audio/webm');
  });

  it('fails closed when a voice payload cannot be classified as audio', () => {
    expect(() => resolveVoiceMime('video/quicktime', 'image/jpeg')).toThrow(
      'Voice recording did not resolve to an audio MIME type',
    );
  });

  it('keeps player clock digits stable for the whole duration', () => {
    const labels = [0, 599, 600, 720].map((seconds) => formatPlayerClock(seconds, 720));

    expect(labels).toEqual(['00:00', '09:59', '10:00', '12:00']);
    expect(new Set(labels.map((label) => label.length))).toEqual(new Set([5]));
  });

  it('keeps the hour field for an hour-long clip', () => {
    const total = 5 * 60 * 60 + 30 * 60;
    const labels = [total, total - 1, 60 * 60 - 1, 0].map((seconds) =>
      formatPlayerClock(seconds, total),
    );

    expect(labels).toEqual(['05:30:00', '05:29:59', '00:59:59', '00:00:00']);
    expect(new Set(labels.map((label) => label.length))).toEqual(new Set([8]));
    expect(formatPlayerClock(0, 123 * 60 * 60)).toBe('000:00:00');
  });
});
