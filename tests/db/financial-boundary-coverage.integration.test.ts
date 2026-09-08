import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import {
  closeDatabase,
  financialTableWritePrivileges,
  financialWriterFunctionNames,
} from './test-database.js';

const inventoryPath = resolve('docs/financial-command-inventory.md');

afterAll(async () => {
  await closeDatabase();
});

describe('financial posting boundary coverage', () => {
  it('classifies every currently implemented financial writer and documents its entry path', async () => {
    expect(await financialWriterFunctionNames()).toEqual([
      'open_loan_outstanding',
      'record_cash_loan',
      'record_financial_event',
      'record_loan_repayment',
      'reverse_financial_event',
    ]);

    const inventory = readFileSync(inventoryPath, 'utf8');
    for (const command of await financialWriterFunctionNames()) {
      expect(inventory).toContain(`public.${command}`);
    }
    expect(inventory).toContain(
      'The Loans and Wallets workspaces are the implemented financial entry paths',
    );
    expect(inventory).toContain('No import, offline-sync,');
    expect(inventory).toContain('scheduled, or external integration entry path exists yet.');
  });

  it('keeps all financial and planning history tables non-writable by authenticated clients', async () => {
    expect(await financialTableWritePrivileges()).toEqual([
      { table_name: 'financial_events', writable: false },
      { table_name: 'loan_monthly_target_revisions', writable: false },
      { table_name: 'loan_postings', writable: false },
      { table_name: 'loans', writable: false },
      { table_name: 'wallet_movements', writable: false },
      { table_name: 'wallets', writable: false },
    ]);
  });

  it('keeps all financial and planning history tables non-writable by background clients', async () => {
    expect(await financialTableWritePrivileges('service_role')).toEqual([
      { table_name: 'financial_events', writable: false },
      { table_name: 'loan_monthly_target_revisions', writable: false },
      { table_name: 'loan_postings', writable: false },
      { table_name: 'loans', writable: false },
      { table_name: 'wallet_movements', writable: false },
      { table_name: 'wallets', writable: false },
    ]);
  });
});
