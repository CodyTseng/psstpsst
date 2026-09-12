export type ScreenshotMessage = {
  id: string;
  body: string;
  time: string;
  own: boolean;
};

export type ScreenshotConversation = {
  id: string;
  lastMessageAt: number;
  name: string;
  picture: number;
  preview: string;
  pubkey: string;
  unread: number;
  messages: readonly ScreenshotMessage[];
};

const SCREENSHOT_CONVERSATION_FIXTURES: readonly Omit<
  ScreenshotConversation,
  'lastMessageAt'
>[] = [
  {
    id: 'maya',
    name: 'Maya',
    picture: require('../../../assets/images/marketing/avatars/maya.jpg'),
    preview: 'Still smiling about yesterday 😊',
    pubkey: 'a43f58df19c8e718b071cc0f412a7d584ea84d9c8bc95c9289a970e36509afe3',
    unread: 2,
    messages: [
      { id: 'p1', body: 'I just found your scarf in my bag.', time: '8:02', own: true },
      { id: 'p2', body: 'I was wondering where that went!', time: '8:05', own: false },
      { id: 'p3', body: 'It clearly wanted to come home with me.', time: '8:08', own: true },
      { id: 'p4', body: 'Keep it warm until Saturday?', time: '8:10', own: false },
      { id: 'p5', body: 'Promise.', time: '8:12', own: true },
      { id: 'p6', body: 'Also, those photos turned out so good.', time: '8:25', own: false },
      { id: 'p7', body: 'Even the blurry one by the river?', time: '8:29', own: true },
      { id: 'p8', body: 'Especially that one.', time: '8:32', own: false },
      { id: 'p9', body: 'Sending you my favorites later.', time: '8:37', own: false },
      { id: 'p10', body: 'You know I want all of them.', time: '8:41', own: true },
      { id: '1', body: 'Did you make your train?', time: '8:51', own: true },
      { id: '2', body: 'With thirty seconds to spare 😅', time: '8:52', own: false },
      { id: '3', body: 'That absolutely counts.', time: '8:54', own: true },
      { id: '4', body: 'Made it back! Thank you for such a lovely weekend.', time: '9:12', own: false },
      { id: '5', body: 'Same here. It felt way too short.', time: '9:14', own: true },
      { id: '6', body: 'We need to do it again soon.', time: '9:16', own: false },
      { id: '7', body: 'Coffee next Saturday?', time: '9:19', own: false },
      { id: '8', body: 'Absolutely. Our usual place?', time: '9:28', own: true },
      { id: '9', body: 'Perfect. 10:30?', time: '9:40', own: false },
      { id: '10', body: 'Still smiling about yesterday 😊', time: '9:41', own: false },
    ],
  },
  {
    id: 'mom',
    name: 'Mom',
    picture: require('../../../assets/images/marketing/avatars/mom.jpg'),
    preview: 'Home safe ❤️ The soup is warming up now.',
    pubkey: '268649ddb467fd37a31d42f81adac669784c565161465824ca942b15cb06fd5e',
    unread: 0,
    messages: [
      { id: 'p1', body: 'I left some oranges on your counter.', time: '7:12', own: false },
      { id: 'p2', body: 'How did you get into my apartment?', time: '7:16', own: true },
      { id: 'p3', body: 'You gave me a key, remember?', time: '7:18', own: false },
      { id: 'p4', body: 'Right. Still waking up.', time: '7:21', own: true },
      { id: 'p5', body: 'Coffee first, questions later.', time: '7:22', own: false },
      { id: 'p6', body: 'That is excellent advice.', time: '7:26', own: true },
      { id: 'p7', body: 'Are you wearing the warm coat today?', time: '7:31', own: false },
      { id: 'p8', body: 'Yes, and the scarf you made me.', time: '7:36', own: true },
      { id: 'p9', body: 'Send me a picture later.', time: '7:39', own: false },
      { id: 'p10', body: 'Deal.', time: '7:41', own: true },
      { id: '1', body: 'Morning! Did you sleep well?', time: '7:48', own: false },
      { id: '2', body: 'I did. Heading out in a bit.', time: '7:55', own: true },
      { id: '3', body: 'The soup is in the fridge for you.', time: '8:42', own: false },
      { id: '4', body: 'You are the best. Thank you ❤️', time: '8:44', own: true },
      { id: '5', body: 'There is fresh bread too.', time: '8:45', own: false },
      { id: '6', body: 'Saving that for dinner.', time: '8:49', own: true },
      { id: '7', body: 'Did you remember your umbrella?', time: '9:02', own: false },
      { id: '8', body: 'I did! Just got on the train.', time: '9:06', own: true },
      { id: '9', body: 'Good. It looks like rain here.', time: '9:12', own: false },
      { id: '10', body: 'Text me when you get home ❤️', time: '9:18', own: false },
      { id: '11', body: 'Home safe ❤️ The soup is warming up now.', time: '9:22', own: true },
    ],
  },
  {
    id: 'daniel',
    name: 'Daniel',
    picture: require('../../../assets/images/marketing/avatars/daniel.jpg'),
    preview: 'The cabin is booked! I found the lake trail too.',
    pubkey: '6a9bfd72817d215bd9b0698df6ed56ccc8e617ea6a927c745b2b6563253f62fb',
    unread: 0,
    messages: [
      { id: 'p1', body: 'I finally checked my vacation days.', time: '16:35', own: true },
      { id: 'p2', body: 'And?', time: '16:36', own: false },
      { id: 'p3', body: 'Long weekend approved.', time: '16:38', own: true },
      { id: 'p4', body: 'Yes! Mountains or coast?', time: '16:42', own: false },
      { id: 'p5', body: 'Mountains. Somewhere quiet.', time: '16:45', own: true },
      { id: 'p6', body: 'I will look for cabins tonight.', time: '16:49', own: false },
      { id: 'p7', body: 'You are officially in charge of the view.', time: '16:51', own: true },
      { id: '1', body: 'Are we still thinking mountains next month?', time: '17:42', own: false },
      { id: '2', body: 'Definitely. I could use some fresh air.', time: '17:46', own: true },
      { id: '3', body: 'Same. I found a little cabin by the lake.', time: '17:52', own: false },
      { id: '4', body: 'Send it over!', time: '17:55', own: true },
      { id: '5', body: 'It has a fireplace and a huge porch.', time: '18:03', own: false },
      { id: '6', body: 'You had me at fireplace.', time: '18:05', own: true },
      { id: '7', body: 'The cabin is booked! I found the lake trail too.', time: '18:21', own: false },
      { id: '8', body: "Amazing. I'll bring the coffee.", time: '18:24', own: true },
      { id: '9', body: 'Deal. This is going to be good.', time: '18:25', own: false },
    ],
  },
  {
    id: 'dad',
    name: 'Dad',
    picture: require('../../../assets/images/marketing/avatars/dad.jpg'),
    preview: 'Proud of you. Call when you have a minute.',
    pubkey: 'ed627fb3b21ae775849d88cf2e20982b901f327278104c46ebeb63a8ed1c07e6',
    unread: 0,
    messages: [
      { id: 'p1', body: 'Your mom told me today was the big day.', time: '15:58', own: false },
      { id: 'p2', body: 'She remembered before I did.', time: '16:02', own: true },
      { id: 'p3', body: 'Of course she did.', time: '16:05', own: false },
      { id: 'p4', body: 'I think it went well, but I cannot tell yet.', time: '16:12', own: true },
      { id: 'p5', body: 'Did they ask many questions?', time: '16:18', own: false },
      { id: 'p6', body: 'A few. I had answers for all of them.', time: '16:22', own: true },
      { id: 'p7', body: 'Then you did your part.', time: '16:28', own: false },
      { id: '1', body: 'How did the presentation go?', time: '16:48', own: false },
      { id: '2', body: 'Better than I expected!', time: '16:56', own: true },
      { id: '3', body: 'I knew you would do well.', time: '17:01', own: false },
      { id: '4', body: 'I was so nervous beforehand.', time: '17:08', own: true },
      { id: '5', body: 'Being nervous just means you cared.', time: '17:14', own: false },
      { id: '6', body: 'That sounds like something you would say.', time: '17:18', own: true },
      { id: '7', body: 'Proud of you. Call when you have a minute.', time: '17:32', own: false },
      { id: '8', body: "Thanks, Dad. I'll call after dinner.", time: '17:39', own: true },
      { id: '9', body: 'Sounds good. Love you.', time: '17:40', own: false },
    ],
  },
  {
    id: 'nina',
    name: 'Nina',
    picture: require('../../../assets/images/marketing/avatars/nina.jpg'),
    preview: '[Photo] Look who finally fell asleep',
    pubkey: '71082e15b9da30f2dd046935da931bc8329496c9483c01c10799ca6745a25d08',
    unread: 0,
    messages: [
      { id: 'p1', body: 'I have a very serious update.', time: '20:41', own: false },
      { id: 'p2', body: 'Should I be worried?', time: '20:43', own: true },
      { id: 'p3', body: 'She learned how to climb onto the sofa.', time: '20:45', own: false },
      { id: 'p4', body: 'We always knew she was gifted.', time: '20:48', own: true },
      { id: 'p5', body: 'Now she keeps stealing my socks.', time: '20:52', own: false },
      { id: 'p6', body: 'A tiny criminal.', time: '20:54', own: true },
      { id: 'p7', body: 'No regrets in those eyes either.', time: '20:57', own: false },
      { id: '1', body: 'The puppy has decided my pillow is hers.', time: '21:26', own: false },
      { id: '2', body: 'As she should.', time: '21:29', own: true },
      { id: '3', body: 'She has been running around for two hours.', time: '21:34', own: false },
      { id: '4', body: 'That much cuteness takes energy.', time: '21:38', own: true },
      { id: '5', body: 'Now she is fighting the blanket.', time: '21:43', own: false },
      { id: '6', body: 'Please document everything.', time: '21:45', own: true },
      { id: '7', body: 'Look who finally fell asleep 😴', time: '22:04', own: false },
      { id: '8', body: 'That tiny paw! Send me the photo.', time: '22:06', own: true },
      { id: '9', body: 'Already sent the full-size one 📷', time: '22:07', own: false },
    ],
  },
  {
    id: 'alex',
    name: 'Alex',
    picture: require('../../../assets/images/marketing/avatars/alex.jpg'),
    preview: 'Sunday dinner at ours?',
    pubkey: '69f5b12743384205b4ca55c7e0c5603065fe929c98322b321061dc48c2e13283',
    unread: 0,
    messages: [
      { id: 'p1', body: 'Found the folding chairs in the garage.', time: '17:44', own: false },
      { id: 'p2', body: 'Were they under the camping stuff?', time: '17:48', own: true },
      { id: 'p3', body: 'Naturally.', time: '17:50', own: false },
      { id: 'p4', body: 'Do they still have paint on them?', time: '17:53', own: true },
      { id: 'p5', body: 'That makes them vintage.', time: '17:56', own: false },
      { id: 'p6', body: 'That is not what vintage means.', time: '18:01', own: true },
      { id: 'p7', body: 'It is when I say it with confidence.', time: '18:04', own: false },
      { id: '1', body: 'We finally fixed the table outside.', time: '18:31', own: false },
      { id: '2', body: 'The one that wobbled every time you breathed?', time: '18:36', own: true },
      { id: '3', body: 'That was part of its charm.', time: '18:38', own: false },
      { id: '4', body: 'Sure it was 😂', time: '18:40', own: true },
      { id: '5', body: 'You should come see the new setup.', time: '18:52', own: false },
      { id: '6', body: 'It looks great with the lights on.', time: '18:58', own: false },
      { id: '7', body: 'Sunday dinner at ours?', time: '19:13', own: false },
      { id: '8', body: 'Yes please. Should I bring dessert?', time: '19:16', own: true },
      { id: '9', body: "Only if it's your lemon cake.", time: '19:18', own: false },
    ],
  },
  {
    id: 'sophie',
    name: 'Sophie',
    picture: require('../../../assets/images/marketing/avatars/sophie.jpg'),
    preview: 'The print is finally framed. It looks perfect here.',
    pubkey: 'b48c96e12a793b6b68bd7c35bc62afc72e53c264fba7828b0f50dc4e58304e1a',
    unread: 3,
    messages: [
      { id: '1', body: 'Do you remember that little gallery near the station?', time: '14:06', own: true },
      { id: '2', body: 'The one with the blue door?', time: '14:09', own: false },
      { id: '3', body: 'Yes! They are doing a print sale today.', time: '14:12', own: true },
      { id: '4', body: 'Please tell me you went in.', time: '14:15', own: false },
      { id: '5', body: 'I did, and I found the perfect one for the hallway.', time: '14:22', own: true },
      { id: '6', body: 'The orange landscape?', time: '14:24', own: false },
      { id: '7', body: 'You know me too well.', time: '14:28', own: true },
      { id: '8', body: 'It will look so good by the mirror.', time: '14:31', own: false },
      { id: '9', body: 'I was thinking the same thing.', time: '14:36', own: true },
      { id: '10', body: 'Did you get a frame too?', time: '14:42', own: false },
      { id: '11', body: 'Not yet. I need your expert opinion.', time: '14:47', own: true },
      { id: '12', body: 'Natural oak. No question.', time: '15:03', own: false },
      { id: '13', body: 'Ordered.', time: '15:10', own: true },
      { id: '14', body: 'That was fast!', time: '15:12', own: false },
      { id: '15', body: 'The frame arrived this morning.', time: '16:41', own: true },
      { id: '16', body: 'The print is finally framed. It looks perfect here.', time: '16:52', own: false },
    ],
  },
  {
    id: 'leo',
    name: 'Leo',
    picture: require('../../../assets/images/marketing/avatars/leo.jpg'),
    preview: 'Friday rehearsal? I wrote a new bridge.',
    pubkey: '01841eb1e0d560ea8dd36f66b8db60faeb6b5bd62d9b84c472b66738782308af',
    unread: 0,
    messages: [
      { id: '1', body: 'I found the voice memo from last summer.', time: '18:02', own: false },
      { id: '2', body: 'The song we never finished?', time: '18:05', own: true },
      { id: '3', body: 'That one. The chorus is actually good.', time: '18:08', own: false },
      { id: '4', body: 'High praise from you.', time: '18:11', own: true },
      { id: '5', body: 'I am capable of encouragement sometimes.', time: '18:14', own: false },
      { id: '6', body: 'Can you still play that ridiculous chord?', time: '18:19', own: true },
      { id: '7', body: 'My hand remembers even if I do not.', time: '18:23', own: false },
      { id: '8', body: 'We should finish it.', time: '18:27', own: true },
      { id: '9', body: 'Already ahead of you.', time: '18:31', own: false },
      { id: '10', body: 'I recorded a rough second verse.', time: '18:44', own: false },
      { id: '11', body: 'Send it when you are ready.', time: '18:48', own: true },
      { id: '12', body: 'Give me ten minutes.', time: '18:50', own: false },
      { id: '13', body: 'Okay, that is stuck in my head now.', time: '19:16', own: true },
      { id: '14', body: 'Mission accomplished.', time: '19:19', own: false },
      { id: '15', body: 'The ending still needs something.', time: '20:28', own: true },
      { id: '16', body: 'Friday rehearsal? I wrote a new bridge.', time: '20:36', own: false },
    ],
  },
  {
    id: 'priya',
    name: 'Priya',
    picture: require('../../../assets/images/marketing/avatars/priya.jpg'),
    preview: 'Boarding now. Save me a window seat next time ✈️',
    pubkey: 'f52360e9858d30bf42b9440baef39415b64674626defc390324bc9f6230fa55e',
    unread: 0,
    messages: [
      { id: '1', body: 'Did you make it through security?', time: '9:03', own: true },
      { id: '2', body: 'Eventually. The line wrapped around twice.', time: '9:08', own: false },
      { id: '3', body: 'Airport breakfast acquired?', time: '9:11', own: true },
      { id: '4', body: 'Coffee and something pretending to be a croissant.', time: '9:16', own: false },
      { id: '5', body: 'Living the dream.', time: '9:18', own: true },
      { id: '6', body: 'I found the postcard you wanted.', time: '9:31', own: false },
      { id: '7', body: 'The one with the old lighthouse?', time: '9:35', own: true },
      { id: '8', body: 'Exactly. It is safely in my book.', time: '9:38', own: false },
      { id: '9', body: 'You are a hero.', time: '9:42', own: true },
      { id: '10', body: 'Gate changed again.', time: '10:04', own: false },
      { id: '11', body: 'How far this time?', time: '10:07', own: true },
      { id: '12', body: 'Only the other end of the airport.', time: '10:09', own: false },
      { id: '13', body: 'At least you have the fake croissant.', time: '10:13', own: true },
      { id: '14', body: 'And a very good book.', time: '10:17', own: false },
      { id: '15', body: 'Text me when you land.', time: '10:22', own: true },
      { id: '16', body: 'Boarding now. Save me a window seat next time ✈️', time: '11:24', own: false },
    ],
  },
  {
    id: 'ben',
    name: 'Ben',
    picture: require('../../../assets/images/marketing/avatars/ben.jpg'),
    preview: 'The sourdough lived! Barely.',
    pubkey: '9beae63813eb1fcb10352bd82a33af756719384874466c416302540d917d4e5c',
    unread: 0,
    messages: [
      { id: '1', body: 'Emergency baking question.', time: '7:14', own: false },
      { id: '2', body: 'I am listening.', time: '7:16', own: true },
      { id: '3', body: 'How sleepy can sourdough starter look before it is dead?', time: '7:19', own: false },
      { id: '4', body: 'Is it bubbling at all?', time: '7:22', own: true },
      { id: '5', body: 'One bubble. Maybe two if I am optimistic.', time: '7:24', own: false },
      { id: '6', body: 'Feed it, keep it warm, and wait.', time: '7:28', own: true },
      { id: '7', body: 'This feels like plant parenting.', time: '7:31', own: false },
      { id: '8', body: 'Less sunlight, more flour.', time: '7:33', own: true },
      { id: '9', body: 'I have named it Gerald.', time: '7:36', own: false },
      { id: '10', body: 'That should improve its chances.', time: '7:39', own: true },
      { id: '11', body: 'Gerald is near the radiator now.', time: '7:44', own: false },
      { id: '12', body: 'Not too close!', time: '7:45', own: true },
      { id: '13', body: 'Moving Gerald.', time: '7:46', own: false },
      { id: '14', body: 'Send proof of life later.', time: '7:49', own: true },
      { id: '15', body: 'We have bubbles!', time: '8:41', own: false },
      { id: '16', body: 'The sourdough lived! Barely.', time: '8:47', own: false },
    ],
  },
];

const SCREENSHOT_ORDER: readonly (readonly [id: string, latestMinutesAgo: number])[] = [
  ['maya', 3],
  ['sophie', 8],
  ['mom', 24],
  ['leo', 58],
  ['daniel', 145],
  ['priya', 310],
  ['dad', 780],
  ['ben', 1520],
  ['nina', 3050],
  ['alex', 4380],
];

const SCREENSHOT_CONVERSATION_BY_ID = new Map(
  SCREENSHOT_CONVERSATION_FIXTURES.map((conversation) => [conversation.id, conversation]),
);

export function buildScreenshotConversations(
  timelineAnchorMs: number,
): readonly ScreenshotConversation[] {
  return SCREENSHOT_ORDER.map(([id, latestMinutesAgo]) => {
    const conversation = SCREENSHOT_CONVERSATION_BY_ID.get(id);
    if (!conversation) throw new Error(`Missing screenshot conversation fixture: ${id}`);
    return {
      ...conversation,
      lastMessageAt: Math.floor(timelineAnchorMs / 1000) - latestMinutesAgo * 60,
    };
  });
}

export const SCREENSHOT_UNREAD_COUNT = SCREENSHOT_CONVERSATION_FIXTURES.reduce(
  (total, conversation) => total + conversation.unread,
  0,
);

export function getScreenshotConversation(id: string | undefined, timelineAnchorMs: number) {
  const conversations = buildScreenshotConversations(timelineAnchorMs);
  return conversations.find((conversation) => conversation.id === id) ?? conversations[0];
}
