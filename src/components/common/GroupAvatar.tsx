import { View } from 'react-native';

import {
  MAX_GROUP_AVATAR_MEMBERS,
  type GroupAvatarMember,
} from '@/hooks/group-presentation-model';

import { Avatar } from './Avatar';

type Props = {
  members: readonly GroupAvatarMember[];
  size: number;
};

const COMPACT_CLUSTER_INSET_RATIO = 0.03;

export function GroupAvatar({ members, size }: Props) {
  const shown = members.slice(0, MAX_GROUP_AVATAR_MEMBERS);
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
  const compact = shown.length > 4;
  const cell = compact
    ? compactClusterCellSize(shown.length, size)
    : Math.ceil(size * 0.58);
  const positions = compact
    ? compactClusterPositions(shown.length, size, cell)
    : shown.length === 2
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

function compactClusterCellSize(count: number, size: number) {
  const clusterSize = size * (1 - COMPACT_CLUSTER_INSET_RATIO * 2);
  return clusterSize * (count === 5 ? 0.44 : 0.4);
}

function compactClusterPositions(count: number, size: number, cell: number) {
  const rows = count === 5
    ? [2, 3]
    : count === 6
      ? [1, 2, 3]
      : count === 7
        ? [2, 3, 2]
        : count === 8
          ? [3, 2, 3]
          : [3, 3, 3];
  const clusterSize = size * (1 - COMPACT_CLUSTER_INSET_RATIO * 2);
  const columnStep = ((clusterSize - cell) / 2) * 0.92;
  const rowStep = cell * 0.75;
  const contentHeight = cell + (rows.length - 1) * rowStep;
  const staggerEqualRows = count === 9;
  return rows.flatMap((rowCount, row) => {
    const rowWidth = cell + (rowCount - 1) * columnStep;
    const rowOffset = staggerEqualRows
      ? cell * (row % 2 === 0 ? -0.08 : 0.08)
      : 0;
    const rowStart = (size - rowWidth) / 2 + rowOffset;
    const top = (size - contentHeight) / 2 + row * rowStep;
    return Array.from({ length: rowCount }, (_, column) => ({
      start: rowStart + column * columnStep,
      top,
    }));
  });
}
