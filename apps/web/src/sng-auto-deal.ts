export function sngShouldAutoDeal(input: {
  atTableRoom: boolean;
  tableFormat: string | null | undefined;
  sngStatus: string | null | undefined;
  seated: boolean;
  handLive: boolean;
  busy: boolean;
  stackIsZero: boolean;
  runoutPlaying: boolean;
  eliminated: boolean;
}): boolean {
  return Boolean(
    input.atTableRoom &&
      (input.tableFormat === "sng" || input.tableFormat === "mtt") &&
      input.sngStatus === "running" &&
      input.seated &&
      !input.handLive &&
      !input.busy &&
      !input.stackIsZero &&
      !input.runoutPlaying &&
      !input.eliminated,
  );
}
