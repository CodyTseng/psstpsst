import { useRef } from 'react';
import { Slider } from '@expo/ui/swift-ui';
import { disabled as disabledModifier } from '@expo/ui/swift-ui/modifiers';

import { MediaSliderHost } from './MediaSliderHost';
import type { MediaSliderProps } from './MediaSlider.types';

/** The platform slider exposes editing completion, unlike the universal API. */
export function MediaSlider(props: MediaSliderProps) {
  const draft = useRef(props.value);
  return (
    <MediaSliderHost {...props}>
      <Slider
        value={props.value}
        min={0}
        max={props.max ?? 1}
        modifiers={[disabledModifier(!!props.disabled)]}
        onValueChange={(value) => { draft.current = value; props.onValueChange(value); }}
        onEditingChanged={(editing) => {
          if (editing) {
            draft.current = props.value;
            props.onSlidingStart?.();
          }
          else props.onSlidingComplete(draft.current);
        }}
      />
    </MediaSliderHost>
  );
}
