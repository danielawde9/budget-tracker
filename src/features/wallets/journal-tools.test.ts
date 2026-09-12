import { describe, expect, it } from 'vitest';

import { filterJournalEvents, journalEventsToCsv } from './journal-tools.js';
import { journalFixtures } from '../../test/in-memory-wallets-gateway.js';

describe('journal tools', () => {
  it('filters only events from the selected wallet and text without widening the loaded space', () => {
    expect(filterJournalEvents(journalFixtures, { query: 'daily', walletId: 'wallet-usd-1', kind: 'income' }))
      .toEqual([journalFixtures[0]]);
  });

  it('exports each movement with actor provenance and safely escaped CSV fields', () => {
    const csv = journalEventsToCsv([{ ...journalFixtures[0]!, movements: [{ ...journalFixtures[0]!.movements[0]!, walletName: 'Daily, "USD"' }] }]);

    expect(csv).toContain('entered_by');
    expect(csv).toContain('"Daily, ""USD"""');
    expect(csv).toContain(journalFixtures[0]!.actorId);
  });
});
