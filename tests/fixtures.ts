import type { Dossier, ExtractedFact, Fact, Item, PlaceProfile, TripInput } from '../lib/domain';
/** A stop's nature as the guide reader returns it. */
export const profile = (p: Partial<PlaceProfile> = {}): PlaceProfile => ({ openArea: false, undecided: false, mode: null, address: null, ticket: null, ...p });
export function item(overrides: Partial<Item> = {}): Item {
  return { id: 'a', day: 1, seq: 1, placeName: '测试博物馆', city: '杭州', kind: 'museum', activity: '参观', sourceText: '测试博物馆', sourceImage: null, confidence: 1, dependsOn: [], start: '10:00', end: '12:00', claimedRules: [], ...overrides };
}
export function trip(items = [item()], overrides: Partial<TripInput> = {}): TripInput {
  return { title: '规则回归', startDate: '2026-10-26', originCity: '', destinationCity: '杭州', arriveDay1: null, leaveLastDay: null, mode: 'transit', guidePublishedAt: null, items, ...overrides };
}
export function fact(rule: Pick<ExtractedFact, 'kind' | 'payload'>, overrides: Partial<Fact> = {}): Fact {
  return { id: crypto.randomUUID(), venueId: 'venue', evidenceId: crypto.randomUUID(), quote: '测试来源原文', venueMatch: 'exact', validFrom: null, validTo: null, quoteVerified: true, tier: 1, domain: 'museum.gov.cn', publishedAt: '2026-10-01', retrievedAt: new Date().toISOString(), linkStatus: 'ok', ...rule, ...overrides } as Fact;
}
export const hours = (open = '09:00', close = '17:00', lastEntry: string | null = '16:00') => fact({ kind: 'hours', payload: { seasons: [{ from: '01-01', to: '12-31', open, close, lastEntry }], weekdays: null } });
export const closedMonday = (exceptStatutoryHolidays = false) => fact({ kind: 'weekly_closure', payload: { closedWeekdays: [1], exceptStatutoryHolidays } });
export const openDays = (weekdays = [0, 2, 3, 4, 5, 6]) => fact({ kind: 'weekly_open', payload: { weekdays, exceptStatutoryHolidays: false } });
export function dossier(facts: Fact[], name = '测试博物馆'): Dossier {
  return { venue: { id: 'venue', key: `杭州:${name}`, canonicalName: name, city: '杭州', officialDomain: 'museum.gov.cn', officialEvidenceId: null, investigationDates: ['2026-10-26'] }, facts, evidence: [], calls: [], searchedScope: [], limitations: [], createdAt: new Date().toISOString() };
}
