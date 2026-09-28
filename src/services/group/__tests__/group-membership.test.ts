import {
  replayMembershipActions,
  type MembershipActionRecord,
} from '../group-membership';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const C = 'c'.repeat(64);

function action(
  id: string,
  orderAt: number,
  authorPubkey: string,
  memberPubkey: string,
  type: 'invite' | 'remove',
  everApplied = false,
): MembershipActionRecord {
  return { id, orderAt, authorPubkey, memberPubkey, action: type, everApplied };
}

describe('group membership replay', () => {
  test('converges for every arrival permutation', () => {
    const actions = [
      action('z', 2, A, B, 'invite'),
      action('y', 3, B, C, 'invite'),
      action('x', 4, A, B, 'remove'),
    ];
    const permutations = [
      actions,
      [actions[2], actions[0], actions[1]],
      [actions[1], actions[2], actions[0]],
    ];
    for (const candidate of permutations) {
      expect(replayMembershipActions([A], { orderAt: 1, id: 'z' }, candidate).members).toEqual([
        A,
        C,
      ]);
    }
  });

  test('evaluates authors at their ordered position and can later validate a candidate', () => {
    const candidate = action('y', 3, B, C, 'invite');
    const withoutPrerequisite = replayMembershipActions(
      [A],
      { orderAt: 1, id: 'z' },
      [candidate],
    );
    expect(withoutPrerequisite.actions[0]).toMatchObject({ applied: false });

    const withPrerequisite = replayMembershipActions(
      [A],
      { orderAt: 1, id: 'z' },
      [candidate, action('z', 2, A, B, 'invite')],
    );
    expect(withPrerequisite.members).toEqual([A, B, C]);
    expect(withPrerequisite.actions.find((item) => item.id === 'y')).toMatchObject({
      applied: true,
      firstApplication: true,
    });
  });

  test('ignores actions at or before the bootstrap cursor', () => {
    const result = replayMembershipActions(
      [A, B],
      { orderAt: 10, id: 'm' },
      [
        action('z', 9, A, B, 'remove'),
        action('z', 10, A, B, 'remove'),
        action('a', 10, A, B, 'remove'),
      ],
    );
    expect(result.members).toEqual([A]);
    expect(result.actions.map((item) => item.applied)).toEqual([false, false, true]);
  });

  test('keeps an ever-applied action visible when replay makes its effect inactive', () => {
    const result = replayMembershipActions(
      [A],
      { orderAt: 1, id: 'z' },
      [action('x', 3, B, C, 'invite', true)],
    );
    expect(result.actions[0]).toMatchObject({
      applied: false,
      everApplied: true,
      firstApplication: false,
    });
  });
});
