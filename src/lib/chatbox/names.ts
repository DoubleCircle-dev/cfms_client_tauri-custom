// Default room/user display names sourced from the chat export generated on
// 2026-08-25 (chat_output_2026-08-25.html). Users can still override them per
// room/user.

export const DEFAULT_ROOM_NAMES: Record<string, string> = {
  '58218483-8665-4357-91c5-4a697f91ef74': '聊天系统测试',
  '41118e70-31c0-443a-b124-d76eb45b51d7': '音乐线索讨论',
  'c048bbca-c904-4c75-b36e-8a2f5dd4eeec': 'ARG题目讨论',
  'ade46a55-db85-4660-9e74-ea25eb06fc47': '音频线索分析',
  '1f6f9307-186d-4880-bbdb-1ff381e12df8': '时间异常',
  '96644cf3-6e93-4c51-a9ee-7e7b8d58dc48': '图片与身份暴露',
  'f0359b6d-e8f4-4056-af1d-2e6360fccff5': '紧急应对讨论',
  '56836a58-64d5-40e3-8732-054e39ba6848': '系统崩溃',
  'e5ec0771-f87e-45c0-93be-3f1496a91ec5': '垃圾文件',
  '94d76a24-88fe-4fd0-9cab-d540c50758c9': '关于祭司...',
  '1e013323-cfda-4a0f-be6c-be6197091e9c': '紧急通知',
  '00000000-0000-0000-000000000000': '公共聊天室',
  'b55215f8-6958-453f-899f-8d6dbdd0d332': '8月12日会议通知',
  '604c74a9-8f3c-4745-b1b8-8b8bfa6772c4': '白忙活',
  '3f2f3239-7832-4a45-8c59-485f556c4ba5': '大麻烦-1050007问责',
};

export const DEFAULT_USER_NAMES: Record<string, string> = {
  // Decoded real usernames are kept as-is (highest priority). The 11 entries
  // below are the ones that have been decoded so far; user578 was decoded in
  // earlier exports and is intentionally retained.
  '6025d18': 'user2',
  '5860faf': 'user3',
  'b2e8fa7': 'user131',
  '31b1081': 'user147',
  '4a0aa48': 'Creeper19472',
  '5342bed': 'midnightlev',
  'f60afa4': 'user8',
  '6a08afe': 'user193',
  '7ac3691': 'user379',
  '20c59a1': 'user578',
  'f67ebac': 'cz0822',
  // Remaining users use their display names.
  'e17e013': '聊天系统开发者',
  '1a9c660': '研究者B',
  '0816205': '观测组成员',
  '20c59a1': '不关心',
  '39cb792': '知情人',
  '9f1b371': '提问者',
  '055720a': '系统广播',
  '0e17d81': '神秘人',
  '97e148a': '始作俑者',
  'ab6e5dc': '劝慰者',
  'af398d9': '分类与信息化成员',
};
