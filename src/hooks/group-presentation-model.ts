export const MAX_GROUP_AVATAR_MEMBERS = 9;

export function getDerivedGroupTitleNameLimit(memberCount: number): number {
  if (memberCount <= 3) return memberCount;
  return Math.min(3, memberCount - 2);
}

export type GroupAvatarMember = {
  pubkey: string;
  name: string;
  picture?: string | null;
};
