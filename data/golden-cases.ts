export const goldenCases = [
  { id: 'shanghai', name: '上海两天一夜', city: '上海', startDate: '2026-10-27', images: [], text: '上海.txt',
    expected: [{ day: 1, names: ['豫园'] },{ day: 1, names: ['玉兰厢'] },{ day: 1, names: ['城隍庙'] },{ day: 1, names: ['南京东路步行街','南京东路','南京路步行街'] },{ day: 1, names: ['外滩'] },{ day: 1, names: ['陆家嘴'] },{ day: 2, names: ['武康路'] },{ day: 2, names: ['安福路'] },{ day: 2, names: ['米泰','Mi Thai'] },{ day: 2, names: ['淮海中路'] },{ day: 2, names: ['新天地'] }], forbidden: [] },
  { id: 'hangzhou', name: '杭州两天一夜', city: '杭州', startDate: '2026-10-24', images: ['hz1.jpg','hz2.jpg','hz3.jpg','hz4.jpg','hz5.jpg','hz6.jpg'], text: null,
    expected: [{ day: 1, names: ['西湖'] },{ day: 1, names: ['断桥残雪','断桥'] },{ day: 1, names: ['三潭印月'] },{ day: 1, names: ['雷峰塔'] },{ day: 1, names: ['河坊街'] },{ day: 2, names: ['灵隐寺'] },{ day: 2, names: ['法喜寺'] },{ day: 2, names: ['拱宸桥'] },{ day: 2, names: ['小河直街'] },{ day: 2, names: ['武林夜市'] }],
    forbidden: ['钱塘江','九溪烟树','西溪湿地','李百蟹','同兴春','杭公馆'] },
  { id: 'linan', name: '临安 City Walk', city: '杭州', startDate: '2026-10-26', images: ['临安.jpg'], text: '临安.txt',
    expected: [{ day: 1, names: ['临安博物馆'] },{ day: 1, names: ['吴越文化博物馆'] },{ day: 1, names: ['临安美术馆'] },{ day: 1, names: ['功臣山','功臣塔'] },{ day: 1, names: ['功臣寺遗址'] },{ day: 1, names: ['几何书店'] },{ day: 1, names: ['净土寺遗址'] },{ day: 1, names: ['衣锦城遗址','依锦城遗址'] },{ day: 1, names: ['钱武肃王陵','钱镠墓','吴越国王陵'] }], forbidden: ['钱宽','水丘氏'] },
  { id: 'nanjing', name: '南京两天一夜', city: '南京', startDate: '2026-10-26', images: ['南京1.jpg','南京2.jpg','南京3.jpg','南京4.jpg'], text: null,
    expected: [{ day: 1, names: ['鸡鸣寺'] },{ day: 1, names: ['玄武湖'] },{ day: 1, names: ['南京博物院'] },{ day: 1, names: ['夫子庙','秦淮河'] },{ day: 1, names: ['老门东'] },{ day: 2, names: ['中山陵'] },{ day: 2, names: ['音乐台'] },{ day: 2, names: ['明孝陵'] },{ day: 2, names: ['总统府'] },{ day: 2, names: ['1912'] }], forbidden: ['牛首山','红山森林','先锋书店','颐和路','莫愁湖'] },
  { id: 'dongtou', name: '温州洞头一日游', city: '温州', startDate: '2026-10-24', images: ['温州洞头1.jpg','温州洞头2.jpg','温州洞头3.jpg'], text: '温州洞头.txt',
    expected: [{ day: 1, names: ['小洱海','中屿等到你'] },{ day: 1, names: ['花港','海上渔村'] },{ day: 1, names: ['七彩洞头村','洞头村'] },{ day: 1, names: ['半屏大桥'] },{ day: 1, names: ['半屏山景区','半屏山'] },{ day: 1, names: ['海上月堤'] }], forbidden: [] },
] as const;
