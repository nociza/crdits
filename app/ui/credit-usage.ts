export function creditUsageTotal(amount: number, previousTotal: number, limit: number, mode: "add" | "total") {
  const cents = (value: number) => Math.round(value * 100);
  if (![amount, previousTotal, limit].every(Number.isFinite) || amount < 0 || previousTotal < 0 || limit < 0) {
    throw new Error("Enter a valid credit amount.");
  }
  const total = cents(amount) + (mode === "add" ? cents(previousTotal) : 0);
  if (total > cents(limit)) throw new Error("Amount exceeds the credit remaining.");
  return total / 100;
}
