export class MonkeyError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// upstream custom status codes the frontend understands
export const Status = {
  TEST_TOO_SHORT: 460,
  RESULT_SPACING_INVALID: 462,
  MISSING_KEY_DATA: 464,
  DUPLICATE_RESULT: 466,
} as const;
