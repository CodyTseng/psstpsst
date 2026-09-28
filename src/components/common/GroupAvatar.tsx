import { View } from 'react-native';

import type { GroupAvatarMember } from '@/hooks/use-group-presentation';

import { Avatar } from './Avatar';

type Props = {
  members: readonly GroupAvatarMember[];
  size: number;
};

export function GroupAvatar({ members, size }: Props) {
  const shown = members.slice(0, 4);
  if (shown.length <= 1) {
    const member = shown[0];
    return (
      <Avatar
        pubkey={member?.pubkey ?? '0'.repeat(64)}
        picture={member?.picture}
        name={member?.name}
        size={size}
      />
    );
  }
  const cell = Math.ceil(size * 0.58);
  const positions = shown.length === 2
    ? [{ start: 0, top: 0 }, { start: size - cell, top: size - cell }]
    : shown.length === 3
      ? [
          { start: (size - cell) / 2, top: 0 },
          { start: 0, top: size - cell },
          { start: size - cell, top: size - cell },
        ]
      : [
          { start: 0, top: 0 },
          { start: size - cell, top: 0 },
          { start: 0, top: size - cell },
          { start: size - cell, top: size - cell },
        ];
  return (
    <View
      style={{
        width: size,
        height: size,
      }}
    >
      {shown.map((member, index) => (
        <View key={member.pubkey} style={{ position: 'absolute', ...positions[index] }}>
          <Avatar
            pubkey={member.pubkey}
            picture={member.picture}
            name={member.name}
            size={cell}
          />
        </View>
      ))}
    </View>
  );
}
