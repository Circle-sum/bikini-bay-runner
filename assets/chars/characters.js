// =============================================
// 跑酷游戏角色配置
// 用法：在游戏网页中引入
//   <script src="assets/chars/characters.js"></script>
// 引入后可直接使用全局数组 CHARACTERS
// =============================================

const CHARACTERS = [
  {
    id: 'spongebob',
    name: '海绵碧莲',
    title: '比奇堡的机灵跑者',
    tag: '嘴贫，但关键时刻很可靠',
    desc: '看起来总在开玩笑，实际上最会观察路线。海绵一样的身体让他拥有一次失误保护，越是混乱的路段，越能找到突破口。',
    skill: {
      name: '金光护体',
      active: false,
      effect: '被动生效：每局抵挡首次碰撞，并获得 1.5 秒保护。'
    },
    role: '稳健生存',
    trait: '一次容错',
    accent: '#ffd23e',
    h: 1.72,
    w: 1.5,
    img: 'assets/chars/spongebob.webp',
    // 开局伙伴：unlock 为 0 表示无需解锁
    unlock: 0
  },
  {
    id: 'patrick',
    name: '派宝宝',
    title: '比奇堡的沉默破局者',
    tag: '话很少，出手很快',
    desc: '安静、直接、从不解释。她不太在意路线是否漂亮，只要前面有障碍，就用最简单的方法把路清出来。',
    skill: {
      name: '一铲开路',
      active: true,
      effect: '主动使用：清除当前轨道前方最近的一个路障、横杆或水母；列车无法铲除。'
    },
    role: '果断破障',
    trait: '直接开路',
    accent: '#ff9ec4',
    h: 1.72,
    w: 1.52,
    img: 'assets/chars/patrick.webp',
    unlock: 180
  },
  {
    id: 'squidward',
    name: '章鱼王哥',
    title: '比奇堡的慢节奏观察家',
    tag: '嫌麻烦，但总能看穿节奏',
    desc: '嘴上一直嫌弃这场比赛，触手却早已看懂障碍的节奏。只要把速度调慢一点，他就能用最从容的步子穿过危险路段。',
    skill: {
      name: '触手慢调',
      active: true,
      effect: '主动使用：让前进速度与迎面列车减速 40%，持续 4 秒。'
    },
    role: '掌控节奏',
    trait: '从容应对',
    accent: '#8fd3c5',
    h: 1.86,
    w: 1.12,
    img: 'assets/chars/squidward.webp',
    unlock: 320
  },
  {
    id: 'sandy',
    name: '诸葛珊迪',
    title: '比奇堡的路线规划师',
    tag: '每一步都提前算过',
    desc: '宇航服里装着的不只是工具，还有一套清晰的路线推演。她总能提前看出哪条轨道更安全，把连击和距离一起规划好。',
    skill: {
      name: '穹顶推演',
      active: true,
      effect: '主动使用：显示前方安全轨道或动作提示，持续 5 秒；连击保留 3.4 秒。'
    },
    role: '路线推演',
    trait: '连击加成',
    accent: '#9fc6ea',
    h: 1.74,
    w: 1.3,
    img: 'assets/chars/sandy.webp',
    unlock: 520
  }
];
