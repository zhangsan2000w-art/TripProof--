import { expect, it } from 'vitest';
import { corroboratesClaim } from '../lib/announcements';
import { closedMonday, fact, hours } from './fixtures';
it('截图中的场馆名与相同短语不能佐证额外日期',()=>{const f=closedMonday();f.quote='测试博物馆每周一闭馆，法定节假日除外。';expect(corroboratesClaim({text:'测试博物馆2026年10月27日闭馆',quote:'测试博物馆每周一闭馆',kind:'closure'},f)).toBe(false);});
it('独立原文逐字支持相同说法时才确认',()=>{const f=closedMonday();f.quote='测试博物馆每周一闭馆，法定节假日除外。';expect(corroboratesClaim({text:'测试博物馆每周一闭馆',quote:'测试博物馆每周一闭馆',kind:'closure'},f)).toBe(true);f.linkStatus='broken';expect(corroboratesClaim({text:'测试博物馆每周一闭馆',quote:'测试博物馆每周一闭馆',kind:'closure'},f)).toBe(false);});
it('不同维度与局部关闭不支持全馆关闭',()=>{const f=hours();f.quote='测试博物馆9:00—17:00开放';expect(corroboratesClaim({text:'测试博物馆闭馆',quote:f.quote,kind:'closure'},f)).toBe(false);const partial=fact({kind:'temp_closure',payload:{from:'2026-10-24',to:'2026-10-24',scope:'partial',note:'二层关闭'}},{quote:'测试博物馆二层展厅关闭'});expect(corroboratesClaim({text:'测试博物馆全馆关闭',quote:partial.quote,kind:'closure'},partial)).toBe(false);});
