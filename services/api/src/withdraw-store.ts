export interface WithdrawalRecord {
  withdrawalId: string;
  tableId: string;
  playerId: string;
  stackMojos: string;
  originalBuyInMojos: string;
  payoutMojos: string;
  mode: "ledger" | "offer";
  createdAt: string;
}

const withdrawals = new Map<string, WithdrawalRecord>();

function withdrawalKey(tableId: string, playerId: string): string {
  return `${tableId}:${playerId}`;
}

export function hasWithdrawal(tableId: string, playerId: string): boolean {
  return withdrawals.has(withdrawalKey(tableId, playerId));
}

export function recordWithdrawal(record: WithdrawalRecord): void {
  withdrawals.set(withdrawalKey(record.tableId, record.playerId), record);
}

export function getWithdrawal(tableId: string, playerId: string): WithdrawalRecord | undefined {
  return withdrawals.get(withdrawalKey(tableId, playerId));
}
