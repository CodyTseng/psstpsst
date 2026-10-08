import { useEffect, useRef } from 'react';
import { Slider } from '@expo/ui/jetpack-compose';

import { useThemeColors } from '@/theme';
import { MediaSliderHost } from './MediaSliderHost';
import type { MediaSliderProps } from './MediaSlider.types';

export function MediaSlider(props: MediaSliderProps) {
  const c = useThemeColors();
  const draft = useRef(props.value);
  const editing = useRef(false);
  useEffect(() => { draft.current = props.value; }, [props.value]);
  return (
    <MediaSliderHost {...props}>
      <Slider
        value={props.value}
        min={0}
        max={props.max ?? 1}
        enabled={!props.disabled}
        colors={{ activeTrackColor: c.onOverlay, inactiveTrackColor: c.overlayControl, thumbColor: c.onOverlay }}
        onValueChange={(value) => {
          if (!editing.current) { editing.current = true; props.onSlidingStart?.(); }
          draft.current = value;
          props.onValueChange(value);
        }}
        onValueChangeFinished={() => {
          editing.current = false;
          props.onSlidingComplete(draft.current);
        }}
      />
    </MediaSliderHost>
  );
}
