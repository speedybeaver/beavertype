/** ObjectId shaped id (24 hex chars, time sortable) so ids look like upstream's. */
export function newId(): string {
  const time = Math.floor(Date.now() / 1000)
    .toString(16)
    .padStart(8, "0");
  const random = [...crypto.getRandomValues(new Uint8Array(8))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return time + random;
}
