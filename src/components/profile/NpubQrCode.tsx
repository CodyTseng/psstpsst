import { QrCode } from '@/components/common/QrCode';

type Props = {
  npub: string;
  size: number;
  /** Module color. Defaults to near-black; brand cards pass the accent. */
  color?: string;
};

/**
 * The npub QR for the share card — a thin wrapper over the generic
 * {@link QrCode} so the share flow keeps an npub-named entry point.
 */
export function NpubQrCode({ npub, size, color }: Props) {
  return <QrCode data={npub} size={size} color={color} />;
}
