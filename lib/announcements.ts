import type { Fact } from './domain';
import { normalizeQuote } from './evidence';
export function corroboratesClaim(claim:{text:string;quote:string;kind:'closure'|'hours'|'reservation'|'other'},fact:Fact) {
  if (!fact.quoteVerified || fact.venueMatch!=='exact' || fact.tier>2 || fact.linkStatus!=='ok' || claim.kind==='other') return false;
  const allowed={closure:['temp_closure','weekly_closure'],hours:['hours','temp_hours'],reservation:['reservation']}[claim.kind];
  if (!allowed.includes(fact.kind)) return false;
  const quote=normalizeQuote(claim.quote), basis=normalizeQuote(fact.quote);
  if(quote.length<8 || !(basis.includes(quote)||quote.includes(basis)))return false;
  const key={closure:/闭馆|闭园|关闭|休馆|休息|閉館|關閉/,hours:/开放|营业|開放|營業|\d[:：]\d/,reservation:/预约|預約|预订/}[claim.kind];
  if(!key.test(quote))return false;
  // A copied venue name or a common phrase cannot support extra dates/numbers.
  const numbers=normalizeQuote(claim.text).match(/\d+/g)??[];
  if(numbers.some(n=>!new RegExp(`(?:^|\\D)${n}(?:\\D|$)`).test(basis)))return false;
  if(fact.kind==='temp_closure'&&fact.payload.scope==='partial'&&/全馆|全园|全部|全館|全園/.test(claim.text))return false;
  return true;
}
