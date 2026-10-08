export type MediaSliderProps = {
  value: number;
  max?: number;
  disabled?: boolean;
  accessibilityLabel: string;
  onSlidingStart?: () => void;
  onValueChange: (value: number) => void;
  onSlidingComplete: (value: number) => void;
};
