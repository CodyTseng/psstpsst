import React from 'react';
import renderer, { act } from 'react-test-renderer';

import type { GroupAvatarMember } from '@/hooks/group-presentation-model';

import { Avatar } from '../Avatar';
import { GroupAvatar } from '../GroupAvatar';

jest.mock('../Avatar', () => ({ Avatar: () => null }));

const members: GroupAvatarMember[] = Array.from({ length: 10 }, (_, index) => ({
  pubkey: String(index).padStart(64, '0'),
  name: `Member ${index}`,
}));

describe('GroupAvatar', () => {
  it('renders an overlapping cluster for five through nine members', () => {
    for (let count = 5; count <= 9; count += 1) {
      let tree!: renderer.ReactTestRenderer;
      act(() => {
        tree = renderer.create(<GroupAvatar members={members.slice(0, count)} size={45} />);
      });

      const avatars = tree.root.findAllByType(Avatar);
      expect(avatars).toHaveLength(count);
      expect(avatars.every((avatar) => avatar.props.size > 15)).toBe(true);

      const cells = tree.root.findAll(
        (node) => node.props.style?.position === 'absolute',
      );
      for (const cell of cells) {
        const { start, top } = cell.props.style;
        expect(start).toBeGreaterThan(0);
        expect(top).toBeGreaterThan(0);
        expect(start + avatars[0].props.size).toBeLessThan(45);
        expect(top + avatars[0].props.size).toBeLessThan(45);
      }
      expect(cells.some((cell, index) => cells.slice(index + 1).some((other) => {
        const a = cell.props.style;
        const b = other.props.style;
        const avatarSize = avatars[0].props.size;
        return (
          a.start < b.start + avatarSize &&
          a.start + avatarSize > b.start &&
          a.top < b.top + avatarSize &&
          a.top + avatarSize > b.top
        );
      }))).toBe(true);
      if (count === 6) {
        expect(cells[0].props.style.start + avatars[0].props.size / 2).toBe(22.5);
      }
      if (count === 9) {
        expect(cells[0].props.style.start).not.toBe(cells[3].props.style.start);
      }

      act(() => tree.unmount());
    }
  });

  it('caps large groups at nine rendered avatars', () => {
    let tree!: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(<GroupAvatar members={members} size={45} />);
    });

    expect(tree.root.findAllByType(Avatar)).toHaveLength(9);
  });
});
